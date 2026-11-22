/**
 * POST /api/auth/password/reset { token, password }
 * Neues Passwort über den Link aus „Passwort vergessen“ oder der Einladung.
 * Danach: alle Geräte abgemeldet, dieses Gerät angemeldet.
 * Antwort: { role, next } — Ziel im Browser (/portal für Hausverwaltungen).
 */
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { createSession } from '@/lib/auth-server';
import { TokenError, setPasswordWithToken } from '@/lib/auth-tokens';
import { takeRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getUserAgent } from '@/lib/request-context';

export async function POST(req: NextRequest) {
  const ip = getRequestIp(req) ?? 'unknown';
  if (!takeRateLimit(`reset-ip:${ip}`, 20, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.' }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  try {
    const user = await setPasswordWithToken(body?.token, body?.password);
    const [row] = await sql`SELECT client_id FROM users WHERE id = ${user.userId}`;
    // Dieses Gerät gleich anmelden. Klappt das nicht, ist das Passwort trotzdem gesetzt.
    const signedIn = await createSession({
      userId: user.userId, companyId: user.companyId, role: user.role, name: user.name, email: user.email,
      clientId: row?.client_id ?? null,
    }).then(() => true, () => false);
    await writeAuditLog({
      companyId: user.companyId, action: 'password.set_by_link', entityType: 'users', entityId: user.userId,
      ipAddress: ip, userAgent: getUserAgent(req),
    });
    return NextResponse.json({ data: { role: user.role, email: user.email, signedIn, next: user.role === 'CLIENT' ? '/portal' : '/dashboard' } });
  } catch (error) {
    if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[password/reset]', error);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
