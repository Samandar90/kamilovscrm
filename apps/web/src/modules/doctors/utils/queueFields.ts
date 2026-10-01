/** Cabinet (room) and queue-letter rules for the doctor form; mirrors the API validation in doctorsValidators. */
const ONE_LETTER = /^\p{L}$/u;
const ROOM_MAX_CHARS = 20;

/**
 * Value for the one-letter input: the last letter typed or pasted, upper-cased ("к" → "К", "к-5" → "К");
 * digits, spaces and punctuation are dropped, so "" means "no letter".
 */
export function normalizeQueuePrefixInput(value: string): string {
  const letters = Array.from(value).filter((char) => ONE_LETTER.test(char));
  const last = letters[letters.length - 1];
  if (!last) return "";
  const upper = last.toUpperCase();
  // "ß".toUpperCase() === "SS": keep the original so the prefix stays one character (DB CHECK length = 1).
  return Array.from(upper).length === 1 ? upper : last;
}

/** null when valid. Room: ≤ 20 characters after trim (counted by code point, like the API). Prefix: empty or one letter. */
export function validateDoctorQueueFields(
  room: string,
  queuePrefix: string
): "roomTooLong" | "queuePrefixOneLetter" | null {
  if (Array.from(room.trim()).length > ROOM_MAX_CHARS) return "roomTooLong";
  const prefix = queuePrefix.trim();
  if (prefix && !ONE_LETTER.test(prefix)) return "queuePrefixOneLetter";
  return null;
}
