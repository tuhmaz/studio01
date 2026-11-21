/**
 * GET /api/winter/sites — job sites with Winterdienst, with today's status.
 *
 * "Today" is the calendar day in Europe/Berlin. Each site carries its last
 * effective entry of the day (corrections replace, voided entries drop out)
 * and today's Winterdienst task from the Tourplan, if one is planned.
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
             coalesce(today.count, 0)::int AS entries_today,
             task.status  AS task_status_today,
             task.workers AS task_workers_today
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
        -- Heutige Winterdienst-Aufgabe aus Tourplan/Einsatzplanung (falls geplant).
        LEFT JOIN LATERAL (
          SELECT a.status,
                 coalesce((SELECT array_agg(u.name ORDER BY u.name) FROM users u
                            WHERE u.company_id = a.company_id AND u.id::text = ANY(a.assigned_worker_ids)), '{}') AS workers
            FROM job_assignments a
           WHERE a.company_id = s.company_id
             AND a.job_site_id = s.id
             AND a.scheduled_date = (now() AT TIME ZONE 'Europe/Berlin')::date
             AND 'WINTERDIENST' = ANY(a.categories)
           ORDER BY (a.status = 'COMPLETED') DESC, a.id
           LIMIT 1
        ) task ON true
       WHERE s.company_id = ${session.companyId}
         AND s.winter_service_enabled
       ORDER BY s.city, s.name
    `);
    return NextResponse.json({ data: rows });
  } catch (error) {
    return errorResponse(error, 'winter/sites');
  }
}
