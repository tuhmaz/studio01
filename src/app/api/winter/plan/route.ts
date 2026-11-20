/**
 * POST /api/winter/plan — creates the day's Winterdienst tasks in the Tourplan.
 *
 * Body: { date?: "YYYY-MM-DD" (default: tomorrow), force?: boolean, dryRun?: boolean }
 * Without force, tasks are only created where the DWD forecast shows frost or
 * snow. dryRun returns the forecast per site without creating anything.
 * Requires winter.manage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';
import { hasPermission } from '@/lib/permissions';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { errorResponse } from '@/lib/winter-api';
import { addDays, berlinDate, isPlanDate, planWinterDay } from '@/lib/winter-plan';

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'winter.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const today = berlinDate();
  const date = body?.date ?? addDays(today, 1);
  if (!isPlanDate(date)) return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
  if (date < today || date > addDays(today, 7)) {
    return NextResponse.json({ error: 'Planung nur für heute bis in 7 Tagen möglich' }, { status: 400 });
  }

  try {
    const result = await planWinterDay({
      companyId: session.companyId,
      date,
      force: body?.force === true,
      dryRun: body?.dryRun === true,
      createdBy: session.userId,
    });
    if (!body?.dryRun && result.created > 0) {
      await writeAuditLog({
        session,
        action: 'winter.tasks_planned',
        entityType: 'job_assignments',
        entityId: date,
        newValue: { created: result.created, force: body?.force === true },
        ipAddress: getRequestIp(req),
        userAgent: getUserAgent(req),
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'winter/plan');
  }
}
