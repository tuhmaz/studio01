/** Leistungsnachweis: loading a visit's checklist and checking access to it. */
import type { SessionPayload } from '@/lib/auth-server';
import type { Db } from '@/lib/db';
import { normalizeRole } from '@/lib/permissions';
import { checklistCodes, serviceLabel, type SiteService } from '@/lib/services';

export class CheckError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'CheckError';
  }
}

export interface Visit {
  id: string;
  company_id: string;
  job_site_id: string | null;
  scheduled_date: string;
  title: string;
  status: string;
  categories: string[];
  assigned_worker_ids: string[];
  site_name: string | null;
  site_address: string | null;
  site_city: string | null;
  services: Record<string, SiteService> | null;
}

export async function loadVisit(db: Db, companyId: string, assignmentId: string): Promise<Visit> {
  const [visit] = await db`
    SELECT a.id, a.company_id, a.job_site_id, to_char(a.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
           a.title, a.status, a.categories, a.assigned_worker_ids,
           s.name AS site_name, s.address AS site_address, s.city AS site_city, s.services
      FROM job_assignments a
      LEFT JOIN job_sites s ON s.id = a.job_site_id AND s.company_id = a.company_id
     WHERE a.id = ${assignmentId} AND a.company_id = ${companyId}
  `;
  if (!visit) throw new CheckError('Einsatz nicht gefunden', 404);
  return visit as Visit;
}

/** Workers only see and tick the checklists of visits they are assigned to. */
export function assertVisitAccess(session: SessionPayload, visit: Visit) {
  if (normalizeRole(session.role) === 'WORKER' && !visit.assigned_worker_ids.includes(session.userId)) {
    // Same answer as a missing visit: never confirm other people's assignments.
    throw new CheckError('Einsatz nicht gefunden', 404);
  }
}

export function checklistItems(visit: Visit) {
  return checklistCodes(visit.categories).map(code => ({ code, label: serviceLabel(code, visit.services) }));
}

export function presentCheck<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    before_url: row.before_media_id ? `/api/media/${row.before_media_id}` : null,
    after_url: row.after_media_id ? `/api/media/${row.after_media_id}` : null,
  };
}
