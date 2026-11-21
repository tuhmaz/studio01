/**
 * Eigene Benachrichtigungen.
 *
 * GET  /api/notifications[?lang=ar&limit=50] — neueste zuerst, Text in der Sprache
 *      (App: Sprache der App; Web: Deutsch) + Anzahl ungelesen.
 * POST /api/notifications { ids?: string[], all?: true } — als gelesen markieren.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { getRequestSession } from '@/lib/request-context';
import { notifyLang, renderNotification } from '@/lib/notification-texts';

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  const lang = notifyLang(req.nextUrl.searchParams.get('lang'));
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 50, 1), 200);

  const { rows, unread } = await withTenant(session.companyId, async db => {
    const rows = await db`
      SELECT id, kind, data, link, read_at, created_at FROM notifications
       WHERE company_id = ${session.companyId} AND user_id = ${session.userId}
       ORDER BY created_at DESC
       LIMIT ${limit}
    `;
    const [{ n }] = await db`
      SELECT count(*)::int AS n FROM notifications
       WHERE company_id = ${session.companyId} AND user_id = ${session.userId} AND read_at IS NULL
    `;
    return { rows, unread: n as number };
  });

  return NextResponse.json({
    unread,
    data: rows.map(r => ({
      id: r.id,
      kind: r.kind,
      link: r.link,
      read: !!r.read_at,
      created_at: r.created_at,
      ...renderNotification(r.kind as string, r.data as Record<string, unknown>, lang),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  let body: { ids?: unknown; all?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
  if (!ids.length && body.all !== true) return NextResponse.json({ error: 'ids oder all erforderlich' }, { status: 400 });

  const updated = await withTenant(session.companyId, db => db`
    UPDATE notifications SET read_at = NOW()
     WHERE company_id = ${session.companyId} AND user_id = ${session.userId} AND read_at IS NULL
       ${body.all === true ? db`` : db`AND id = ANY(${db.array(ids)}::text[])`}
    RETURNING id
  `);
  return NextResponse.json({ data: { updated: updated.length } });
}
