/**
 * A tab opened before a deploy asks for page chunks under their old names; the server no longer has them (Vercel
 * answers such a request with index.html), so the import fails. A reload brings the deployed index.html, which names
 * the chunks that exist. One reload at most per cooldown: if the chunk still fails after it, the cause is something
 * else (the network), and reloading again would only loop.
 */
export const CHUNK_RELOAD_COOLDOWN_MS = 5 * 60_000;
const RELOADED_AT_KEY = "crm_chunk_reload_at";

export type ChunkReloadEnv = {
  /** Session storage of the tab: it survives the reload. May throw when the browser blocks storage. */
  storage(): Pick<Storage, "getItem" | "setItem">;
  isOnline(): boolean;
  /** A request is in flight or the page holds unsaved work: a reload would take something from the user. */
  isBusy(): boolean;
  reload(): void;
};

/**
 * Reloads the page to get the chunks of the deployed version, now or not at all: a reload put off until later could
 * fire after the user has moved on to another page. False when it did not reload; the page then shows a button.
 */
export function reloadForMissingChunk(env: ChunkReloadEnv): boolean {
  // Offline the reload would end on the browser's error page.
  if (!env.isOnline() || env.isBusy()) return false;
  const now = Date.now();
  try {
    const storage = env.storage();
    const reloadedAt = Number(storage.getItem(RELOADED_AT_KEY));
    if (reloadedAt > 0 && now - reloadedAt < CHUNK_RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOADED_AT_KEY, String(now));
  } catch {
    return false; // storage is blocked: nothing would stop a reload loop
  }
  env.reload();
  return true;
}
