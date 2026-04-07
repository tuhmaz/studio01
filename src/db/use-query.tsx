'use client';

import { useState, useEffect, useRef } from 'react';

type FilterValue = string | number | boolean | null | undefined;
type FilterObject = Record<string, FilterValue>;
type FilterArray = Array<{ column: string; value: FilterValue }>;

export interface UseQueryOptions {
  table: string;
  filters?: FilterObject | FilterArray;
  select?: string;
  orderBy?: { column: string; ascending?: boolean };
  /** Reserved — not used in the current API-based implementation */
  realtime?: boolean;
  enabled?: boolean;
}

export interface UseQueryResult<T> {
  data: T[] | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/** Normalise filters to a plain key→value object */
function normaliseFilters(filters: FilterObject | FilterArray | undefined): FilterObject {
  if (!filters) return {};
  if (Array.isArray(filters)) {
    return Object.fromEntries(filters.map(f => [f.column, f.value]));
  }
  return filters;
}

export function useQuery<T = Record<string, unknown>>(
  options: UseQueryOptions,
): UseQueryResult<T> {
  const { table, filters, select = '*', orderBy, enabled = true } = options;

  const [data,      setData]      = useState<T[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState<Error | null>(null);
  const refreshRef = useRef(0);

  const optionKey = JSON.stringify({ table, filters, select, orderBy, enabled });

  async function fetchData() {
    if (!enabled) { setData(null); setIsLoading(false); return; }

    const cleanFilters = Object.fromEntries(
      Object.entries(normaliseFilters(filters)).filter(([, v]) => v !== undefined)
    );

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/data', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'query', table, filters: cleanFilters, select, orderBy }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Abfragefehler');
      setData((json.data ?? []) as T[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Abfragefehler'));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionKey, refreshRef.current]);

  function refresh() {
    refreshRef.current += 1;
    void fetchData();
  }

  return { data, isLoading, error, refresh };
}
