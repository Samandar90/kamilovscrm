import React from "react";

/**
 * Loads now, then again `intervalMs` after each answer (a setTimeout chain, so slow answers never overlap).
 * Keeps the last good `data` when a later poll fails; `error` holds the latest failure message until the next
 * success. `loading` is true only until the first answer after mount or a `deps` change, so background polls do
 * not flash skeletons. `refresh()` aborts the request in flight and polls immediately. While the browser tab is
 * hidden the request is skipped (the timer keeps running), so a forgotten tab does not load the API.
 * `load` may change every render; the latest one is used.
 */
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: React.DependencyList
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const pollNowRef = React.useRef<() => void>(() => undefined);

  React.useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const schedule = () => {
      if (!disposed) timer = window.setTimeout(poll, intervalMs);
    };
    function poll() {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      if (typeof document !== "undefined" && document.hidden) {
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
          schedule();
        },
        (reason: unknown) => {
          if (disposed || current.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
          schedule();
        }
      );
    }

    pollNowRef.current = poll;
    setLoading(true);
    poll();
    return () => {
      disposed = true;
      pollNowRef.current = () => undefined;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
    // `deps` are the caller's inputs of `load`; `load` itself is read through the ref.
  }, [intervalMs, ...deps]);

  const refresh = React.useCallback(() => pollNowRef.current(), []);
  return { data, error, loading, refresh };
}
