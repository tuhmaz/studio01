'use client';

/**
 * Client-side data layer — calls /api/data (PostgreSQL via server route).
 */

type FilterObject = Record<string, string | number | boolean | null>;

async function apiData(body: Record<string, unknown>) {
  const res = await fetch('/api/data', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'API-Fehler');
  return json.data;
}

export const db = {
  from(table: string) {
    return {
      async select(filters: FilterObject = {}, options?: { select?: string; orderBy?: { column: string; ascending?: boolean } }) {
        return apiData({ action: 'query', table, filters, select: options?.select ?? '*', orderBy: options?.orderBy });
      },
      async contains(column: string, value: string, extraFilters: FilterObject = {}, orderBy?: { column: string; ascending?: boolean }) {
        return apiData({ action: 'query_contains', table, column, value, extraFilters, orderBy });
      },
      async insert(data: Record<string, unknown> | Record<string, unknown>[]) {
        return apiData({ action: 'insert', table, data });
      },
      async upsert(data: Record<string, unknown> | Record<string, unknown>[]) {
        return apiData({ action: 'upsert', table, data });
      },
      async update(filters: FilterObject, data: Record<string, unknown>) {
        return apiData({ action: 'update', table, filters, data });
      },
      async delete(filters: FilterObject) {
        return apiData({ action: 'delete', table, filters });
      },
    };
  },
};
