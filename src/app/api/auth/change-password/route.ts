import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession, getSession } from '@/lib/auth-server';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getUserAgent } from '@/lib/request-context';

const MIN_PASSWORD_LENGTH = 12;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (typeof currentPassword !== 'string' || !currentPassword) {
    return NextResponse.json({ error: 'Aktuelles Passwort erforderlich' }, { status: 400 });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen erforderlich` }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: 'Das neue Passwort muss sich vom aktuellen Passwort unterscheiden' }, { status: 400 });
  }

  const [user] = await sql`
    SELECT id, company_id, name, email, role, password_hash, can_login_with_password
      FROM public.users
     WHERE id = ${session.userId}
     LIMIT 1
  `;
  if (!user?.password_hash || user.can_login_with_password === false) {
    return NextResponse.json({ error: 'Passwort-Login ist für diesen Benutzer nicht aktiv' }, { status: 403 });
  }

  const validCurrentPassword = await bcrypt.compare(currentPassword, user.password_hash);
  if (!validCurrentPassword) {
    await writeAuditLog({
      session,
      action: 'password_change.failed',
      entityType: 'users',
      entityId: session.userId,
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
    });
    return NextResponse.json({ error: 'Aktuelles Passwort ist falsch' }, { status: 401 });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  const [updatedUser] = await sql`
    UPDATE public.users
       SET password_hash = ${hash},
           password_changed_at = date_trunc('second', NOW())
     WHERE id = ${session.userId}
     RETURNING id, company_id, name, email, role
  `;

  await createSession({
    userId: updatedUser.id,
    companyId: updatedUser.company_id,
    role: updatedUser.role,
    name: updatedUser.name,
    email: updatedUser.email,
  });

  await writeAuditLog({
    session: {
      userId: updatedUser.id,
      companyId: updatedUser.company_id,
      role: updatedUser.role,
      name: updatedUser.name,
      email: updatedUser.email,
    },
    action: 'password_change.success',
    entityType: 'users',
    entityId: updatedUser.id,
    ipAddress: getRequestIp(req),
    userAgent: getUserAgent(req),
  });

  return NextResponse.json({ ok: true });
}
