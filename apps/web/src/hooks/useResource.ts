import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * Loads async data with explicit loading / empty / error states and a manual
 * retry. Stale responses are discarded so a slow request cannot overwrite a
 * newer one.
 */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (id !== runId.current) return;
        setDataState(result);
      })
      .catch((err: unknown) => {
        if (id !== runId.current) return;
        if (err instanceof ApiError) setError(err);
        else setError(new ApiError(0, 'unknown', 'حدث خطأ غير متوقع.'));
      })
      .finally(() => {
        if (id === runId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((updater: (prev: T | null) => T | null) => {
    setDataState((prev) => updater(prev));
  }, []);

  return { data, loading, error, reload, setData };
}

/** Ticking clock for live session timers. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
