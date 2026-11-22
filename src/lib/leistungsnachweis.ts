/**
 * Leistungsnachweis eines Objekts für einen Monat (serverseitig).
 *
 * Jeder veröffentlichte Einsatz des Monats, die dafür geplanten Leistungen und
 * was vor Ort abgehakt wurde (wann, von wem, mit Vorher/Nachher-Fotos).
 * Wird von der internen Berichtsseite und vom Kundenportal genutzt; das Portal
 * blendet Mitarbeiternamen je nach Firmeneinstellung aus und liefert Fotos
 * über seine eigene, auf die Hausverwaltung beschränkte Medien-Route.
 */
import type { Db } from '@/lib/db';
import { checklistCodes, serviceLabel, type SiteService } from '@/lib/services';
import { monthRange, type LeistungsnachweisReport } from '@/lib/leistungsnachweis-types';

export interface BuildOptions {
  showWorkerNames: boolean;
  /** Baut die URL eines Fotos aus seiner media_files-ID. */
  mediaUrl: (mediaId: string) => string;
}

export async function buildLeistungsnachweis(
  db: Db,
  companyId: string,
  siteId: string,
  month: string,
  options: BuildOptions,
): Promise<LeistungsnachweisReport | null> {
  const range = monthRange(month);
  if (!range) return null;

  const [site] = await db`
    SELECT id, name, address, city, postal_code, services FROM job_sites
     WHERE id = ${siteId} AND company_id = ${companyId}
  `;
  if (!site) return null;
  const [company] = await db`SELECT name, address, city, postal_code, phone, email FROM companies WHERE id = ${companyId}`;

  const visits = await db`
    SELECT a.id, to_char(a.scheduled_date, 'YYYY-MM-DD') AS date, a.title, a.status, a.categories,
           coalesce((SELECT array_agg(u.name ORDER BY u.name) FROM users u
                      WHERE u.company_id = a.company_id AND u.id::text = ANY(a.assigned_worker_ids)), '{}') AS workers
      FROM job_assignments a
     WHERE a.company_id = ${companyId}
       AND a.job_site_id = ${siteId}
       AND a.is_plan_published
       AND a.scheduled_date >= ${range.first} AND a.scheduled_date < ${range.next}
     ORDER BY a.scheduled_date, a.id
  `;
  const checks = visits.length
    ? await db`
        SELECT job_assignment_id, service_code, status, reason, checked_at, employee_name, before_media_id, after_media_id, source
          FROM service_checks
         WHERE company_id = ${companyId} AND job_assignment_id = ANY(${db.array(visits.map(v => v.id))}::text[])
      `
    : [];
  const checkMap = new Map(checks.map(c => [`${c.job_assignment_id}|${c.service_code}`, c]));
  const services = site.services as Record<string, SiteService> | null;
  const { showWorkerNames, mediaUrl } = options;

  let planned = 0;
  let done = 0;
  let notPossible = 0;
  const rows = visits
    .map(v => {
      const items = checklistCodes(v.categories).map(code => {
        const c = checkMap.get(`${v.id}|${code}`);
        planned += 1;
        if (c?.status === 'done') done += 1;
        if (c?.status === 'not_possible') notPossible += 1;
        const finished = !!c && c.status !== 'started';
        return {
          code,
          label: serviceLabel(code, services),
          // "started" (nur ein Vorher-Foto) ist noch kein Ergebnis: weiterhin offen.
          status: (c?.status === 'done' || c?.status === 'not_possible' ? c.status : 'open') as 'done' | 'not_possible' | 'open',
          reason: c?.reason ?? null,
          checkedAt: finished ? c.checked_at : null,
          employeeName: finished && showWorkerNames ? c.employee_name : null,
          byOffice: finished && c.source === 'office',
          beforeUrl: c?.before_media_id ? mediaUrl(c.before_media_id) : null,
          afterUrl: c?.after_media_id ? mediaUrl(c.after_media_id) : null,
        };
      });
      return {
        id: v.id,
        date: v.date,
        title: v.title,
        status: v.status,
        workers: showWorkerNames ? (v.workers as string[]) : [],
        items,
      };
    })
    .filter(v => v.items.length > 0);

  return {
    site: { id: site.id, name: site.name, address: site.address, city: site.city, postalCode: site.postal_code },
    company: company as LeistungsnachweisReport['company'],
    month,
    showWorkerNames,
    visits: rows,
    totals: {
      visits: rows.length,
      planned,
      done,
      notPossible,
      open: planned - done - notPossible,
      compliancePercent: planned ? Math.round((done / planned) * 1000) / 10 : null,
    },
  };
}
