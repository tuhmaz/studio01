/**
 * Erinnerung „noch eingestempelt“: offene Zeiteinträge, die länger als
 * `hours` laufen (Standard 10 h, NOTIFY_OPEN_SHIFT_HOURS).
 *
 *  - Erinnert wird, wer ausstempeln darf: bei Einsätzen mit Teamleiter dieser,
 *    sonst der Mitarbeiter selbst (Teamleiter-Regel).
 *  - Das Büro (ADMIN/MANAGER) erhält je Einsatz einen Hinweis mit den Namen.
 *  - Je Einsatz (bzw. Einzeleintrag) nur einmal – dedupe_key.
 *  - Einträge älter als 72 h werden ignoriert (sind ohnehin Nacharbeit im Büro).
 */
import sql, { withTenant } from '@/lib/db';
import { LEAD_ROLES } from '@/lib/team-lead';
import { createNotifications, officeUserIds, type NewNotification } from '@/lib/notifications';

export function reminderHours(): number {
  const value = Number(process.env.NOTIFY_OPEN_SHIFT_HOURS);
  return Number.isFinite(value) && value >= 1 && value <= 24 ? value : 10;
}

interface OpenEntry {
  id: string;
  company_id: string;
  employee_id: string;
  employee_name: string;
  job_assignment_id: string | null;
  clock_in_datetime: Date;
  site: string;
  lead_ids: string[] | null;
}

export async function remindOpenShifts({ hours = reminderHours(), now = new Date() } = {}): Promise<number> {
  const entries = (await sql`
    SELECT te.id, te.company_id, te.employee_id::text AS employee_id, u.name AS employee_name,
           te.job_assignment_id, te.clock_in_datetime,
           coalesce(s.name, a.title, '—') AS site,
           (SELECT array_agg(l.id::text) FROM users l
             WHERE l.company_id = te.company_id
               AND l.id::text = ANY(a.assigned_worker_ids)
               AND l.role IN ${sql(LEAD_ROLES as unknown as string[])}) AS lead_ids
      FROM time_entries te
      JOIN users u ON u.id = te.employee_id
      LEFT JOIN job_assignments a ON a.id = te.job_assignment_id AND a.company_id = te.company_id
      LEFT JOIN job_sites s ON s.id = coalesce(te.job_site_id, a.job_site_id) AND s.company_id = te.company_id
     WHERE te.status = 'OPEN'
       AND te.clock_out_datetime IS NULL
       AND te.clock_in_datetime < ${new Date(now.getTime() - hours * 3_600_000)}
       AND te.clock_in_datetime > ${new Date(now.getTime() - 72 * 3_600_000)}
     ORDER BY te.clock_in_datetime
  `) as unknown as OpenEntry[];
  if (!entries.length) return 0;

  // Gruppe = Einsatz (ein Team) oder einzelner Eintrag ohne Einsatz.
  const groups = new Map<string, OpenEntry[]>();
  for (const e of entries) {
    const key = `${e.company_id}|${e.job_assignment_id ?? e.id}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const byCompany = new Map<string, NewNotification[]>();
  const officeGroups = new Map<string, Array<{ key: string; entries: OpenEntry[] }>>();
  for (const [key, list] of groups) {
    const first = list[0];
    const groupId = first.job_assignment_id ?? first.id;
    const since = new Date(Math.min(...list.map(e => new Date(e.clock_in_datetime).getTime())));
    const data = {
      site: first.site,
      since: since.toISOString(),
      hours: Math.floor((now.getTime() - since.getTime()) / 3_600_000),
    };
    const leads = first.lead_ids ?? [];
    const recipients = leads.length ? leads : [...new Set(list.map(e => e.employee_id))];
    const items = byCompany.get(first.company_id) ?? [];
    recipients.forEach(userId => items.push({
      userId, kind: 'clockout.reminder', data, link: '/tracking', dedupeKey: `clockout:${groupId}`,
    }));
    byCompany.set(first.company_id, items);
    officeGroups.set(first.company_id, [...(officeGroups.get(first.company_id) ?? []), { key, entries: list }]);
  }

  let created = 0;
  for (const [companyId, items] of byCompany) {
    created += await withTenant(companyId, async db => {
      const office = await officeUserIds(db, companyId);
      const officeItems: NewNotification[] = [];
      for (const { entries: list } of officeGroups.get(companyId) ?? []) {
        const first = list[0];
        const since = new Date(Math.min(...list.map(e => new Date(e.clock_in_datetime).getTime())));
        const data = {
          names: [...new Set(list.map(e => e.employee_name))].join(', '),
          site: first.site,
          since: since.toISOString(),
          hours: Math.floor((now.getTime() - since.getTime()) / 3_600_000),
        };
        // Wer selbst schon als Teamleiter/Mitarbeiter erinnert wird, braucht den Büro-Hinweis nicht.
        const reminded = new Set(items.filter(i => i.data.since === data.since && i.data.site === data.site).map(i => i.userId));
        office.filter(id => !reminded.has(id)).forEach(userId => officeItems.push({
          userId, kind: 'clockout.office', data, link: '/history',
          dedupeKey: `clockout-office:${first.job_assignment_id ?? first.id}`,
        }));
      }
      return createNotifications(db, companyId, [...items, ...officeItems]);
    });
  }
  return created;
}
