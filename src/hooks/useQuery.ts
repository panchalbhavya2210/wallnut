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
 * changes (any write anywhere in the app bumps it), when deps change, or on
 * manual refresh. The database stays the source of truth — screens never hold
 * copies of the ledger.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): QueryResult<T> {
  const revision = useDbStore((state) => state.revision);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: Error | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const [manual, setManual] = useState(0);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    fnRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const normalised = error instanceof Error ? error : new Error(String(error));
          // Surfaced for debugging; the UI shows friendly messages.
          console.warn('[query] failed:', normalised.message);
          setState({ data: null, loading: false, error: normalised });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, manual, ...deps]);

  const refresh = useCallback(() => setManual((value) => value + 1), []);
  return { ...state, refresh };
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
