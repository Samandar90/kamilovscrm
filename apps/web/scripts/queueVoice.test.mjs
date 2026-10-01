import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_OPENAI_VOICE,
  DEFAULT_VOICES,
  OPENAI_INSTRUCTIONS,
  buildSsml,
  escapeXml,
  openAiVoiceFor,
  parseArgs,
  planClips,
  retryDelayMs,
  synthesizeClip,
  synthesizeClipOpenAi,
  ttsEndpoint,
  voiceFor,
} from "./queueVoice.mjs";

const CLI = fileURLToPath(new URL("./generate-queue-voice.mjs", import.meta.url));
const catalogue = JSON.parse(readFileSync(new URL("../src/modules/queue/tv/voiceClips.json", import.meta.url), "utf8"));

/** Minimal stand-in for a fetch Response. */
const reply = (status, { body = "", headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  text: async () => body,
});
const synth = (fetchImpl, sleep = vi.fn(async () => {})) =>
  synthesizeClip({ fetchImpl, region: "westeurope", key: "test-key", ssml: "<speak/>", sleep });

describe("SSML", () => {
  it("wraps one clip with zero leading/trailing silence and the voice's locale", () => {
    expect(buildSsml("uz", " toʻrt ", "uz-UZ-MadinaNeural")).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="uz-UZ">' +
        '<voice name="uz-UZ-MadinaNeural"><mstts:silence type="Leading-exact" value="0ms"/><mstts:silence type="Tailing-exact" value="0ms"/>' +
        "toʻrt</voice></speak>"
    );
    expect(buildSsml("ru", "Пройдите на приём.", "ru-RU-SvetlanaNeural")).toContain('xml:lang="ru-RU"><voice name="ru-RU-SvetlanaNeural">');
  });

  it("escapes XML special characters, including an ASCII apostrophe", () => {
    expect(escapeXml(`A & B <C> "d" o'n`)).toBe("A &amp; B &lt;C&gt; &quot;d&quot; o&apos;n");
    expect(buildSsml("uz", "o'n <1>", "v")).toContain(">o&apos;n &lt;1&gt;</voice>");
  });

  it("rejects an unknown language", () => {
    expect(() => buildSsml("en", "one", "en-US-JennyNeural")).toThrow('Unknown language "en"');
  });
});

describe("voices and flags", () => {
  it("uses the default neural voices unless AZURE_VOICE_UZ / AZURE_VOICE_RU are set", () => {
    expect(voiceFor("uz", {})).toBe(DEFAULT_VOICES.uz);
    expect(voiceFor("ru", { AZURE_VOICE_RU: "  " })).toBe("ru-RU-SvetlanaNeural");
    expect(voiceFor("uz", { AZURE_VOICE_UZ: "uz-UZ-SardorNeural" })).toBe("uz-UZ-SardorNeural");
  });

  it("parses --dry-run, --force, --only and --provider, and refuses anything else", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, force: false, only: null, provider: "azure" });
    expect(parseArgs(["--dry-run", "--force", "--only=ru"])).toEqual({ dryRun: true, force: true, only: "ru", provider: "azure" });
    expect(parseArgs(["--provider=openai"]).provider).toBe("openai");
    expect(() => parseArgs(["--only=en"])).toThrow('--only must be uz or ru, got "en"');
    expect(() => parseArgs(["--provider=google"])).toThrow('--provider must be azure or openai, got "google"');
    expect(() => parseArgs(["--dryrun"])).toThrow('Unknown argument "--dryrun"');
  });

  it("uses the OpenAI voice marin unless OPENAI_TTS_VOICE is set", () => {
    expect(DEFAULT_OPENAI_VOICE).toBe("marin");
    expect(openAiVoiceFor({})).toBe("marin");
    expect(openAiVoiceFor({ OPENAI_TTS_VOICE: "  " })).toBe("marin");
    expect(openAiVoiceFor({ OPENAI_TTS_VOICE: "cedar" })).toBe("cedar");
  });

  it("builds the regional endpoint and refuses a malformed region", () => {
    expect(ttsEndpoint("westeurope")).toBe("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(() => ttsEndpoint("evil.example.com/x")).toThrow("AZURE_SPEECH_REGION");
  });
});

