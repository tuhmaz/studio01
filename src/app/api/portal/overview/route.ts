/**
 * GET /api/portal/overview — Startseite des Kundenportals:
 * Hausverwaltung, Dienstleister (Kontakt) und alle eigenen Objekte mit
 * letztem/nächstem Einsatz, letztem Winterdienst und offenen Mängeln.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { berlinToday, portalErrorResponse, portalShowsWorkerNames, requirePortalSession } from '@/lib/portal';

export async function GET(req: NextRequest) {
  const session = await requirePortalSession(req);
  if (session instanceof NextResponse) return session;
  const { companyId, clientId } = session;
  const today = berlinToday();

  try {
    const result = await withTenant(companyId, async db => {
      const [client] = await db`SELECT id, name FROM clients WHERE id = ${clientId} AND company_id = ${companyId}`;
      if (!client) return null;
      const [provider] = await db`
        SELECT name, address, city, postal_code, phone, email, website FROM companies WHERE id = ${companyId}
      `;
      const sites = await db`
        SELECT s.id, s.name, s.address, s.city, s.postal_code, s.winter_service_enabled,
               (SELECT to_char(max(a.scheduled_date), 'YYYY-MM-DD') FROM job_assignments a
                 WHERE a.company_id = s.company_id AND a.job_site_id = s.id
                   AND a.is_plan_published AND a.status = 'COMPLETED') AS last_visit,
               (SELECT to_char(min(a.scheduled_date), 'YYYY-MM-DD') FROM job_assignments a
                 WHERE a.company_id = s.company_id AND a.job_site_id = s.id
                   AND a.is_plan_published AND a.status <> 'COMPLETED'
                   AND a.scheduled_date >= ${today}) AS next_visit,
               (SELECT max(w.performed_at) FROM winter_service_logs w
                 WHERE w.company_id = s.company_id AND w.job_site_id = s.id AND NOT w.voided) AS last_winter,
               (SELECT count(*)::int FROM defect_reports d
                  LEFT JOIN job_assignments a ON a.id = d.job_assignment_id
                 WHERE d.company_id = s.company_id AND d.job_site_id = s.id AND d.client_id = ${clientId}
                   AND d.status NOT IN ('done', 'rejected')
                   AND coalesce(a.status, '') <> 'COMPLETED') AS open_defects
          FROM job_sites s
         WHERE s.company_id = ${companyId} AND s.client_id = ${clientId}
         ORDER BY s.name
      `;
      return {
        client,
        provider,
        showWorkerNames: await portalShowsWorkerNames(db, companyId),
        sites: sites.map(s => ({
          id: s.id,
          name: s.name,
          address: s.address,
          city: s.city,
          postalCode: s.postal_code,
          winterServiceEnabled: s.winter_service_enabled,
          lastVisit: s.last_visit,
          nextVisit: s.next_visit,
          lastWinter: s.last_winter,
          openDefects: s.open_defects,
        })),
      };
    });
    if (!result) return NextResponse.json({ error: 'Zugang nicht gefunden' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return portalErrorResponse(error, 'portal/overview');
  }
}
