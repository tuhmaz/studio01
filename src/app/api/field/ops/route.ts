/**
 * POST /api/field/ops — ein Arbeitsvorgang aus der Mitarbeiter-App.
 *
 *   { op: 'clock_in',  assignmentId, requestId, at?, lat?, lng?, gpsVerified? }
 *   { op: 'clock_out', assignmentId, requestId, at?, travelBonusMinutes? }
 *   { op: 'note',      id, assignmentId, timeEntryId?, type, content, duration?, at? }
 *
 * Offline-fähig: `at` ist der Zeitpunkt auf dem Gerät (≤ 72 h zurück),
 * Wiederholungen sind ungefährlich. Fehler 4xx bedeuten "so nicht speicherbar"
 * und werden in der App angezeigt; Netzfehler führen zu einem späteren Versuch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { MediaError } from '@/lib/media';
import { FieldError, addNote, clockIn, clockOut } from '@/lib/field-ops';

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });

  try {
    switch (body.op) {
      case 'clock_in':
      case 'clock_out': {
        if (!hasPermission(session, 'time_entries.manage')) throw new FieldError('Keine Berechtigung', 403);
        const result = await withTenant<Record<string, unknown>>(session.companyId, db =>
          body.op === 'clock_in' ? clockIn(db, session, body) : clockOut(db, session, body));
        return NextResponse.json({ data: result });
      }
      case 'note': {
        if (!hasPermission(session, 'work_logs.create')) throw new FieldError('Keine Berechtigung', 403);
        const row = await withTenant(session.companyId, db => addNote(db, session, body));
        return NextResponse.json({ data: row });
      }
      default:
        throw new FieldError('Unbekannter Vorgang');
    }
  } catch (error) {
    if (error instanceof FieldError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof MediaError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[field/ops]', error);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
