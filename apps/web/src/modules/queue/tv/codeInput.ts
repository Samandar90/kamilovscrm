/** Screen code as typed on a TV remote → canonical form: upper case, only [0-9A-Z], at most 10 characters. */
export function normalizeCodeInput(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 10);
}

/** "K7M2Q9XR4P" → "K7M2Q-9XR4P"; a partial code gets the dash once it is longer than 5 characters. */
export function formatCodeForDisplay(canonical: string): string {
  return canonical.length > 5 ? `${canonical.slice(0, 5)}-${canonical.slice(5)}` : canonical;
}
