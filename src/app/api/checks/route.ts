/**
 * Checklist of one visit (Leistungsnachweis).
 *
 * GET  /api/checks?assignmentId=…  — the visit's services and what is ticked off
 * POST /api/checks                 — tick off one service
 *   { assignmentId, serviceCode, status: 'started' | 'done' | 'not_possible' | 'open',
 *     reason? (required for not_possible), beforePhoto?, afterPhoto? (data URLs) }
 *   'started' saves a before photo without marking the work done.
 *   'open' removes the check again (a mis-tap). Photos not sent are kept.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { CheckError, assertVisitAccess, checklistItems, loadVisit, presentCheck } from '@/lib/checks';
import { MediaError, mediaIdFromUrl, storeDataUrl } from '@/lib/media';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';

function errorResponse(error: unknown, route: string) {
  if (error instanceof CheckError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof MediaError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error(`[${route}]`, error);
  return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.view')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });

  const assignmentId = req.nextUrl.searchParams.get('assignmentId');
  if (!assignmentId) return NextResponse.json({ error: 'assignmentId fehlt' }, { status: 400 });

  try {
    const result = await withTenant(session.companyId, async db => {
      const visit = await loadVisit(db, session.companyId, assignmentId);
      assertVisitAccess(session, visit);
      const checks = await db`
        SELECT * FROM service_checks WHERE job_assignment_id = ${visit.id} AND company_id = ${session.companyId}
      `;
      const byCode = new Map(checks.map(c => [c.service_code, presentCheck(c)]));
      return {
        assignment: {
          id: visit.id,
          date: visit.scheduled_date,
          title: visit.title,
          site: visit.job_site_id ? { id: visit.job_site_id, name: visit.site_name, address: visit.site_address, city: visit.site_city } : null,
        },
        items: checklistItems(visit).map(item => ({ ...item, check: byCode.get(item.code) ?? null })),
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'checks GET');
  }
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.create')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });

  try {
    const { assignmentId, serviceCode, status } = body as Record<string, unknown>;
    if (typeof assignmentId !== 'string' || typeof serviceCode !== 'string') throw new CheckError('Einsatz und Leistung fehlen');
    if (!['started', 'done', 'not_possible', 'open'].includes(String(status))) throw new CheckError('Ungültiger Status');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (status === 'not_possible' && reason.length < 3) throw new CheckError('Bitte kurz den Grund angeben');
    for (const photo of [body.beforePhoto, body.afterPhoto]) {
      if (photo != null && typeof photo !== 'string') throw new CheckError('Ungültiges Foto');
    }

    const { companyId } = session;
    const row = await withTenant(companyId, async db => {
      const visit = await loadVisit(db, companyId, assignmentId);
      assertVisitAccess(session, visit);
      const item = checklistItems(visit).find(i => i.code === serviceCode);
      if (!item) throw new CheckError('Diese Leistung gehört nicht zu diesem Einsatz');

      if (status === 'open') {
        await db`DELETE FROM service_checks WHERE job_assignment_id = ${visit.id} AND service_code = ${serviceCode} AND company_id = ${companyId}`;
        return null;
      }

      const store = async (dataUrl: unknown) =>
        typeof dataUrl === 'string' && dataUrl
          ? mediaIdFromUrl(await storeDataUrl(db, { companyId, userId: session.userId, kind: 'photo', dataUrl }))
          : null;
      const beforeId = await store(body.beforePhoto);
      const afterId = await store(body.afterPhoto);

      const [saved] = await db`
        INSERT INTO service_checks
          (company_id, job_assignment_id, job_site_id, service_code, service_label, status, reason,
           before_media_id, after_media_id, employee_id, employee_name)
        VALUES
          (${companyId}, ${visit.id}, ${visit.job_site_id}, ${serviceCode}, ${item.label}, ${status as string},
           ${status === 'not_possible' ? reason : null}, ${beforeId}, ${afterId}, ${session.userId}, ${session.name})
        ON CONFLICT (job_assignment_id, service_code) DO UPDATE SET
          -- Adding a before photo later never undoes a finished check.
          status          = CASE WHEN EXCLUDED.status = 'started' AND service_checks.status <> 'started'
                                 THEN service_checks.status ELSE EXCLUDED.status END,
          reason          = CASE WHEN EXCLUDED.status = 'started' THEN service_checks.reason ELSE EXCLUDED.reason END,
          before_media_id = coalesce(EXCLUDED.before_media_id, service_checks.before_media_id),
          after_media_id  = coalesce(EXCLUDED.after_media_id, service_checks.after_media_id),
          employee_id     = EXCLUDED.employee_id,
          employee_name   = EXCLUDED.employee_name,
          updated_at      = now()
        WHERE service_checks.company_id = ${companyId}
        RETURNING *
      `;
      return saved;
    });
    return NextResponse.json({ data: row ? presentCheck(row) : null });
  } catch (error) {
    return errorResponse(error, 'checks POST');
  }
}
