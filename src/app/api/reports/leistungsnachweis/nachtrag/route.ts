/**
 * Nachtrag im Leistungsnachweis (siehe src/lib/leistungsnachweis-nachtrag.ts).
 *
 * POST   { siteId, month: 'YYYY-MM', assignmentId? } — offene Leistungen
 *        vergangener Einsätze als „erledigt (Nachtrag Büro)“ eintragen;
 *        ohne assignmentId für den ganzen Monat.
 * DELETE { assignmentId } — Nachträge eines Einsatzes zurücknehmen.
 * Nur Verwaltung (time_entries.approve: ADMIN, MANAGER).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { NachtragError, nachtragZuruecknehmen, nachtragen } from '@/lib/leistungsnachweis-nachtrag';

async function guard(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return { ok: false as const, error: NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 }) };
  if (!hasPermission(session, 'time_entries.approve')) {
    return { ok: false as const, error: NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }) };
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return { ok: false as const, error: NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 }) };
  return { ok: true as const, session, body: body as Record<string, unknown> };
}

function fail(error: unknown) {
  if (error instanceof NachtragError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[leistungsnachweis/nachtrag]', error);
  return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (!g.ok) return g.error;
  const { session, body } = g;
  if (typeof body.siteId !== 'string' || typeof body.month !== 'string') {
    return NextResponse.json({ error: 'siteId und month erforderlich' }, { status: 400 });
  }
  try {
    const result = await withTenant(session.companyId, db => nachtragen(db, session, {
      siteId: body.siteId as string,
      month: body.month as string,
      assignmentId: typeof body.assignmentId === 'string' ? body.assignmentId : null,
    }));
    return NextResponse.json({ data: result });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req);
  if (!g.ok) return g.error;
  const { session, body } = g;
  if (typeof body.assignmentId !== 'string') return NextResponse.json({ error: 'assignmentId erforderlich' }, { status: 400 });
  try {
    const removed = await withTenant(session.companyId, db => nachtragZuruecknehmen(db, session.companyId, body.assignmentId as string));
    return NextResponse.json({ data: { removed } });
  } catch (error) {
    return fail(error);
  }
}
