/**
 * GET /api/winter/sites — job sites with Winterdienst, with today's status.
 *
 * "Today" is the calendar day in Europe/Berlin. Each site carries its last
 * effective entry of the day (corrections replace, voided entries drop out).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { errorResponse } from '@/lib/winter-api';

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.view')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  try {
    const rows = await withTenant(session.companyId, db => db`
      SELECT s.id, s.name, s.address, s.city, s.postal_code, s.lat, s.lng,
             s.winter_areas, s.winter_notes,
             today.performed_at AS last_performed_at,
             today.activity     AS last_activity,
             today.employee_name AS last_employee_name,
             coalesce(today.count, 0)::int AS entries_today
        FROM job_sites s
        LEFT JOIN LATERAL (
          SELECT l.performed_at, l.activity, l.employee_name,
                 count(*) OVER () AS count
            FROM winter_service_logs l
           WHERE l.company_id = s.company_id
             AND l.job_site_id = s.id
             AND (l.performed_at AT TIME ZONE 'Europe/Berlin')::date = (now() AT TIME ZONE 'Europe/Berlin')::date
             AND NOT l.voided
             AND NOT EXISTS (SELECT 1 FROM winter_service_logs c WHERE c.corrects_log_id = l.id)
           ORDER BY l.performed_at DESC
           LIMIT 1
        ) today ON true
       WHERE s.company_id = ${session.companyId}
         AND s.winter_service_enabled
       ORDER BY s.city, s.name
    `);
    return NextResponse.json({ data: rows });
  } catch (error) {
    return errorResponse(error, 'winter/sites');
  }
}
