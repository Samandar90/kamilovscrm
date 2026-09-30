/**
 * Pure helpers of scripts/generate-queue-voice.mjs: Azure neural TTS → public/queue-voice/<lang>/<id>.mp3.
 * No file system and no global fetch here, so vitest checks them directly (see queueVoice.test.mjs).
 */

export const LANGS = ["uz", "ru"];
export const DEFAULT_VOICES = { uz: "uz-UZ-MadinaNeural", ru: "ru-RU-SvetlanaNeural" };
export const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
/** Free tier F0 allows 20 requests per 60 s: one request every 3.5 s stays under it (69 clips ≈ 4 min). */
export const THROTTLE_MS = 3500;
/** 429 and 5xx are retried up to this many times (6 attempts in total). */
export const MAX_RETRIES = 5;

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

/** CLI flags: --dry-run, --force, --only=uz|ru. Anything else is an error (a typo must not start a paid run). */
export function parseArgs(argv) {
  const options = { dryRun: false, force: false, only: null };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--only=")) {
      const lang = arg.slice("--only=".length);
      if (!LANGS.includes(lang)) throw new Error(`--only must be uz or ru, got "${lang}"`);
      options.only = lang;
    } else throw new Error(`Unknown argument "${arg}". Use --dry-run, --force, --only=uz|ru`);
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
 * Synthesizes one SSML document and returns the mp3 bytes. 401/403 fail at once with a hint (wrong key or region);
 * 429, 5xx and network errors are retried up to `maxRetries` times; other statuses fail with Azure's message.
 */
export async function synthesizeClip({ fetchImpl, region, key, ssml, sleep, onRetry = () => {}, maxRetries = MAX_RETRIES }) {
  const url = ttsEndpoint(region);
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
          "User-Agent": "clinic-crm-queue-voice",
        },
        body: ssml,
      });
    } catch (error) {
      if (attempt > maxRetries) throw new Error(`Azure TTS is unreachable: ${error.message}`);
      const waitMs = retryDelayMs(attempt, null);
      onRetry({ attempt, status: 0, waitMs });
      await sleep(waitMs);
      continue;
    }
    if (response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length === 0) throw new Error("Azure TTS returned empty audio (check the voice name)");
      return audio;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Azure rejected the key (HTTP ${response.status}). Check AZURE_SPEECH_KEY and that AZURE_SPEECH_REGION ("${region}") is the region of that Speech resource.`
      );
    }
    if (isRetryableStatus(response.status) && attempt <= maxRetries) {
      const waitMs = retryDelayMs(attempt, response.headers.get("retry-after"));
      onRetry({ attempt, status: response.status, waitMs });
      await sleep(waitMs);
      continue;
    }
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    throw new Error(`Azure TTS failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}
