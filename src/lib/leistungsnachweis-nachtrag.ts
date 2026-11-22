/**
 * Nachtrag im Leistungsnachweis: das Büro markiert offene Leistungen
 * vergangener Einsätze als erledigt – z. B. für Einsätze aus der Zeit vor der
 * Checkliste. Die Einträge tragen source = 'office' und erscheinen im Bericht
 * (auch im Kundenportal und im PDF) als „Nachtrag Büro“, nie als Rückmeldung
 * vom Mitarbeiter vor Ort.
 *
 *  - Nur veröffentlichte Einsätze bis einschließlich heute.
 *  - Was vor Ort schon erledigt/„nicht möglich“ ist, bleibt unverändert;
 *    ein nur begonnener Eintrag (Vorher-Foto) wird erledigt, das Foto bleibt.
 *  - Zeitpunkt: Ausstempeln des Einsatzes, sonst 12:00 am Einsatztag.
 *  - Zurücknehmen löscht nur die Nachträge eines Einsatzes.
 */
import type { Db } from '@/lib/db';
import { checklistCodes, serviceLabel, type SiteService } from '@/lib/services';
import { monthRange } from '@/lib/leistungsnachweis-types';
import { berlinToday } from '@/lib/notifications';

export class NachtragError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function nachtragen(
  db: Db,
  session: { companyId: string; userId: string; name: string },
  { siteId, month, assignmentId }: { siteId: string; month: string; assignmentId?: string | null },
): Promise<{ visits: number; services: number }> {
  const range = monthRange(month);
  if (!range) throw new NachtragError('Ungültiger Monat');
  const { companyId } = session;
  const [site] = await db`SELECT services FROM job_sites WHERE id = ${siteId} AND company_id = ${companyId}`;
  if (!site) throw new NachtragError('Objekt nicht gefunden', 404);

  const visits = await db`
    SELECT a.id, to_char(a.scheduled_date, 'YYYY-MM-DD') AS date, a.categories,
           (SELECT max(t.clock_out_datetime) FROM time_entries t
             WHERE t.company_id = a.company_id AND t.job_assignment_id = a.id) AS clock_out
      FROM job_assignments a
     WHERE a.company_id = ${companyId}
       AND a.job_site_id = ${siteId}
       AND a.is_plan_published
       AND a.scheduled_date >= ${range.first} AND a.scheduled_date < ${range.next}
       AND a.scheduled_date <= ${berlinToday()}
       ${assignmentId ? db`AND a.id = ${assignmentId}` : db``}
  `;
  if (assignmentId && !visits.length) throw new NachtragError('Einsatz nicht gefunden oder liegt in der Zukunft', 404);

  const services = site.services as Record<string, SiteService> | null;
  let visitCount = 0;
  let serviceCount = 0;
  for (const v of visits) {
    const codes = checklistCodes(v.categories);
    if (!codes.length) continue;
    const at = v.clock_out
      ? new Date(v.clock_out as string | Date).toISOString()
      : null;
    let changed = 0;
    for (const code of codes) {
      const rows = await db`
        INSERT INTO service_checks
          (company_id, job_assignment_id, job_site_id, service_code, service_label, status,
           employee_id, employee_name, checked_at, source)
        VALUES
          (${companyId}, ${v.id}, ${siteId}, ${code}, ${serviceLabel(code, services)}, 'done',
           ${session.userId}, ${session.name},
           ${at ? db`${at}::timestamptz` : db`(${v.date}::date + time '12:00') AT TIME ZONE 'Europe/Berlin'`},
           'office')
        ON CONFLICT (job_assignment_id, service_code) DO UPDATE SET
          status = 'done', reason = NULL, source = 'office',
          employee_id = EXCLUDED.employee_id, employee_name = EXCLUDED.employee_name,
          checked_at = EXCLUDED.checked_at, updated_at = now()
        WHERE service_checks.company_id = ${companyId} AND service_checks.status = 'started'
        RETURNING id
      `;
      changed += rows.length;
    }
    if (changed) visitCount += 1;
    serviceCount += changed;
  }
  return { visits: visitCount, services: serviceCount };
}

export async function nachtragZuruecknehmen(db: Db, companyId: string, assignmentId: string): Promise<number> {
  const rows = await db`
    DELETE FROM service_checks
     WHERE company_id = ${companyId} AND job_assignment_id = ${assignmentId} AND source = 'office'
       AND before_media_id IS NULL AND after_media_id IS NULL
    RETURNING id
  `;
  // Mit Vorher-Foto (vor Ort begonnen): zurück auf „begonnen“ statt löschen.
  const reset = await db`
    UPDATE service_checks SET status = 'started', source = 'app', updated_at = now()
     WHERE company_id = ${companyId} AND job_assignment_id = ${assignmentId} AND source = 'office'
    RETURNING id
  `;
  return rows.length + reset.length;
}
