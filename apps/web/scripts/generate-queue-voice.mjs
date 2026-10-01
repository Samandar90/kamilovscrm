/**
 * One-time generation of the TV announcement clips with Azure neural TTS (see docs/queue.md, «Голос»).
 *   reads   src/modules/queue/tv/voiceClips.json   { "uz": { id: text }, "ru": { id: text } }
 *   writes  public/queue-voice/<lang>/<id>.mp3     (committed; until they exist the TV plays only the chime)
 * Usage, from apps/web:
 *   npm run voice:generate -- --dry-run     list what would be generated — no key, no network
 *   npm run voice:generate                  generate the missing clips
 *   npm run voice:generate -- --force       regenerate every clip
 *   npm run voice:generate -- --only=uz     one language only
 * Environment (process env only; the key never goes into a file of the repo):
 *   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, optional AZURE_VOICE_UZ (uz-UZ-MadinaNeural), AZURE_VOICE_RU (ru-RU-SvetlanaNeural).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, THROTTLE_MS, buildSsml, parseArgs, planClips, synthesizeClip, voiceFor } from "./queueVoice.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOGUE = path.join(ROOT, "src/modules/queue/tv/voiceClips.json");
const OUT_DIR = path.join(ROOT, "public/queue-voice");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** "<lang>/<id>.mp3" of the non-empty clips already generated. */
function existingClips() {
  const files = new Set();
  for (const lang of LANGS) {
    const dir = path.join(OUT_DIR, lang);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".mp3") && fs.statSync(path.join(dir, name)).size > 0) files.add(`${lang}/${name}`);
    }
  }
  return files;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));
  const clips = planClips(catalogue, { only: options.only, existing: existingClips(), force: options.force });
  if (clips.length === 0) {
    console.log("[voice] Nothing to generate: every clip exists (use --force to regenerate).");
    return;
  }
  if (options.dryRun) {
    for (const clip of clips) console.log(`[voice] would generate public/queue-voice/${clip.file}  <-  ${clip.text}`);
    console.log(`[voice] Dry run: ${clips.length} clip(s), about ${Math.ceil((clips.length * THROTTLE_MS) / 60000)} min with a key.`);
    return;
  }
  const key = (process.env.AZURE_SPEECH_KEY ?? "").trim();
  const region = (process.env.AZURE_SPEECH_REGION ?? "").trim().toLowerCase();
  if (!key || !region) {
    throw new Error("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in this shell first (docs/queue.md), or run with --dry-run.");
  }
  for (const [index, clip] of clips.entries()) {
    if (index > 0) await sleep(THROTTLE_MS);
    const voice = voiceFor(clip.lang, process.env);
    const audio = await synthesizeClip({
      fetchImpl: fetch,
      region,
      key,
      ssml: buildSsml(clip.lang, clip.text, voice),
      sleep,
      onRetry: ({ attempt, status, waitMs }) =>
        console.warn(`[voice] ${clip.file}: ${status ? `HTTP ${status}` : "network error"}, retry ${attempt} in ${Math.round(waitMs / 1000)} s`),
    });
    const target = path.join(OUT_DIR, clip.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Write next to the target and rename, so an interrupted run never leaves a half-written mp3 that looks "existing".
    fs.writeFileSync(`${target}.part`, audio);
    fs.renameSync(`${target}.part`, target);
    console.log(`[voice] ${index + 1}/${clips.length} ${clip.file} (${audio.length} bytes, ${voice})  <-  ${clip.text}`);
  }
  console.log(`[voice] Done: ${clips.length} clip(s) in public/queue-voice. Listen to them (especially uz with "oʻ") before committing.`);
}

main().catch((error) => {
  console.error(`[voice] ${error.message}`);
  process.exitCode = 1;
});
