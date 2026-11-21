/** Shared helpers for the /api/winter routes. */
import { NextResponse } from 'next/server';
import { MediaError } from '@/lib/media';
import { WinterError } from '@/lib/winter';

export function errorResponse(error: unknown, route: string) {
  if (error instanceof WinterError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof MediaError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error(`[${route}]`, error);
  return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new WinterError(`Ungültige ${label}`);
  return value.toLowerCase();
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function optionalCoordinate(value: unknown, max: number): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new WinterError('Ungültige GPS-Position');
  return n;
}

/** Adds the photo URL that clients use to display an entry's photo. */
export function presentLog<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    photo_url: row.photo_media_id ? `/api/media/${row.photo_media_id}` : null,
  };
}
