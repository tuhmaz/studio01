/**
 * POST /api/users/invite { userId } — Einladung (erneut) senden: der
 * Mitarbeiter legt über den Link sein eigenes Passwort fest. Ein älterer
 * Einladungslink wird damit ungültig. Recht: users.create (Admin).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { MailDisabledError, sendInvite } from '@/lib/account-mail';
import { writeAuditLog } from '@/lib/audit';
import { takeRateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'users.create')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: 'userId erforderlich' }, { status: 400 });

  const [user] = await withTenant(session.companyId, db => db`
    SELECT id, email, role FROM users WHERE id = ${userId} AND company_id = ${session.companyId}
  `);
  if (!user) return NextResponse.json({ error: 'Mitarbeiter nicht gefunden' }, { status: 404 });
  if (user.role === 'CLIENT' && !hasPermission(session, 'clients.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }
  if (!takeRateLimit(`invite:${userId}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Zu viele Einladungen für diesen Mitarbeiter. Bitte später erneut versuchen.' }, { status: 429 });
  }

  try {
    await sendInvite(userId, { userId: session.userId, name: session.name });
  } catch (error) {
    if (error instanceof MailDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error('[users/invite]', error);
    return NextResponse.json({ error: 'E-Mail konnte nicht gesendet werden. SMTP-Einstellungen prüfen.' }, { status: 502 });
  }
  await writeAuditLog({
    session, action: 'user.invited', entityType: 'users', entityId: userId,
    ipAddress: getRequestIp(req), userAgent: getUserAgent(req),
  });
  return NextResponse.json({ data: { sent: true, email: user.email } });
}
