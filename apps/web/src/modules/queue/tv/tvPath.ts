/** True for the public TV routes (/tv, /tv/<code>), which render outside AuthProvider and the staff router. */
export function isTvPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path === "/tv" || path.startsWith("/tv/");
}
