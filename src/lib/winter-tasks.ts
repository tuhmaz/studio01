/**
 * Winterdienst-Aufgaben aus Tourplan/Einsatzplanung und ob sie protokolliert sind.
 *
 * Eine Aufgabe ist "Winterdienst", wenn ihre Kategorien WINTERDIENST enthalten
 * (automatisch geplant oder in der Einsatzplanung angelegt). Protokolliert ist
 * sie, wenn für dasselbe Objekt am selben Tag (Europe/Berlin) mindestens ein
 * gültiger Eintrag im Streuprotokoll steht. Erledigt ohne Eintrag heißt: die
 * Arbeit ist gemacht, aber der rechtlich nötige Nachweis fehlt.
 */
import type { Db } from '@/lib/db';
import { WINTER_CATEGORY } from '@/lib/winter-plan';

export type ProtocolState = 'documented' | 'missing' | 'pending';

export interface WinterTask {
  id: string;
  date: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  title: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  published: boolean;
  onlyWinter: boolean;
  workers: string[];
  entries: number;
  lastEntryAt: string | null;
  protocol: ProtocolState;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function protocolState(status: string, entries: number): ProtocolState {
  if (entries > 0) return 'documented';
  return status === 'COMPLETED' ? 'missing' : 'pending';
}

export async function listWinterTasks(
  db: Db,
  companyId: string,
  from: string,
  to: string,
  options: { workerId?: string; siteId?: string } = {},
): Promise<WinterTask[]> {
  const rows = await db`
    SELECT a.id, to_char(a.scheduled_date, 'YYYY-MM-DD') AS date, a.title, a.status, a.is_plan_published,
           a.categories = ARRAY[${WINTER_CATEGORY}]::text[] AS only_winter,
           s.id AS site_id, s.name AS site_name, concat_ws(', ', s.address, s.city) AS site_address,
           coalesce((SELECT array_agg(u.name ORDER BY u.name) FROM users u
                      WHERE u.company_id = a.company_id AND u.id::text = ANY(a.assigned_worker_ids)), '{}') AS workers,
           log.entries, log.last_at
      FROM job_assignments a
      JOIN job_sites s ON s.id = a.job_site_id AND s.company_id = a.company_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS entries, max(l.performed_at) AS last_at
          FROM winter_service_logs l
         WHERE l.company_id = a.company_id
           AND l.job_site_id = a.job_site_id
           AND (l.performed_at AT TIME ZONE 'Europe/Berlin')::date = a.scheduled_date
           AND NOT l.voided
           AND NOT EXISTS (SELECT 1 FROM winter_service_logs c WHERE c.corrects_log_id = l.id)
      ) log ON true
     WHERE a.company_id = ${companyId}
       AND ${WINTER_CATEGORY} = ANY(a.categories)
       AND a.scheduled_date BETWEEN ${from} AND ${to}
       ${options.workerId ? db`AND ${options.workerId} = ANY(a.assigned_worker_ids)` : db``}
       ${options.siteId ? db`AND a.job_site_id = ${options.siteId}` : db``}
     ORDER BY a.scheduled_date DESC, s.name
     LIMIT 500
  `;
  return rows.map(r => ({
    id: r.id,
    date: r.date,
    siteId: r.site_id,
    siteName: r.site_name,
    siteAddress: r.site_address,
    title: r.title,
    status: r.status,
    published: !!r.is_plan_published,
    onlyWinter: !!r.only_winter,
    workers: r.workers,
    entries: r.entries ?? 0,
    lastEntryAt: r.last_at,
    protocol: protocolState(r.status, r.entries ?? 0),
  }));
}
