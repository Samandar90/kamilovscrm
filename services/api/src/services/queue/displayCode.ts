import { createHash, randomInt } from "node:crypto";

/** No look-alike characters (0/O, 1/I/L): the code is typed with a TV remote. 31 chars → 10 chars ≈ 49.5 bits. */
export const DISPLAY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 chars

const CODE_LENGTH = 10;

/** 10 random chars from the alphabet (crypto.randomInt). Returns canonical form (no dash). */
export function generateDisplayCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += DISPLAY_CODE_ALPHABET[randomInt(DISPLAY_CODE_ALPHABET.length)];
  }
  return code;
}

/** "K7M2Q9XR4P" → "K7M2Q-9XR4P". */
export function formatDisplayCode(canonical: string): string {
  return `${canonical.slice(0, 5)}-${canonical.slice(5)}`;
}

/** Uppercases, strips everything except [0-9A-Z]; returns canonical 10-char code or null if length != 10 or any char outside the alphabet. */
export function normalizeDisplayCode(input: string): string | null {
  const stripped = String(input ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (stripped.length !== CODE_LENGTH) return null;
  for (const char of stripped) {
    if (!DISPLAY_CODE_ALPHABET.includes(char)) return null;
  }
  return stripped;
}

/** sha256 hex of the canonical code. */
export function hashDisplayCode(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
