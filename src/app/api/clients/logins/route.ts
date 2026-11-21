/**
 * Portal-Zugänge einer Hausverwaltung — nur ADMIN (users.create / users.delete).
 *
 * POST   /api/clients/logins          — { clientId, name, email, password }
 * DELETE /api/clients/logins?userId=… — Zugang löschen (wirkt sofort: die
 *                                       Sitzung wird beim nächsten Aufruf abgewiesen)
 */
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import sql, { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { writeAuditLog } from '@/lib/audit';
import { PortalError, cleanText, portalErrorResponse } from '@/lib/portal';
import { isValidEmail } from '@/lib/clients';

const MIN_PASSWORD_LENGTH = 12;

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'clients.manage') || !hasPermission(session, 'users.create')) {
    return NextResponse.json({ error: 'Nur Administratoren dürfen Portal-Zugänge anlegen.' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => { throw new PortalError('Ungültige Anfrage'); });
    const clientId = typeof body.clientId === 'string' ? body.clientId : '';
    const name = cleanText(body.name, 200);
    const email = (cleanText(body.email, 200) ?? '').toLowerCase();
    const password = String(body.password ?? '');
    if (!clientId || !name || !email) throw new PortalError('Name und E-Mail sind erforderlich.');
    if (!isValidEmail(email)) throw new PortalError('Bitte eine gültige E-Mail-Adresse eingeben.');
    if (password.length < MIN_PASSWORD_LENGTH) throw new PortalError(`Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`);

    // E-Mails sind systemweit eindeutig (Login über die E-Mail).
    const [existing] = await sql`SELECT id FROM public.users WHERE lower(email) = ${email} LIMIT 1`;
    if (existing) throw new PortalError('Diese E-Mail-Adresse ist bereits registriert.', 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await withTenant(session.companyId, async db => {
      const [client] = await db`SELECT id FROM clients WHERE id = ${clientId} AND company_id = ${session.companyId}`;
      if (!client) throw new PortalError('Hausverwaltung nicht gefunden', 404);
      const [row] = await db`
        INSERT INTO users (company_id, name, email, password_hash, role, client_id)
        VALUES (${session.companyId}, ${name}, ${email}, ${passwordHash}, 'CLIENT', ${clientId})
        RETURNING id, name, email
      `;
      return row;
    });

    await writeAuditLog({
      session, action: 'client_login.created', entityType: 'users', entityId: user.id,
      newValue: { clientId, email },
      ipAddress: getRequestIp(req), userAgent: getUserAgent(req),
    });
    return NextResponse.json({ id: user.id }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' }, { status: 409 });
    }
    return portalErrorResponse(error, 'clients/logins POST');
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'clients.manage') || !hasPermission(session, 'users.delete')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId fehlt' }, { status: 400 });

  try {
    const deleted = await withTenant(session.companyId, async db => {
      const rows = await db`
        DELETE FROM users
         WHERE id::text = ${userId} AND company_id = ${session.companyId} AND role = 'CLIENT'
        RETURNING email
      `;
      return rows[0] ?? null;
    });
    if (!deleted) throw new PortalError('Zugang nicht gefunden', 404);
    await writeAuditLog({
      session, action: 'client_login.deleted', entityType: 'users', entityId: userId,
      oldValue: { email: deleted.email },
      ipAddress: getRequestIp(req), userAgent: getUserAgent(req),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return portalErrorResponse(error, 'clients/logins DELETE');
  }
}
