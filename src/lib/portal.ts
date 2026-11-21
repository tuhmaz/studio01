/**
 * Kundenportal (Hausverwaltung) — serverseitige Bausteine.
 *
 * Grundregel: Ein Portal-Login (role CLIENT) sieht nur Objekte, deren
 * job_sites.client_id seiner Hausverwaltung entspricht, und nur Ergebnisse
 * der Arbeit (Leistungen, Winterdienst-Protokolle, Fotos, Mängel) — nie
 * Löhne, Arbeitszeiten, Teams oder andere Kunden.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Db } from '@/lib/db';
import type { SessionPayload } from '@/lib/auth-server';
import { getRequestSession, isClientSession } from '@/lib/request-context';
import { MediaError } from '@/lib/media';

export const PORTAL_MEDIA_PREFIX = '/api/portal/media/';
export const portalMediaUrl = (id: string) => `${PORTAL_MEDIA_PREFIX}${id}`;

export class PortalError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface PortalSession extends SessionPayload {
  clientId: string;
}

/** Nur Kunden-Logins mit gültiger Hausverwaltung; alle anderen bekommen 401/403. */
export async function requirePortalSession(req: NextRequest): Promise<PortalSession | NextResponse> {
  const session = await getRequestSession(req, { allowClient: true });
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!isClientSession(session) || !session.clientId) {
    return NextResponse.json({ error: 'Nur für Kundenportal-Zugänge' }, { status: 403 });
  }
  return session as PortalSession;
}

export function portalErrorResponse(error: unknown, route: string) {
  if (error instanceof PortalError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof MediaError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error(`[${route}]`, error);
  return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
}

export async function portalShowsWorkerNames(db: Db, companyId: string): Promise<boolean> {
  const [row] = await db`SELECT portal_show_worker_names FROM companies WHERE id = ${companyId}`;
  return !!row?.portal_show_worker_names;
}

/** Das Objekt, falls es zur Hausverwaltung gehört; sonst PortalError 404. */
export async function portalSite(db: Db, session: PortalSession, siteId: unknown) {
  if (typeof siteId !== 'string' || !siteId) throw new PortalError('Objekt fehlt');
  const [site] = await db`
    SELECT id, name, address, city, postal_code, winter_service_enabled
      FROM job_sites
     WHERE id = ${siteId} AND company_id = ${session.companyId} AND client_id = ${session.clientId}
  `;
  // Gleiche Antwort für "gibt es nicht" und "gehört nicht Ihnen".
  if (!site) throw new PortalError('Objekt nicht gefunden', 404);
  return site;
}

/**
 * Darf die Hausverwaltung diese Datei sehen? Nur wenn sie an einem ihrer
 * Objekte hängt: Vorher/Nachher-Foto einer Leistung, Winterdienst-Foto oder
 * Foto einer eigenen Mängelmeldung.
 */
export async function portalMediaAllowed(db: Db, session: PortalSession, mediaId: string): Promise<boolean> {
  const [hit] = await db`
    SELECT 1 AS ok
     WHERE EXISTS (
             SELECT 1 FROM service_checks sc
               JOIN job_sites s ON s.id = sc.job_site_id
              WHERE sc.company_id = ${session.companyId}
                AND s.company_id = ${session.companyId}
                AND s.client_id = ${session.clientId}
                AND (sc.before_media_id = ${mediaId} OR sc.after_media_id = ${mediaId})
                AND EXISTS (SELECT 1 FROM job_assignments a
                             WHERE a.id = sc.job_assignment_id
                               AND a.company_id = ${session.companyId}
                               AND a.is_plan_published)
           )
        OR EXISTS (
             SELECT 1 FROM winter_service_logs w
               JOIN job_sites s ON s.id = w.job_site_id
              WHERE w.company_id = ${session.companyId}
                AND s.company_id = ${session.companyId}
                AND s.client_id = ${session.clientId}
                AND w.photo_media_id = ${mediaId}
           )
        OR EXISTS (
             SELECT 1 FROM defect_reports d
              WHERE d.company_id = ${session.companyId}
                AND d.client_id = ${session.clientId}
                AND d.photo_media_id = ${mediaId}
           )
  `;
  return !!hit;
}

// ─── Mängelmeldungen ──────────────────────────────────────────────────────────

export type DefectStatus = 'open' | 'scheduled' | 'done' | 'rejected';

export const DEFECT_STATUS_LABELS: Record<DefectStatus, string> = {
  open: 'Eingegangen',
  scheduled: 'Eingeplant',
  done: 'Erledigt',
  rejected: 'Abgelehnt',
};

/**
 * Status, den Kunde und Dienstleister sehen: Der Tourplan-Auftrag treibt ihn
 * voran (veröffentlicht → eingeplant, abgeschlossen → erledigt), eine manuelle
 * Entscheidung (erledigt/abgelehnt) hat Vorrang.
 */
export function effectiveDefectStatus(
  status: DefectStatus,
  assignment: { status?: string | null; is_plan_published?: boolean | null } | null,
): DefectStatus {
  if (status === 'done' || status === 'rejected') return status;
  if (assignment?.status === 'COMPLETED') return 'done';
  if (assignment?.is_plan_published || status === 'scheduled') return 'scheduled';
  return 'open';
}

/** Heutiges Datum in Deutschland (YYYY-MM-DD) — für den Tourplan-Auftrag. */
export function berlinToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);
}

export function cleanText(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new PortalError(`Text ist zu lang (max. ${max} Zeichen)`);
  return text;
}
