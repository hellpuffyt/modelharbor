import { useCallback, useEffect, useRef, useState } from "react";

export type FetchState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: T | null; error: string }
  | { status: "ready"; data: T; error: null };

/**
 * Polls an async fetcher on an interval, keeping the last good value visible while a
 * refresh is in flight and surfacing errors without discarding stale-but-useful data.
 * A change to the fetcher identity (e.g. a different task selected) restarts polling
 * from a fresh loading state.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, deps: unknown[]): FetchState<T> & { refresh: () => void } {
  const [state, setState] = useState<FetchState<T>>({ status: "loading", data: null, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(() => {
    fetcherRef
      .current()
      .then((data) => {
        setState({ status: "ready", data, error: null });
      })
      .catch((err: unknown) => {
        setState((prev) => ({
          status: "error",
          data: prev.status === "ready" ? prev.data : null,
          error: err instanceof Error ? err.message : "unknown error",
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setState({ status: "loading", data: null, error: null });
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, refresh: load };
}
