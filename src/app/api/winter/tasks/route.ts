/**
 * GET /api/winter/tasks?from=YYYY-MM-DD&to=YYYY-MM-DD[&siteId=…]
 *
 * Winterdienst-Aufgaben aus dem Tourplan mit Protokoll-Status
 * (documented | missing | pending). Standard: die letzten 7 Tage bis morgen.
 * Mitarbeiter sehen nur Aufgaben, denen sie zugeteilt sind.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission, normalizeRole } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { WinterError } from '@/lib/winter';
import { errorResponse } from '@/lib/winter-api';
import { berlinDate } from '@/lib/winter-plan';
import { isIsoDate, listWinterTasks } from '@/lib/winter-tasks';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 92;

function shift(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.view')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });

  try {
    const params = req.nextUrl.searchParams;
    const today = berlinDate();
    const from = params.get('from') ?? shift(today, -6);
    const to = params.get('to') ?? shift(today, 1);
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new WinterError('Ungültiger Zeitraum');
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_RANGE_DAYS) throw new WinterError('Zeitraum höchstens 3 Monate');

    const tasks = await withTenant(session.companyId, db => listWinterTasks(db, session.companyId, from, to, {
      siteId: params.get('siteId') ?? undefined,
      workerId: normalizeRole(session.role) === 'WORKER' ? session.userId : undefined,
    }));
    return NextResponse.json({
      from,
      to,
      data: tasks,
      missing: tasks.filter(t => t.protocol === 'missing').length,
    });
  } catch (error) {
    return errorResponse(error, 'winter/tasks');
  }
}
