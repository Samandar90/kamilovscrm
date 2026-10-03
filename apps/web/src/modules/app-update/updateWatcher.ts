import { assetRefsInHtml, loadsNewAssets } from "./deployedAssets";

/**
 * How often an open tab asks whether a new version is deployed. One small same-origin request (index.html, answered
 * with 304 while nothing changed), so the clinic's slow link does not notice it.
 */
export const CHECK_INTERVAL_MS = 10 * 60_000;
/** A tab that comes back to the foreground asks at once, unless it asked within this time. */
export const CHECK_MIN_GAP_MS = 60_000;
export const CHECK_TIMEOUT_MS = 10_000;
/** A tab hidden for this long is reloaded; a quick switch to another window is not "away". */
export const HIDDEN_RELOAD_MS = 60_000;
/** A visible tab nobody touched for this long is reloaded. */
export const IDLE_RELOAD_MS = 5 * 60_000;
/** While a new version waits, how often the tab looks whether its user is away. */
export const PENDING_TICK_MS = 15_000;
/** An answer this fresh proves that the server is reachable and the version still new. */
const CONFIRM_FRESH_MS = 30_000;

export type UpdateWatcherEnv = {
  /** Text of the deployed index.html, asked from the server; rejects when it cannot be fetched or `signal` aborts. */
  fetchIndexHtml(signal: AbortSignal): Promise<string>;
  /** Scripts and stylesheets this tab loaded. */
  loadedAssets(): string[];
  isHidden(): boolean;
  isOnline(): boolean;
  /** A dialog is open, input is unsaved or a write is in flight: a reload would take something from the user. */
  isBusy(): boolean;
  reload(): void;
};

export type UpdateWatcher = {
  start(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  isUpdateAvailable(): boolean;
  /** The tab was hidden or shown. */
  visibilityChanged(): void;
  /** The user clicked, typed or scrolled. */
  userActive(): void;
  /** The router moved to another page. */
  pageChanged(): void;
};

/**
 * Notices that a newer web version is deployed and moves the tab to it when that costs the user nothing:
 * on the next page change, or while the user is away (tab hidden for a minute, or untouched for five).
 * Never while `isBusy()`. Until then `isUpdateAvailable()` is true and the app shows a banner with a button.
 */
export function createUpdateWatcher(env: UpdateWatcherEnv): UpdateWatcher {
  const listeners = new Set<() => void>();
  let running = false;
  let available = false;
  let reloading = false;
  let checking: Promise<void> | null = null;
  let checkTimer: ReturnType<typeof setInterval> | undefined;
  let pendingTimer: ReturnType<typeof setInterval> | undefined;
  let lastCheckAt = 0;
  let confirmedAt = Number.NEGATIVE_INFINITY;
  let lastActivityAt = 0;
  let hiddenSince: number | null = null;

  const clearTimers = () => {
    clearInterval(checkTimer);
    clearInterval(pendingTimer);
  };
  /** Before a new version is known the tab asks for it; once it is known the tab waits for a moment to reload. */
  const armTimers = () => {
    clearTimers();
    if (!running || reloading) return;
    if (available) pendingTimer = setInterval(reloadIfAway, PENDING_TICK_MS);
    else checkTimer = setInterval(() => void check(), CHECK_INTERVAL_MS);
  };

  const canReload = () => env.isOnline() && !env.isBusy();
  const isAway = (now: number) =>
    hiddenSince !== null ? now - hiddenSince >= HIDDEN_RELOAD_MS : now - lastActivityAt >= IDLE_RELOAD_MS;

  const reloadNow = () => {
    reloading = true;
    clearTimers();
    env.reload();
  };

  const setAvailable = (value: boolean) => {
    if (available === value) return;
    available = value;
    armTimers();
    listeners.forEach((listener) => listener());
  };

  /** Asks the server which files the deployed page loads. No answer leaves everything as it is. */
  function check(): Promise<void> {
    if (checking) return checking;
    if (!running || reloading || !env.isOnline()) return Promise.resolve();
    const loaded = env.loadedAssets();
    // Without the tab's own list every deployed file would look new.
    if (loaded.length === 0) return Promise.resolve();
    lastCheckAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    checking = env
      .fetchIndexHtml(controller.signal)
      .then(
        (html) => {
          const deployed = assetRefsInHtml(html);
          // An error page of a proxy on the way is not the app: it says nothing about the version.
          if (!running || deployed.length === 0) return;
          const isNew = loadsNewAssets(loaded, deployed);
          if (isNew) confirmedAt = Date.now();
          setAvailable(isNew); // false after true: the deploy was rolled back
          reloadIfAway();
        },
        () => undefined,
      )
      .finally(() => {
        clearTimeout(timer);
        checking = null;
      });
    return checking;
  }

  function reloadIfAway(): void {
    const now = Date.now();
    if (!available || reloading || !isAway(now) || !canReload()) return;
    if (now - confirmedAt <= CONFIRM_FRESH_MS) {
      reloadNow();
      return;
    }
    // Nobody is there to press F5 if the reload ends on the browser's error page, so the server is asked first.
    if (!checking && now - lastCheckAt >= CHECK_MIN_GAP_MS) void check();
  }

  return {
    start() {
      if (running) return;
      running = true;
      const now = Date.now();
      lastCheckAt = now; // the tab has just loaded the deployed version
      lastActivityAt = now;
      hiddenSince = env.isHidden() ? now : null;
      armTimers();
    },
    stop() {
      running = false;
      clearTimers();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isUpdateAvailable: () => available,
    visibilityChanged() {
      const now = Date.now();
      if (env.isHidden()) {
        hiddenSince = hiddenSince ?? now;
        return;
      }
      hiddenSince = null;
      lastActivityAt = now; // looking at the tab again is activity: it must not reload in the user's face
      if (running && !available && now - lastCheckAt >= CHECK_MIN_GAP_MS) void check();
    },
    userActive() {
      lastActivityAt = Date.now();
    },
    pageChanged() {
      // The page the user left is gone anyway, and the new one has nothing typed into it yet.
      if (available && !reloading && canReload()) reloadNow();
    },
  };
}
