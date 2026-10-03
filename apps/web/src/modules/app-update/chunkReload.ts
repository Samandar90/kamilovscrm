/**
 * A tab opened before a deploy asks for page chunks under their old names; the server no longer has them (Vercel
 * answers such a request with index.html), so the import fails. A reload brings the deployed index.html, which names
 * the chunks that exist. One reload at most per cooldown: if the chunk still fails after it, the cause is something
 * else (the network), and reloading again would only loop.
 */
export const CHUNK_RELOAD_COOLDOWN_MS = 5 * 60_000;
const RELOADED_AT_KEY = "crm_chunk_reload_at";
const WRITE_POLL_MS = 500;

export type ChunkReloadEnv = {
  /** Session storage of the tab: it survives the reload. May throw when the browser blocks storage. */
  storage(): Pick<Storage, "getItem" | "setItem">;
  isOnline(): boolean;
  hasUnfinishedRequests(): boolean;
  reload(): void;
};

/** Reloads the page to get the chunks of the deployed version. False when a reload is not going to help. */
export function reloadForMissingChunk(env: ChunkReloadEnv): boolean {
  // Offline the reload would end on the browser's error page.
  if (!env.isOnline()) return false;
  const now = Date.now();
  try {
    const storage = env.storage();
    const reloadedAt = Number(storage.getItem(RELOADED_AT_KEY));
    if (reloadedAt > 0 && now - reloadedAt < CHUNK_RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOADED_AT_KEY, String(now));
  } catch {
    return false; // storage is blocked: nothing would stop a reload loop
  }
  const reloadWhenWritten = () => {
    if (env.hasUnfinishedRequests()) setTimeout(reloadWhenWritten, WRITE_POLL_MS);
    else env.reload();
  };
  reloadWhenWritten();
  return true;
}
