/**
 * Pure helpers of scripts/generate-queue-voice.mjs: Azure neural TTS or OpenAI TTS → public/queue-voice/<lang>/<id>.mp3.
 * No file system and no global fetch here, so vitest checks them directly (see queueVoice.test.mjs).
 */

export const LANGS = ["uz", "ru"];
export const PROVIDERS = ["azure", "openai"];
export const DEFAULT_VOICES = { uz: "uz-UZ-MadinaNeural", ru: "ru-RU-SvetlanaNeural" };
export const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
/** Free tier F0 allows 20 requests per 60 s: one request every 3.5 s stays under it (69 clips ≈ 4 min). */
export const THROTTLE_MS = 3500;
/** 429 and 5xx are retried up to this many times (6 attempts in total). */
export const MAX_RETRIES = 5;

export const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
/** marin and cedar are OpenAI's best-quality built-in voices; one voice for both languages keeps the TV consistent. */
export const DEFAULT_OPENAI_VOICE = "marin";
/** OpenAI's rate limits are far above 69 short requests; a short pause keeps the run polite. */
export const OPENAI_THROTTLE_MS = 300;
/** gpt-4o-mini-tts follows delivery instructions; each clip is one word or phrase, so the language must be stated. */
export const OPENAI_INSTRUCTIONS = {
  uz:
    "Read the text aloud in Uzbek (Latin script) with natural native Uzbek pronunciation, like a calm, clear announcer " +
    "of the electronic queue in a Tashkent clinic. Numbers are Uzbek words. Say exactly the given words and nothing else.",
  ru:
    "Read the text aloud in Russian with natural native pronunciation, like a calm, clear announcer of the electronic " +
    "queue in a clinic. Say exactly the given words and nothing else.",
};

const XML_LANG = { uz: "uz-UZ", ru: "ru-RU" };
const VOICE_ENV = { uz: "AZURE_VOICE_UZ", ru: "AZURE_VOICE_RU" };
const CLIP_ID = /^[a-z0-9_]+$/;
const REGION = /^[a-z0-9]+$/;

function assertLang(lang) {
  if (!LANGS.includes(lang)) throw new Error(`Unknown language "${lang}" (expected uz or ru)`);
}

/** XML-escapes text for SSML. U+02BB (oʻ) needs no escaping; an ASCII apostrophe becomes &apos;. */
export function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * One clip = one SSML document. Leading/trailing silence is forced to 0 ms so the TV can play clips back to back
 * ("Navbat raqami" + "yigirma" + "yetti" …) without audible gaps.
 */
export function buildSsml(lang, text, voice) {
  assertLang(lang);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${XML_LANG[lang]}">` +
    `<voice name="${escapeXml(voice)}">` +
    `<mstts:silence type="Leading-exact" value="0ms"/>` +
    `<mstts:silence type="Tailing-exact" value="0ms"/>` +
    escapeXml(String(text).trim()) +
    `</voice></speak>`
  );
}

/** Voice for a language: AZURE_VOICE_UZ / AZURE_VOICE_RU when set, else the default neural voice. */
export function voiceFor(lang, env = {}) {
  assertLang(lang);
  const custom = typeof env[VOICE_ENV[lang]] === "string" ? env[VOICE_ENV[lang]].trim() : "";
  return custom || DEFAULT_VOICES[lang];
}

/** OpenAI voice: OPENAI_TTS_VOICE when set, else marin. */
export function openAiVoiceFor(env = {}) {
  const custom = typeof env.OPENAI_TTS_VOICE === "string" ? env.OPENAI_TTS_VOICE.trim() : "";
  return custom || DEFAULT_OPENAI_VOICE;
}

/**
 * CLI flags: --dry-run, --force, --only=uz|ru, --provider=azure|openai (default azure).
 * Anything else is an error (a typo must not start a paid run).
 */
export function parseArgs(argv) {
  const options = { dryRun: false, force: false, only: null, provider: "azure" };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--only=")) {
      const lang = arg.slice("--only=".length);
      if (!LANGS.includes(lang)) throw new Error(`--only must be uz or ru, got "${lang}"`);
      options.only = lang;
    } else if (arg.startsWith("--provider=")) {
      const provider = arg.slice("--provider=".length);
      if (!PROVIDERS.includes(provider)) throw new Error(`--provider must be azure or openai, got "${provider}"`);
      options.provider = provider;
    } else throw new Error(`Unknown argument "${arg}". Use --dry-run, --force, --only=uz|ru, --provider=azure|openai`);
  }
  return options;
}

/**
 * Clips to synthesize from the catalogue { uz: { id: text }, ru: { id: text } }: uz first, then ru, catalogue order.
 * `existing` holds "<lang>/<id>.mp3" paths already on disk; they are skipped unless `force`.
 * Ids become file names, so only [a-z0-9_] is accepted.
 */