describe("planClips", () => {
  const small = { uz: { "1": "bir", navbat_raqami: "Navbat raqami" }, ru: { "1": "один", nomer: " Номер " } };

  it("lists uz before ru in catalogue order with trimmed text", () => {
    expect(planClips(small)).toEqual([
      { lang: "uz", id: "1", text: "bir", file: "uz/1.mp3" },
      { lang: "uz", id: "navbat_raqami", text: "Navbat raqami", file: "uz/navbat_raqami.mp3" },
      { lang: "ru", id: "1", text: "один", file: "ru/1.mp3" },
      { lang: "ru", id: "nomer", text: "Номер", file: "ru/nomer.mp3" },
    ]);
  });

  it("skips existing files unless forced, and filters by language", () => {
    const existing = new Set(["uz/1.mp3", "ru/nomer.mp3"]);
    expect(planClips(small, { existing }).map((clip) => clip.file)).toEqual(["uz/navbat_raqami.mp3", "ru/1.mp3"]);
    expect(planClips(small, { existing, force: true })).toHaveLength(4);
    expect(planClips(small, { only: "ru" }).map((clip) => clip.file)).toEqual(["ru/1.mp3", "ru/nomer.mp3"]);
  });

  it("refuses ids that are not safe file names, empty texts and a malformed catalogue", () => {
    expect(() => planClips({ uz: { "../x": "a" }, ru: {} })).toThrow('clip id "uz/../x"');
    expect(() => planClips({ uz: { "1": " " }, ru: {} })).toThrow('clip "uz/1" has no text');
    expect(() => planClips({ uz: {} })).toThrow('"ru" must be an object');
    expect(() => planClips([])).toThrow("voiceClips.json must be an object");
  });
});

describe("the real catalogue (src/modules/queue/tv/voiceClips.json)", () => {
  const range = (from, to, step) => Array.from({ length: (to - from) / step + 1 }, (_, i) => String(from + i * step));

  it("has exactly the 69 clips the TV plays", () => {
    expect(Object.keys(catalogue.uz).sort()).toEqual(
      [...range(1, 9, 1), ...range(10, 90, 10), ...range(100, 900, 100), "navbat_raqami", "xona_raqami", "qabulga_marhamat"].sort()
    );
    expect(Object.keys(catalogue.ru).sort()).toEqual(
      [...range(1, 19, 1), ...range(20, 90, 10), ...range(100, 900, 100), "nomer", "proydite_v_kabinet_nomer", "proydite_na_priyom"].sort()
    );
    const clips = planClips(catalogue);
    expect(clips).toHaveLength(69);
    expect(clips[0]).toMatchObject({ file: "uz/1.mp3", text: "bir" });
  });

  it("writes Uzbek oʻ with U+02BB, never an ASCII or typographic apostrophe", () => {
    const uzTexts = Object.values(catalogue.uz);
    expect(uzTexts.filter((text) => /['‘’]/.test(text))).toEqual([]);
    expect(uzTexts.filter((text) => text.includes("ʻ"))).toHaveLength(7);
  });
});

describe("retryDelayMs", () => {
  it("honours Retry-After in seconds or as an HTTP date, else backs off 2, 4, 8 … s", () => {
    expect(retryDelayMs(1, "7")).toBe(7000);
    expect(retryDelayMs(1, "Wed, 30 Sep 2026 10:00:05 GMT", Date.parse("2026-09-30T10:00:00Z"))).toBe(5000);
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, null))).toEqual([2000, 4000, 8000, 16000, 32000]);
  });
});

describe("synthesizeClip", () => {
  it("posts SSML with the key header and returns the mp3 bytes", async () => {
    const fetchImpl = vi.fn(async () => reply(200, { body: "ID3-mp3" }));
    const audio = await synth(fetchImpl);
    expect(audio.toString()).toBe("ID3-mp3");
    expect(fetchImpl).toHaveBeenCalledWith("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1", {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": "test-key",
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "clinic-crm-queue-voice",
      },
      body: "<speak/>",
    });
  });

  it("waits Retry-After on 429 and then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(429, { headers: { "retry-after": "3" } })).mockResolvedValueOnce(reply(200, { body: "ok" }));
    const sleep = vi.fn(async () => {});
    expect((await synth(fetchImpl, sleep)).toString()).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("gives up after 5 retries of a 5xx", async () => {
    const fetchImpl = vi.fn(async () => reply(503, { body: "busy" }));
    const sleep = vi.fn(async () => {});
    await expect(synth(fetchImpl, sleep)).rejects.toThrow("Azure TTS failed with HTTP 503: busy");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000, 8000, 16000, 32000]);
  });

  it("retries a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(reply(200, { body: "ok" }));
    expect((await synth(fetchImpl)).toString()).toBe("ok");
  });

  it("explains a 401 at once, without retrying", async () => {
    const fetchImpl = vi.fn(async () => reply(401));
    await expect(synth(fetchImpl)).rejects.toThrow('Azure rejected the key (HTTP 401). Check AZURE_SPEECH_KEY and that AZURE_SPEECH_REGION ("westeurope")');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails without retry on another 4xx, and on empty audio", async () => {
    await expect(synth(vi.fn(async () => reply(400, { body: "bad SSML" })))).rejects.toThrow("HTTP 400: bad SSML");
    await expect(synth(vi.fn(async () => reply(200)))).rejects.toThrow("empty audio");
  });
});

