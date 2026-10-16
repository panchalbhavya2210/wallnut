import { useCallback, useEffect, useRef, useState } from 'react';

import { useDbStore } from '@/stores/db.store';

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Runs an async database query and re-runs it whenever the database revision
 * changes (any write anywhere in the app), when deps change, or on manual
 * refresh. The database stays the source of truth — screens never hold
 * copies of the ledger.
 *
 * Stale-while-revalidate: once a query has data, a re-run never flips
 * `loading` back on. Screens keep rendering the previous result (no loading
 * flicker, no layout jump) until the fresh rows arrive, which is what makes a
 * write feel instant instead of rebuilding every card on screen.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): QueryResult<T> {
  const revision = useDbStore((state) => state.revision);
  const [state, setState] = useState<{ data: T | null; error: Error | null; resolved: boolean }>({
    data: null,
    error: null,
    resolved: false,
  });
  const [manual, setManual] = useState(0);
  const requestRef = useRef(0);

  const fnRef = useRef(fn);
  // Keep the latest callback without touching a ref during render.
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    const request = ++requestRef.current;
    fnRef
      .current()
      .then((data) => {
        if (requestRef.current === request) setState({ data, error: null, resolved: true });
      })
      .catch((error: unknown) => {
        if (requestRef.current !== request) return;
        const normalised = error instanceof Error ? error : new Error(String(error));
        // Surfaced for debugging; the UI shows friendly messages.
        console.warn('[query] failed:', normalised.message);
        setState((previous) => ({ data: previous.data, error: normalised, resolved: true }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, manual, ...deps]);

  const refresh = useCallback(() => setManual((value) => value + 1), []);
  // Loading is derived: only the first, not-yet-resolved pass shows it. A
  // re-run keeps the previous data on screen (and `null` is a real result).
  return {
    data: state.data,
    loading: !state.resolved && state.error === null,
    error: state.error,
    refresh,
  };
}

/** Debounces a rapidly-changing value (search inputs). */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Live clock for greeting/date headers. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
