/**
 * Spoken announcement = ordered list of clip ids; each id is a file `public/queue-voice/<lang>/<id>.mp3`
 * (texts live in voiceClips.json and are voiced once by scripts/generate-queue-voice.mjs).
 *   ru: "Номер <N>."  then the doctor sentence "Пройдите к врачу <ФИО>." spoken by the browser's own voice
 *       (doctorSpeech.ts, speechVoice.ts); without it (no Russian browser voice, no doctor name): "Номер <N>. Пройдите на приём."
 *   uz (not played now): "Navbat raqami <N>."  fallback: "Navbat raqami <N>. Qabulga marhamat."
 * Numbers above 999 are never spoken (chime only); the doctor's queue letter and the room are never spoken.
 */
export type VoiceLang = "uz" | "ru";

/** Clips that start a new sentence: the announcer leaves a longer pause before them. */
export const SENTENCE_START_CLIP_IDS: readonly string[] = [
  "proydite_v_kabinet_nomer",
  "proydite_na_priyom",
  "xona_raqami",
  "qabulga_marhamat",
];

/** Pause (ms) the announcer leaves before a clip that is not the first one of a phrase. */
export function gapBeforeClipMs(clipId: string): number {
  return SENTENCE_START_CLIP_IDS.includes(clipId) ? 300 : 60;
}

/**
 * Clip ids that pronounce `n` (integer 1..999); null outside that range.
 * ru: hundreds + (1..19 as one word | tens + units)  → 115 = ["100","15"], 27 = ["20","7"].
 * uz: hundreds + tens + units, zeros skipped          → 115 = ["100","10","5"], 11 = ["10","1"].
 */
export function numberClipIds(lang: VoiceLang, n: number): string[] | null {
  if (!Number.isInteger(n) || n < 1 || n > 999) return null;
  const ids: string[] = [];
  const hundreds = Math.floor(n / 100) * 100;
  const rest = n % 100;
  if (hundreds > 0) ids.push(String(hundreds));
  if (lang === "ru" && rest > 0 && rest < 20) {
    ids.push(String(rest));
    return ids;
  }
  const tens = Math.floor(rest / 10) * 10;
  const units = rest % 10;
  if (tens > 0) ids.push(String(tens));
  if (units > 0) ids.push(String(units));
  return ids;
}

/**
 * Full announcement clips for one language; [] when the queue number cannot be spoken (> 999).
 * `doctorSpoken` = the doctor sentence follows from the browser voice, so no closing phrase is needed.
 */
export function announcementClipIds(lang: VoiceLang, queueNumber: number, doctorSpoken: boolean): string[] {
  const numberIds = numberClipIds(lang, queueNumber);
  if (!numberIds) return [];
  if (lang === "ru") return doctorSpoken ? ["nomer", ...numberIds] : ["nomer", ...numberIds, "proydite_na_priyom"];
  return doctorSpoken ? ["navbat_raqami", ...numberIds] : ["navbat_raqami", ...numberIds, "qabulga_marhamat"];
}

/**
 * Languages a call is spoken in. Always Russian, whatever language the screen's texts use: the Russian voice is the
 * clear one. The Uzbek clips stay in the repository and the announcer still plays them if a language is added here.
 */
export function voiceLangs(): VoiceLang[] {
  return ["ru"];
}