const synthOpenAi = (fetchImpl, { lang = "uz", text = " yigirma ", sleep = vi.fn(async () => {}) } = {}) =>
  synthesizeClipOpenAi({ fetchImpl, apiKey: "test-openai-key", lang, text, sleep });

describe("synthesizeClipOpenAi", () => {
  it("posts JSON to /v1/audio/speech with the bearer key, model, voice, language instructions and mp3 format", async () => {
    const fetchImpl = vi.fn(async () => reply(200, { body: "ID3-openai" }));
    const audio = await synthOpenAi(fetchImpl);
    expect(audio.toString()).toBe("ID3-openai");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-openai-key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "yigirma",
      instructions: OPENAI_INSTRUCTIONS.uz,
      response_format: "mp3",
    });
  });

  it("asks for Uzbek or Russian pronunciation by language", async () => {
    expect(OPENAI_INSTRUCTIONS.uz).toContain("Uzbek");
    expect(OPENAI_INSTRUCTIONS.ru).toContain("Russian");
    const fetchImpl = vi.fn(async () => reply(200, { body: "ok" }));
    await synthOpenAi(fetchImpl, { lang: "ru", text: "Номер" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ input: "Номер", instructions: OPENAI_INSTRUCTIONS.ru });
    await expect(synthOpenAi(fetchImpl, { lang: "en" })).rejects.toThrow('Unknown language "en"');
  });

  it("retries 429 (Retry-After), 5xx and network errors like the Azure path", async () => {
    const sleep = vi.fn(async () => {});
    const throttled = vi.fn().mockResolvedValueOnce(reply(429, { headers: { "retry-after": "2" } })).mockResolvedValueOnce(reply(200, { body: "ok" }));
    expect((await synthOpenAi(throttled, { sleep })).toString()).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(2000);

    const busy = vi.fn(async () => reply(503, { body: "busy" }));
    await expect(synthOpenAi(busy)).rejects.toThrow("OpenAI TTS failed with HTTP 503: busy");
    expect(busy).toHaveBeenCalledTimes(6);

    const flaky = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(reply(200, { body: "ok" }));
    expect((await synthOpenAi(flaky)).toString()).toBe("ok");
  });

  it("explains a rejected key at once and fails on other 4xx or empty audio", async () => {
    const denied = vi.fn(async () => reply(401));
    await expect(synthOpenAi(denied)).rejects.toThrow("OpenAI rejected the key (HTTP 401). Check OPENAI_API_KEY");
    expect(denied).toHaveBeenCalledTimes(1);
    await expect(synthOpenAi(vi.fn(async () => reply(400, { body: "bad voice" })))).rejects.toThrow("OpenAI TTS failed with HTTP 400: bad voice");
    await expect(synthOpenAi(vi.fn(async () => reply(200)))).rejects.toThrow("OpenAI TTS returned empty audio");
  });
});

describe("generate-queue-voice.mjs CLI", () => {
  // Every TTS key is blanked so a developer's shell key can never reach the network from a test.
  const runCli = (args) =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, AZURE_SPEECH_KEY: "", AZURE_SPEECH_REGION: "", OPENAI_API_KEY: "" },
    });

  it("--provider=openai refuses to run without OPENAI_API_KEY, and its dry run is quick", () => {
    const refused = runCli(["--provider=openai", "--force"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("[voice] Set OPENAI_API_KEY");
    const dry = runCli(["--provider=openai", "--dry-run", "--force"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout.trim().split(/\r?\n/).at(-1)).toBe("[voice] Dry run: 69 clip(s), about 1 min with a key.");
  });

  it("--dry-run --force lists all 69 clips without a key", () => {
    const result = runCli(["--dry-run", "--force"]);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(lines.filter((line) => line.startsWith("[voice] would generate "))).toHaveLength(69);
    expect(lines[0]).toBe("[voice] would generate public/queue-voice/uz/1.mp3  <-  bir");
    expect(lines.at(-1)).toBe("[voice] Dry run: 69 clip(s), about 5 min with a key.");
  });

  it("refuses to run without AZURE_SPEECH_KEY / AZURE_SPEECH_REGION", () => {
    const result = runCli(["--force"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[voice] Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in this shell first");
  });

  it("refuses an unknown flag", () => {
    const result = runCli(["--only=en"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--only must be uz or ru, got "en"');
  });
});
