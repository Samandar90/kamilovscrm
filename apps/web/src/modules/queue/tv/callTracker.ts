import type { QueueDisplayCall, QueueDisplayState } from "../api/queueTypes";

/** Keys remembered at most; a day of calls stays far below this (the screen also reloads nightly). */
const MAX_REMEMBERED_KEYS = 2000;

/**
 * Detects the calls to announce from successive polls of the TV endpoint.
 * - The first ingest only remembers keys: a freshly opened screen never replays old calls.
 * - A key is announced once. A re-call bumps callCount, and a newly issued number (return to the queue) changes the
 *   ticket, so either arrives with a new key and is announced again.
 * - A call older than `freshMs` by the server clock (`serverTime`) is remembered but not announced
 *   (e.g. the screen was offline for a while).
 * - The result is ordered by calledAt ascending (the order of the overlay queue).
 */
export function createCallTracker(freshMs = 120_000): { ingest(state: QueueDisplayState): QueueDisplayCall[] } {
  const seen = new Set<string>();
  let primed = false;

  const remember = (key: string) => {
    seen.add(key);
    if (seen.size > MAX_REMEMBERED_KEYS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  };

  return {
    ingest(state) {
      const serverMs = Date.parse(state.serverTime);
      const fresh: QueueDisplayCall[] = [];
      for (const call of state.recentCalls) {
        if (seen.has(call.key)) continue;
        remember(call.key);
        if (!primed) continue;
        const calledMs = Date.parse(call.calledAt);
        if (Number.isNaN(calledMs) || Number.isNaN(serverMs)) continue;
        if (serverMs - calledMs > freshMs) continue;
        fresh.push(call);
      }
      primed = true;
      return fresh.sort((a, b) => Date.parse(a.calledAt) - Date.parse(b.calledAt));
    },
  };
}
