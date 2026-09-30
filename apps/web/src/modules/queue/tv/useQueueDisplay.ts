import React from "react";
import { QueueDisplayError, fetchQueueDisplayState } from "../api/publicQueueApi";
import type { QueueDisplayState } from "../api/queueTypes";

export const POLL_INTERVAL_MS = 2000;
export const OFFLINE_AFTER_FAILURES = 3;
/** A request hanging longer than this counts as a failure (a stalled TV connection must not stop polling). */
export const REQUEST_TIMEOUT_MS = 8000;
/** Inactive subscription: keep checking, slowly, so the screen recovers by itself once the clinic pays. */
export const INACTIVE_RETRY_MS = 30_000;
/**
 * Unknown or deleted screen: show «Экран отключён» but check again once a minute. A transient 404 (the web deployed
 * before the API, a rollback) must not blank the hall screen until the 04:00 reload.
 */
export const NOT_FOUND_RETRY_MS = 60_000;

/** Delay before the next poll after `failures` consecutive failures: 2 → 4 → 8 → 10 s (cap). */
export function backoffDelayMs(failures: number): number {
  return Math.min(10_000, POLL_INTERVAL_MS * 2 ** Math.max(0, failures - 1));
}

export type QueueDisplayErrorState = "not_found" | "inactive" | null;

/**
 * Polls the public TV endpoint. Keeps the last good state through failures; `offline` turns on after 3 consecutive
 * failures and off with the next success. `not_found` (unknown or deleted screen) is retried every 60 s and
 * `inactive` every 30 s; the next success clears either error.
 */
export function useQueueDisplay(code: string): { state: QueueDisplayState | null; error: QueueDisplayErrorState; offline: boolean } {
  const [state, setState] = React.useState<QueueDisplayState | null>(null);
  const [error, setError] = React.useState<QueueDisplayErrorState>(null);
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let failures = 0;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    setState(null);
    setError(null);
    setOffline(false);

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      controller = typeof AbortController === "function" ? new AbortController() : null;
      const current = controller;
      const timeout = window.setTimeout(() => current?.abort(), REQUEST_TIMEOUT_MS);
      try {
        const next = await fetchQueueDisplayState(code, current?.signal);
        if (cancelled) return;
        failures = 0;
        setState(next);
        setError(null);
        setOffline(false);
        schedule(POLL_INTERVAL_MS);
      } catch (failure) {
        if (cancelled) return;
        if (failure instanceof QueueDisplayError && failure.kind === "not_found") {
          failures = 0;
          setError("not_found");
          setOffline(false);
          schedule(NOT_FOUND_RETRY_MS);
          return;
        }
        if (failure instanceof QueueDisplayError && failure.kind === "inactive") {
          failures = 0;
          setError("inactive");
          setOffline(false);
          schedule(INACTIVE_RETRY_MS);
          return;
        }
        // Network error, 5xx, timeout (AbortError from our own timer), bad JSON.
        failures += 1;
        if (failures >= OFFLINE_AFTER_FAILURES) setOffline(true);
        schedule(backoffDelayMs(failures));
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [code]);

  return { state, error, offline };
}