export function planClips(catalogue, { only = null, existing = new Set(), force = false } = {}) {
  if (!catalogue || typeof catalogue !== "object" || Array.isArray(catalogue)) {
    throw new Error('voiceClips.json must be an object { "uz": { … }, "ru": { … } }');
  }
  const clips = [];
  for (const lang of LANGS) {
    const entries = catalogue[lang];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      throw new Error(`voiceClips.json: "${lang}" must be an object of clip id → text`);
    }
    if (only && only !== lang) continue;
    for (const [id, text] of Object.entries(entries)) {
      if (!CLIP_ID.test(id)) throw new Error(`voiceClips.json: clip id "${lang}/${id}" may contain only a-z, 0-9 and _`);
      if (typeof text !== "string" || text.trim() === "") throw new Error(`voiceClips.json: clip "${lang}/${id}" has no text`);
      const file = `${lang}/${id}.mp3`;
      if (!force && existing.has(file)) continue;
      clips.push({ lang, id, text: text.trim(), file });
    }
  }
  return clips;
}

/** Regional TTS endpoint; the region is the short name of the Speech resource (westeurope, eastus, …). */
export function ttsEndpoint(region) {
  if (!REGION.test(region)) throw new Error(`AZURE_SPEECH_REGION must be a region name like westeurope, got "${region}"`);
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export const isRetryableStatus = (status) => status === 429 || status >= 500;

/** Delay before retry number `attempt` (1-based): Retry-After (seconds or HTTP date) when given, else 2, 4, 8, 16, 32 s. */
export function retryDelayMs(attempt, retryAfter, nowMs = Date.now()) {
  const value = retryAfter == null ? "" : String(retryAfter).trim();
  if (value !== "") {
    if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
    const at = Date.parse(value);
    if (!Number.isNaN(at)) return Math.max(0, at - nowMs);
  }
  return Math.min(2000 * 2 ** (attempt - 1), 60_000);
}

/**
 * POSTs one TTS request and returns the audio bytes. 401/403 fail at once with `authHint`; 429, 5xx and network
 * errors are retried up to `maxRetries` times (Retry-After honoured); other statuses fail with the service's message.
 * `provider` names the service in every error.
 */
async function postForAudio({ fetchImpl, url, init, provider, authHint, sleep, onRetry, maxRetries }) {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (attempt > maxRetries) throw new Error(`${provider} TTS is unreachable: ${error.message}`);
      const waitMs = retryDelayMs(attempt, null);
      onRetry({ attempt, status: 0, waitMs });
      await sleep(waitMs);
      continue;
    }
    if (response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length === 0) throw new Error(`${provider} TTS returned empty audio (check the voice name)`);
      return audio;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${provider} rejected the key (HTTP ${response.status}). ${authHint}`);
    }
    if (isRetryableStatus(response.status) && attempt <= maxRetries) {
      const waitMs = retryDelayMs(attempt, response.headers.get("retry-after"));
      onRetry({ attempt, status: response.status, waitMs });
      await sleep(waitMs);
      continue;
    }
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    throw new Error(`${provider} TTS failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

/** Synthesizes one SSML document with Azure and returns the mp3 bytes (retry rules: see postForAudio). */
export async function synthesizeClip({ fetchImpl, region, key, ssml, sleep, onRetry = () => {}, maxRetries = MAX_RETRIES }) {
  return postForAudio({
    fetchImpl,
    url: ttsEndpoint(region),
    init: {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "clinic-crm-queue-voice",
      },
      body: ssml,
    },
    provider: "Azure",
    authHint: `Check AZURE_SPEECH_KEY and that AZURE_SPEECH_REGION ("${region}") is the region of that Speech resource.`,
    sleep,
    onRetry,
    maxRetries,
  });
}

/**
 * Synthesizes one clip with OpenAI gpt-4o-mini-tts and returns the mp3 bytes (retry rules: see postForAudio).
 * OpenAI's usage policies require telling listeners the voice is AI-generated: the TV shows that note while voice is on.
 */
export async function synthesizeClipOpenAi({
  fetchImpl,
  apiKey,
  lang,
  text,
  voice = DEFAULT_OPENAI_VOICE,
  model = OPENAI_TTS_MODEL,
  sleep,
  onRetry = () => {},
  maxRetries = MAX_RETRIES,
}) {
  assertLang(lang);
  return postForAudio({
    fetchImpl,
    url: OPENAI_SPEECH_URL,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        voice,
        input: String(text).trim(),
        instructions: OPENAI_INSTRUCTIONS[lang],
        response_format: "mp3",
      }),
    },
    provider: "OpenAI",
    authHint: "Check OPENAI_API_KEY (an active key of the OpenAI project).",
    sleep,
    onRetry,
    maxRetries,
  });
}
