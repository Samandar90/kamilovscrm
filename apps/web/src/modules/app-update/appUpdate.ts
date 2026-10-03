import React from "react";
import { hasUnfinishedRequests } from "../../api/http";
import { reloadForMissingChunk } from "./chunkReload";
import { assetRefsInDocument } from "./deployedAssets";
import { isPageBusy, trackEdits, type EditTracker } from "./reloadSafety";
import { createUpdateWatcher } from "./updateWatcher";

/**
 * The update watcher of this tab, wired to the browser. A single-page app keeps the JavaScript it was opened with,
 * and reception keeps the tab open for days: without this a deployed fix reaches the clinic only after someone
 * presses F5. Staff pages only; the TV screen (modules/queue/tv) reloads at night by itself.
 */

/** Follows the fields the user edits, from the moment the watch starts. */
let edits: EditTracker | null = null;

const isOnline = () => navigator.onLine !== false;
const isBusy = () => hasUnfinishedRequests() || isPageBusy(document, window, edits);
const reload = () => window.location.reload();

const watcher = createUpdateWatcher({
  async fetchIndexHtml(signal) {
    // Same origin, so no CORS preflight. `no-cache` makes the browser ask the server with the ETag of its copy:
    // Vercel answers 304 without a body while nothing was deployed. Only the first check of a tab opened at another
    // address has no copy yet and downloads the page (0.7 kB compressed).
    const response = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: "no-cache", signal });
    if (!response.ok) throw new Error(`index.html: HTTP ${response.status}`);
    return response.text();
  },
  loadedAssets: () => assetRefsInDocument(document),
  isHidden: () => document.visibilityState === "hidden",
  isOnline,
  isBusy,
  reload,
});

/** What tells that the user is at the screen. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
const QUIET: AddEventListenerOptions = { capture: true, passive: true };

/** Starts watching for a new version in this tab; returns a function that stops it. */
export function startAppUpdateWatch(): () => void {
  // The dev server has no hashed files to compare, and replaces changed modules by itself.
  if (!import.meta.env.PROD) return () => undefined;
  const tracker = trackEdits(document);
  edits = tracker;
  const onVisibility = () => watcher.visibilityChanged();
  const onActivity = () => watcher.userActive();
  document.addEventListener("visibilitychange", onVisibility);
  ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, QUIET));
  watcher.start();
  return () => {
    watcher.stop();
    tracker.stop();
    if (edits === tracker) edits = null;
    document.removeEventListener("visibilitychange", onVisibility);
    ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, QUIET));
  };
}

/** The router moved to another page: the moment a waiting new version is loaded. */
export const notifyPageChanged = (): void => watcher.pageChanged();

/** True from the moment a newer version is deployed until the tab reloads to it. */
export const useUpdateAvailable = (): boolean => React.useSyncExternalStore(watcher.subscribe, watcher.isUpdateAvailable);

/** The banner's button. The user asked for the reload, so only unsaved work is worth a question. */
export function reloadToNewVersion(confirmLosingWork: () => boolean): void {
  if (isBusy() && !confirmLosingWork()) return;
  reload();
}

/** A page chunk failed to load; see chunkReload.ts. False when the tab did not reload: the page then shows a button. */
export const recoverFromMissingChunk = (): boolean =>
  reloadForMissingChunk({ storage: () => window.sessionStorage, isOnline, isBusy, reload });
