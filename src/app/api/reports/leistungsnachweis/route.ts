/**
 * GET /api/reports/leistungsnachweis?siteId=…&month=YYYY-MM
 *
 * Monthly proof of service for one site: every published visit of the month,
 * the services planned for it, and what was ticked off on site (by whom,
 * when, with before/after photos). Totals give the compliance rate:
 * done / planned. Requires reports.export.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { checklistCodes, serviceLabel, type SiteService } from '@/lib/services';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'reports.export')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });

  const siteId = req.nextUrl.searchParams.get('siteId');
  const month = req.nextUrl.searchParams.get('month') ?? '';
  const match = MONTH_RE.exec(month);
  if (!siteId || !match) return NextResponse.json({ error: 'siteId und month (YYYY-MM) erforderlich' }, { status: 400 });
  const first = `${month}-01`;
  const next = Number(match[2]) === 12 ? `${Number(match[1]) + 1}-01-01` : `${match[1]}-${String(Number(match[2]) + 1).padStart(2, '0')}-01`;

  try {
    const { companyId } = session;
    const result = await withTenant(companyId, async db => {
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
           AND a.scheduled_date >= ${first} AND a.scheduled_date < ${next}
         ORDER BY a.scheduled_date, a.id
      `;
      const checks = visits.length
        ? await db`
            SELECT job_assignment_id, service_code, status, reason, checked_at, employee_name, before_media_id, after_media_id
              FROM service_checks
             WHERE company_id = ${companyId} AND job_assignment_id = ANY(${db.array(visits.map(v => v.id))}::text[])
          `
        : [];
      const checkMap = new Map(checks.map(c => [`${c.job_assignment_id}|${c.service_code}`, c]));
      const services = site.services as Record<string, SiteService> | null;

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
            return {
              code,
              label: serviceLabel(code, services),
              // "started" (only a before photo) is not a result yet: still open.
              status: (c?.status === 'done' || c?.status === 'not_possible' ? c.status : 'open') as 'done' | 'not_possible' | 'open',
              reason: c?.reason ?? null,
              checkedAt: c && c.status !== 'started' ? c.checked_at : null,
              employeeName: c && c.status !== 'started' ? c.employee_name : null,
              beforeUrl: c?.before_media_id ? `/api/media/${c.before_media_id}` : null,
              afterUrl: c?.after_media_id ? `/api/media/${c.after_media_id}` : null,
            };
          });
          return { id: v.id, date: v.date, title: v.title, status: v.status, workers: v.workers as string[], items };
        })
        .filter(v => v.items.length > 0);

      return {
        site: { id: site.id, name: site.name, address: site.address, city: site.city, postalCode: site.postal_code },
        company,
        month,
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
    });
    if (!result) return NextResponse.json({ error: 'Objekt nicht gefunden' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[reports/leistungsnachweis]', error);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
