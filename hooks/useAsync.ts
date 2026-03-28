/**
 * useAsync — reusable hook for async data fetching with loading/error state.
 *
 * Replaces the repeated pattern of:
 *   const [data, setData] = useState(null);
 *   const [loading, setLoading] = useState(true);
 *   const [error, setError] = useState(null);
 *   useEffect(() => { ... try/catch/finally ... }, [deps]);
 *
 * Usage:
 *   const { data, loading, error, retry } = useAsync(() => fetchJson('/api/things'), [id]);
 *   const { data, loading, error, retry } = useAsync(async () => { ... }, [dep1, dep2]);
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseAsyncResult<T> extends AsyncState<T> {
  /** Re-run the fetcher manually */
  retry: () => void;
  /** Update data without re-fetching */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Hook for async data fetching with automatic loading/error management.
 *
 * @param fetcher - Async function that returns data. Return `undefined` to skip setting data.
 * @param deps - Dependency array. Fetcher re-runs when deps change.
 * @param options.skip - If true, don't run on mount/dep change (call retry() manually).
 */
export function useAsync<T>(
  fetcher: () => Promise<T | undefined>,
  deps: React.DependencyList,
  options?: { skip?: boolean },
): UseAsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: !options?.skip,
    error: null,
  });

  const mountedRef = useRef(true);
  const fetchCountRef = useRef(0);

  const execute = useCallback(async () => {
    const fetchId = ++fetchCountRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetcher();
      // Only update if still mounted and this is the latest fetch
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        if (result !== undefined) {
          setState({ data: result, loading: false, error: null });
        } else {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    } catch (err) {
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        const message =
          err instanceof Error ? err.message : typeof err === "string" ? err : "An error occurred";
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    if (!options?.skip) {
      execute();
    }
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute, options?.skip]);

  const setData = useCallback<React.Dispatch<React.SetStateAction<T | null>>>((value) => {
    setState((prev) => ({
      ...prev,
      data: typeof value === "function" ? (value as (prev: T | null) => T | null)(prev.data) : value,
    }));
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    retry: execute,
    setData,
  };
}

/**
 * Convenience variant that fetches a list and defaults to empty array.
 */
export function useAsyncList<T>(
  fetcher: () => Promise<T[]>,
  deps: React.DependencyList,
  options?: { skip?: boolean },
): UseAsyncResult<T[]> & { items: T[] } {
  const result = useAsync<T[]>(fetcher, deps, options);
  return {
    ...result,
    items: result.data ?? [],
  };
}
