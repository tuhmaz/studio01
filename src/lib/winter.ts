/**
 * Winterdienst: validation, the tamper-evident log chain, and weather.
 *
 * Every entry's hash covers its full content plus the previous entry's hash
 * (per company), so changing, inserting or removing a stored row breaks the
 * chain from that point on. verifyWinterChain() recomputes it.
 */
import { createHash } from 'node:crypto';
import type { Db } from '@/lib/db';

import { ACTIVITIES, MATERIALS, type Activity, type Material } from '@/lib/winter-labels';

export { ACTIVITIES, MATERIALS, type Activity, type Material };

const NEEDS_MATERIAL: Activity[] = ['gritting', 'clearing_gritting'];

/** Entries may be recorded up to 72 h late (offline phones) but not in the future. */
export const MAX_BACKDATE_MS = 72 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export class WinterError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'WinterError';
  }
}

export interface WinterWork {
  activity: Activity;
  gritMaterial: Material | null;
  gritAmountKg: number | null;
  areas: string[];
  notes: string | null;
  performedAt: Date;
}

function text(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new WinterError('Ungültige Eingabe');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new WinterError(`Text zu lang (max. ${max} Zeichen)`);
  return trimmed || null;
}

/** Validates the work part of a request (shared by new entries and corrections). */
export function parseWork(
  body: Record<string, unknown>,
  now = new Date(),
  { maxBackdateMs = MAX_BACKDATE_MS }: { maxBackdateMs?: number } = {},
): WinterWork {
  const activity = body.activity as Activity;
  if (!(activity in ACTIVITIES)) throw new WinterError('Bitte die Tätigkeit wählen');

  let gritMaterial: Material | null = null;
  if (body.gritMaterial != null && body.gritMaterial !== '') {
    if (!(String(body.gritMaterial) in MATERIALS)) throw new WinterError('Unbekanntes Streumittel');
    gritMaterial = body.gritMaterial as Material;
  }
  if (NEEDS_MATERIAL.includes(activity) && !gritMaterial) throw new WinterError('Bitte das Streumittel angeben');
  if (!NEEDS_MATERIAL.includes(activity)) gritMaterial = null;

  let gritAmountKg: number | null = null;
  if (body.gritAmountKg != null && body.gritAmountKg !== '') {
    const amount = Number(body.gritAmountKg);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000) throw new WinterError('Ungültige Streumenge');
    // NUMERIC(8,2): round here so the hashed value equals the stored one.
    gritAmountKg = gritMaterial ? Math.round(amount * 100) / 100 : null;
  }

  const rawAreas = body.areas ?? [];
  if (!Array.isArray(rawAreas) || rawAreas.length > 20) throw new WinterError('Ungültige Flächen');
  const areas = rawAreas.map(a => text(a, 60)).filter((a): a is string => !!a);

  let performedAt = now;
  if (body.performedAt != null) {
    const parsed = new Date(String(body.performedAt));
    if (Number.isNaN(parsed.getTime())) throw new WinterError('Ungültiger Zeitpunkt');
    if (parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) throw new WinterError('Zeitpunkt liegt in der Zukunft');
    if (parsed.getTime() < now.getTime() - maxBackdateMs) throw new WinterError('Zeitpunkt liegt mehr als 72 Stunden zurück');
    performedAt = parsed;
  }

  return { activity, gritMaterial, gritAmountKg, areas, notes: text(body.notes, 1000), performedAt };
}

// ─── Hash chain ───────────────────────────────────────────────────────────────

const HASHED_FIELDS = [
  'id', 'company_id', 'chain_seq', 'job_site_id', 'site_label', 'employee_id', 'employee_name',
  'entered_by', 'entered_by_name', 'performed_at', 'recorded_at', 'activity', 'grit_material',
  'grit_amount_kg', 'areas', 'notes', 'lat', 'lng', 'gps_accuracy_m', 'photo_media_id', 'weather',
  'corrects_log_id', 'correction_reason', 'voided', 'client_request_id',
] as const;

