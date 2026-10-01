/**
 * Thin, fail-safe wrappers over browser features TV engines may lack (Fullscreen, Wake Lock, localStorage).
 * Every function feature-detects and swallows errors: a TV must keep showing the queue whatever is missing.
 */
export const STARTED_FLAG_KEY = "qtv:started";

export type WakeLockHandle = { release(): Promise<void> };

export function readStartedFlag(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STARTED_FLAG_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode, kiosk policy)
  }
}

export function writeStartedFlag(): void {
  try {
    window.localStorage.setItem(STARTED_FLAG_KEY, "1");
  } catch {
    // storage blocked: the start button will simply be shown again after a reload
  }
}

/** Stands down the boot watchdog in index.html: the TV app has mounted, so it must never reload a working screen. */
export function markTvBooted(): void {
  (window as Window & { __qtvBooted?: boolean }).__qtvBooted = true;
}

/** Must run synchronously inside the click/keydown handler (fullscreen needs a user gesture). */
export function requestFullscreen(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (typeof root.requestFullscreen === "function") {
      const pending = root.requestFullscreen();
      if (pending && typeof pending.catch === "function") pending.catch(() => undefined);
    } else if (typeof root.webkitRequestFullscreen === "function") {
      root.webkitRequestFullscreen();
    }
  } catch {
    // not allowed here (e.g. inside an iframe)
  }
}

/** Screen Wake Lock (Chrome 84+, HTTPS only, visible page only); null when unsupported or refused. */
export async function requestWakeLock(): Promise<WakeLockHandle | null> {
  if (typeof navigator === "undefined") return null;
  const wakeLock = (navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> } }).wakeLock;
  if (!wakeLock || typeof wakeLock.request !== "function") return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}
