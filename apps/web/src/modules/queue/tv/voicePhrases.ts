import type { QueueDisplayLanguage } from "../api/queueTypes";

/**
 * Spoken announcement = ordered list of clip ids; each id is a file `public/queue-voice/<lang>/<id>.mp3`
 * (texts live in voiceClips.json and are voiced once by scripts/generate-queue-voice.mjs).
 *   uz: "Navbat raqami <N>. Xona raqami <R>."      fallback: "Navbat raqami <N>. Qabulga marhamat."
 *   ru: "Номер <N>. Пройдите в кабинет номер <R>."  fallback: "Номер <N>. Пройдите на приём."
 * Numbers above 999 are never spoken (chime only); the doctor's queue letter is never spoken.
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

/** Room text → number to speak: only plain "1".."999" (no leading zero, no letters); anything else → null. */
function spokenRoomNumber(room: string | null): number | null {
  const text = (room ?? "").trim();
  return /^[1-9][0-9]{0,2}$/.test(text) ? Number(text) : null;
}

/** Full announcement for one language; [] when the queue number cannot be spoken (> 999). */
export function announcementClipIds(lang: VoiceLang, queueNumber: number, room: string | null): string[] {
  const numberIds = numberClipIds(lang, queueNumber);
  if (!numberIds) return [];
  const roomNumber = spokenRoomNumber(room);
  const roomIds = roomNumber === null ? null : numberClipIds(lang, roomNumber);
  if (lang === "ru") {
    return roomIds
      ? ["nomer", ...numberIds, "proydite_v_kabinet_nomer", ...roomIds]
      : ["nomer", ...numberIds, "proydite_na_priyom"];
  }
  return roomIds
    ? ["navbat_raqami", ...numberIds, "xona_raqami", ...roomIds]
    : ["navbat_raqami", ...numberIds, "qabulga_marhamat"];
}

/** Speaking order for a display: uz_ru → Uzbek first, then Russian. */
export function voiceLangs(language: QueueDisplayLanguage): VoiceLang[] {
  if (language === "uz") return ["uz"];
  if (language === "ru") return ["ru"];
  return ["uz", "ru"];
}
