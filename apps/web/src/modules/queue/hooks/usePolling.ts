import React from "react";

/**
 * Loads now, then again `intervalMs` after each answer (a setTimeout chain, so slow answers never overlap).
 * Keeps the last good `data` when a later poll fails; `error` holds the latest failure message until the next
 * success. `loading` is true only until the first answer after mount or a `deps` change, so background polls do
 * not flash skeletons. While the browser tab is hidden the request is skipped (the timer keeps running), so a
 * forgotten tab does not load the API; when the tab becomes visible again it polls at once.
 * `refresh()` aborts the request in flight and polls immediately. Its promise resolves once that answer (success or
 * failure) has been applied, at once while the tab is hidden, and on unmount; it never rejects. Callers can hold
 * their buttons until the screen shows fresh data.
 * `load` may change every render; the latest one is used.
 */
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: React.DependencyList
): { data: T | null; error: string | null; loading: boolean; refresh: () => Promise<void> } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const pollNowRef = React.useRef<() => Promise<void>>(() => Promise.resolve());

  React.useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    // refresh() callers waiting for the next applied answer. An aborted (superseded) answer does not settle them:
    // the poll that superseded it will.
    const waiters: Array<() => void> = [];
    const settle = () => waiters.splice(0).forEach((resolve) => resolve());

    const schedule = () => {
      if (!disposed) timer = window.setTimeout(poll, intervalMs);
    };
    function poll() {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      if (typeof document !== "undefined" && document.hidden) {
        settle();
        schedule();
        return;
      }
      const current = new AbortController();
      controller = current;
      loadRef.current(current.signal).then(
        (value) => {
          if (disposed || current.signal.aborted) return;
          setData(value);
          setError(null);
          setLoading(false);
          settle();
          schedule();
        },
        (reason: unknown) => {
          if (disposed || current.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
          settle();
          schedule();
        }
      );
    }
    const onVisibilityChange = () => {
      if (!document.hidden) poll();
    };

    pollNowRef.current = () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
        poll();
      });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
    setLoading(true);
    poll();
    return () => {
      disposed = true;
      pollNowRef.current = () => Promise.resolve();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
      settle();
    };
    // `deps` are the caller's inputs of `load`; `load` itself is read through the ref.
  }, [intervalMs, ...deps]);

  const refresh = React.useCallback(() => pollNowRef.current(), []);
  return { data, error, loading, refresh };
}
