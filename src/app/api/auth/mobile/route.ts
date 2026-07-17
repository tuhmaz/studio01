/**
 * Mobile Authentication Endpoint
 * POST /api/auth/mobile - login, returns JWT in response body (no cookie)
 * GET  /api/auth/mobile - verify Bearer token, returns user profile
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createTokenString, verifyTokenString, revokeUserSessions } from '@/lib/auth-server';
import { writeAuditLog } from '@/lib/audit';
import sql from '@/lib/db';
import { getRequestIp, getUserAgent } from '@/lib/request-context';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

declare global {
  // eslint-disable-next-line no-var
  var __mobileLoginAttempts: Map<string, { count: number; resetAt: number }> | undefined;
}

const attempts = globalThis.__mobileLoginAttempts ?? (globalThis.__mobileLoginAttempts = new Map());

function clientKey(req: NextRequest, email: string): string {
  return `${getRequestIp(req) ?? 'unknown'}:mobile:${email.toLowerCase().trim()}`;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearAttempts(key: string): void {
  attempts.delete(key);
}

export async function POST(req: NextRequest) {
  const ipAddress = getRequestIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { email, password } = await req.json();
    const normalizedEmail = String(email ?? '').toLowerCase().trim();
    const key = clientKey(req, normalizedEmail);

    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: 'E-Mail und Passwort erforderlich' }, { status: 400 });
    }

    if (isRateLimited(key)) {
      await writeAuditLog({
        companyId: 'unknown',
        action: 'mobile_login.rate_limited',
        entityType: 'auth',
        entityId: normalizedEmail,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ error: 'Zu viele Anmeldeversuche. Bitte spaeter erneut versuchen.' }, { status: 429 });
    }

    const [user] = await sql`
      SELECT u.id, u.company_id, u.name, u.email, u.password_hash, u.role,
             u.can_login_with_password, c.name as company_name
        FROM public.users u
        JOIN public.companies c ON c.id = u.company_id
       WHERE u.email = ${normalizedEmail}
       LIMIT 1
    `;

    const valid = user?.password_hash && user.can_login_with_password !== false
      ? await bcrypt.compare(password, user.password_hash)
      : false;
    if (!user || !valid) {
      recordFailedAttempt(key);
      await writeAuditLog({
        companyId: user?.company_id ?? 'unknown',
        action: 'mobile_login.failed',
        entityType: 'auth',
        entityId: normalizedEmail,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ error: 'Ungueltige Anmeldedaten' }, { status: 401 });
    }

    clearAttempts(key);
    await sql`UPDATE public.users SET last_login = NOW() WHERE id = ${user.id}`;

    const token = await createTokenString({
      userId: user.id,
      companyId: user.company_id,
      role: user.role,
      name: user.name,
      email: user.email,
    });

    await writeAuditLog({
      companyId: user.company_id,
      action: 'mobile_login.success',
      entityType: 'auth',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        companyName: user.company_name,
      },
    });
  } catch (err) {
    console.error('[mobile/login]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token) {
      return NextResponse.json({ error: 'Kein Token' }, { status: 401 });
    }

    const session = await verifyTokenString(token);
    if (!session) {
      return NextResponse.json({ error: 'Token ungueltig oder abgelaufen' }, { status: 401 });
    }

    return NextResponse.json({
      userId: session.userId,
      companyId: session.companyId,
      role: session.role,
      name: session.name,
      email: session.email,
    });
  } catch (err) {
    console.error('[mobile/me]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}

/**
 * DELETE /api/auth/mobile - logout: server-side revocation of the bearer token
 * (and all other sessions for this user). The client also discards its token.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token) {
      return NextResponse.json({ error: 'Kein Token' }, { status: 401 });
    }

    const session = await verifyTokenString(token);
    if (!session) {
      // Token already invalid — nothing to revoke, treat as success.
      return NextResponse.json({ ok: true });
    }

    await revokeUserSessions(session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[mobile/logout]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