/** One normal form for a value, whether it comes from the app or back from PostgreSQL. */
function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object).sort().map(k => [k, normalize((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** NUMERIC columns come back from PostgreSQL as strings; compare them as numbers. */
const NUMERIC_FIELDS = new Set(['chain_seq', 'grit_amount_kg', 'lat', 'lng', 'gps_accuracy_m']);

export function canonicalEntry(row: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const field of HASHED_FIELDS) {
    let value = row[field];
    if (NUMERIC_FIELDS.has(field) && value != null) value = Number(value);
    if (field.endsWith('_at') && value != null && !(value instanceof Date)) value = new Date(String(value));
    out[field] = normalize(value);
  }
  return JSON.stringify(out);
}

export function chainHash(prevHash: string | null, row: Record<string, unknown>): string {
  return createHash('sha256').update(`${prevHash ?? ''}\n${canonicalEntry(row)}`).digest('hex');
}

export interface NewLogRow {
  id: string;
  company_id: string;
  job_site_id: string;
  site_label: string;
  employee_id: string;
  employee_name: string;
  entered_by: string;
  entered_by_name: string;
  performed_at: Date;
  recorded_at: Date;
  activity: Activity;
  grit_material: Material | null;
  grit_amount_kg: number | null;
  areas: string[];
  notes: string | null;
  lat: number | null;
  lng: number | null;
  gps_accuracy_m: number | null;
  photo_media_id: string | null;
  weather: Record<string, unknown> | null;
  corrects_log_id: string | null;
  correction_reason: string | null;
  voided: boolean;
  client_request_id: string | null;
}

/**
 * Appends one entry to the company's chain. Must run inside withTenant();
 * a transaction-scoped advisory lock serialises writers per company so the
 * chain never forks.
 */
export async function appendWinterLog(db: Db, row: NewLogRow) {
  await db`SELECT pg_advisory_xact_lock(hashtext(${`winter:${row.company_id}`}))`;
  const [last] = await db`
    SELECT chain_seq, hash FROM winter_service_logs
     WHERE company_id = ${row.company_id}
     ORDER BY chain_seq DESC LIMIT 1
  `;
  const chain_seq = last ? Number(last.chain_seq) + 1 : 1;
  const prev_hash = last?.hash ?? null;
  const full = { ...row, chain_seq };
  const hash = chainHash(prev_hash, full);

  const [inserted] = await db`
    INSERT INTO winter_service_logs ${db({
      ...full,
      weather: full.weather == null ? null : db.json(full.weather as never),
      prev_hash,
      hash,
    } as Record<string, unknown>)}
    RETURNING *
  `;
  return inserted;
}

export interface ChainCheck {
  valid: boolean;
  entries: number;
  /** chain_seq of the first entry that does not match, if any. */
  brokenAt: number | null;
}

/** Recomputes the whole chain of one company. */
export async function verifyWinterChain(db: Db, companyId: string): Promise<ChainCheck> {
  let prevHash: string | null = null;
  let expectedSeq = 1;
  let entries = 0;
  const BATCH = 500;
  for (;;) {
    const rows: Record<string, unknown>[] = await db`
      SELECT * FROM winter_service_logs
       WHERE company_id = ${companyId} AND chain_seq >= ${expectedSeq}
       ORDER BY chain_seq
       LIMIT ${BATCH}
    `;
    for (const row of rows) {
      const seq = Number(row.chain_seq);
      if (seq !== expectedSeq || row.prev_hash !== prevHash || row.hash !== chainHash(prevHash, row)) {
        return { valid: false, entries, brokenAt: seq === expectedSeq ? seq : expectedSeq };
      }
      prevHash = row.hash as string;
      expectedSeq += 1;
      entries += 1;
    }
    if (rows.length < BATCH) return { valid: true, entries, brokenAt: null };
  }
}

// ─── Weather ──────────────────────────────────────────────────────────────────

/**
 * Hourly observation near a point from the German Weather Service (DWD),
 * via the free Bright Sky API. Best effort: null when unavailable, never
 * blocks recording the work.
 */
export async function fetchWeather(lat: number, lng: number, at: Date): Promise<Record<string, unknown> | null> {
  const hour = new Date(at);
  hour.setUTCMinutes(0, 0, 0);
  const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lng}&date=${hour.toISOString()}&last_date=${new Date(hour.getTime() + 3600_000).toISOString()}&tz=Etc/UTC`;
  try {
    const res = await fetch(url, { signal: globalThis.AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const record = data?.weather?.[0];
    if (!record) return null;
    const source = Array.isArray(data.sources)
      ? data.sources.find((s: { id: number }) => s.id === record.source_id)
      : null;
    return {
      provider: 'DWD (Bright Sky)',
      station: source?.station_name ?? null,
      observedAt: record.timestamp ?? null,
      temperatureC: record.temperature ?? null,
      condition: record.condition ?? null,
      precipitationMm: record.precipitation ?? null,
    };
  } catch {
    return null;
  }
}
