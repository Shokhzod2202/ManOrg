'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, get } from './api';

const listeners = new Set<(prefixes: string[]) => void>();

/**
 * After a change, reloads every list on screen whose endpoint starts with one of the prefixes,
 * so another part of the page (or the menu) never shows stale data, e.g. approving an
 * application refreshes the members list.
 */
export function refreshApi(...prefixes: string[]): void {
  for (const l of listeners) l(prefixes);
}

/** Loads a GET endpoint; `path` null skips loading. Every screen shows loading, error and empty states. */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await get<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(Boolean(path));
    void load();
    if (!refreshMs) return;
    const t = setInterval(() => void load(), refreshMs);
    return () => clearInterval(t);
  }, [load, path, refreshMs]);

  useEffect(() => {
    if (!path) return;
    const onRefresh = (prefixes: string[]) => {
      if (prefixes.some((p) => path.startsWith(p))) void load();
    };
    listeners.add(onRefresh);
    return () => {
      listeners.delete(onRefresh);
    };
  }, [load, path]);

  return { data, error, loading, reload: load, setData };
}
