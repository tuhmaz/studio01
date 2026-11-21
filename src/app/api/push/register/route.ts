/**
 * Push-Token eines Geräts (Expo).
 *
 * POST   /api/push/register { token, platform: 'android'|'ios', lang } — anmelden/aktualisieren.
 *        Ein Token gehört immer genau einem Benutzer: meldet sich jemand anderes
 *        auf dem Gerät an, wird es umgeschrieben.
 * DELETE /api/push/register { token } — beim Abmelden.
 */
import { NextRequest, NextResponse } from 'next/server';
import sql, { withTenant } from '@/lib/db';
import { getRequestSession } from '@/lib/request-context';
import { notifyLang } from '@/lib/notification-texts';

const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  const body = await readBody(req);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'Ungültiges Push-Token' }, { status: 400 });
  const platform = body?.platform === 'ios' ? 'ios' : 'android';
  const lang = notifyLang(body?.lang);

  // Gerät wechselt den Benutzer (ggf. die Firma): alte Zuordnung plattformweit lösen.
  await sql`DELETE FROM push_tokens WHERE token = ${token} AND (user_id <> ${session.userId} OR company_id <> ${session.companyId})`;
  await withTenant(session.companyId, db => db`
    INSERT INTO push_tokens (token, company_id, user_id, platform, lang)
    VALUES (${token}, ${session.companyId}, ${session.userId}, ${platform}, ${lang})
    ON CONFLICT (token) DO UPDATE SET platform = EXCLUDED.platform, lang = EXCLUDED.lang, last_seen_at = NOW()
  `);
  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  const body = await readBody(req);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'token erforderlich' }, { status: 400 });
  await withTenant(session.companyId, db => db`
    DELETE FROM push_tokens WHERE token = ${token} AND user_id = ${session.userId}
  `);
  return NextResponse.json({ data: { ok: true } });
}
