/**
 * POST /api/import — Excel/CSV-Import (Zuordnung und Lesen der Datei im Browser).
 *
 * Body: { type: 'sites' | 'users', rows: Record<string,string>[], dryRun?: boolean }
 *   dryRun: true  → nur prüfen (Vorschau: neu / übersprungen / Fehler je Zeile)
 *   dryRun: false → anlegen (Mitarbeiter: Antwort enthält die Startpasswörter, einmalig)
 *
 * Rechte: Objekte = job_sites.manage, Mitarbeiter = users.create.
 */
import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { ImportError, importSites, importUsers } from '@/lib/import/run';
import type { ImportRow } from '@/lib/import/fields';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });

  let body: { type?: unknown; rows?: unknown; dryRun?: unknown; sendInvites?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }
  const type = body.type;
  if (type !== 'sites' && type !== 'users') return NextResponse.json({ error: 'type muss sites oder users sein' }, { status: 400 });
  if (!hasPermission(session, type === 'sites' ? 'job_sites.manage' : 'users.create')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }
  const rows = Array.isArray(body.rows)
    ? (body.rows as unknown[]).map(r => Object.fromEntries(
        Object.entries((r ?? {}) as Record<string, unknown>)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 500)]),
      ) as ImportRow)
    : [];
  const dryRun = body.dryRun !== false;

  try {
    const result = type === 'sites'
      ? await importSites(session, rows, { dryRun })
      : await importUsers(session, rows, { dryRun, sendInvites: body.sendInvites === true });
    if (!dryRun && result.created > 0) {
      await writeAuditLog({
        session,
        action: type === 'sites' ? 'job_sites.imported' : 'users.imported',
        entityType: type === 'sites' ? 'job_sites' : 'users',
        newValue: { created: result.created, skipped: result.counts.skip, errors: result.counts.error },
        ipAddress: getRequestIp(req),
        userAgent: getUserAgent(req),
      });
    }
    return NextResponse.json({ data: result });
  } catch (error: any) {
    if (error instanceof ImportError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Ein Datensatz wurde gleichzeitig angelegt. Bitte Vorschau neu laden.' }, { status: 409 });
    }
    console.error('[import]', error);
    return NextResponse.json({ error: 'Serverfehler beim Import' }, { status: 500 });
  }
}
