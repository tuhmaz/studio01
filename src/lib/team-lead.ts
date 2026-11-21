/**
 * Wer stempelt? — Teamleiter-Regel.
 *
 * Ist einem Einsatz ein Teamleiter zugeteilt (Rolle LEADER oder höher), stempelt
 * nur er das Team ein und aus (auch manuelle Nachträge). Mitarbeiter sehen ihre
 * Einsätze und dokumentieren (Checkliste, Fotos, Notizen, Winterdienst), stempeln
 * aber nicht selbst. Einsätze ohne Teamleiter (Einzeleinsätze) stempelt der
 * Mitarbeiter weiterhin selbst – sonst gäbe es dort gar keine Arbeitszeit.
 */
import type { Db } from '@/lib/db';
import type { SessionPayload } from '@/lib/auth-server';
import { normalizeRole } from '@/lib/permissions';

export const LEAD_ROLES = ['LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;

export class TeamLeadError extends Error {
  status = 403;
}

/** Namen der zugeteilten Teamleiter je Einsatz. */
export async function teamLeadsFor(db: Db, companyId: string, assignmentIds: string[]): Promise<Map<string, string[]>> {
  const ids = Array.from(new Set(assignmentIds.filter(Boolean)));
  const result = new Map<string, string[]>();
  if (!ids.length) return result;
  const rows = await db`
    SELECT a.id, array_agg(u.name ORDER BY u.name) AS leads
      FROM job_assignments a
      JOIN users u ON u.company_id = a.company_id
                  AND u.id::text = ANY(a.assigned_worker_ids)
                  AND u.role IN ${db(LEAD_ROLES as unknown as string[])}
     WHERE a.company_id = ${companyId} AND a.id = ANY(${db.array(ids)}::text[])
     GROUP BY a.id
  `;
  rows.forEach(r => result.set(r.id as string, r.leads as string[]));
  return result;
}

/** Wirft, wenn ein Mitarbeiter für einen Einsatz mit Teamleiter selbst stempeln will. */
export async function assertMayRecordTime(db: Db, session: SessionPayload, assignmentIds: Array<string | null | undefined>) {
  if (normalizeRole(session.role) !== 'WORKER') return;
  const leads = await teamLeadsFor(db, session.companyId, assignmentIds.filter((id): id is string => !!id));
  const names = Array.from(new Set([...leads.values()].flat()));
  if (names.length) {
    throw new TeamLeadError(`Ein- und Ausstempeln übernimmt Ihr Teamleiter (${names.join(', ')}).`);
  }
}
