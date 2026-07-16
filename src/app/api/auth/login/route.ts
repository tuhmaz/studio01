import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession } from '@/lib/auth-server';
import { getRequestIp, getUserAgent } from '@/lib/request-context';
import { writeAuditLog } from '@/lib/audit';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

declare global {
  // eslint-disable-next-line no-var
  var __loginAttempts: Map<string, { count: number; resetAt: number }> | undefined;
}

const attempts = globalThis.__loginAttempts ?? (globalThis.__loginAttempts = new Map());

function clientKey(req: NextRequest, email: string): string {
  return `${getRequestIp(req) ?? 'unknown'}:${email.toLowerCase().trim()}`;
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
        action: 'login.rate_limited',
        entityType: 'auth',
        entityId: normalizedEmail,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' }, { status: 429 });
    }

    const [user] = await sql`
      SELECT id, company_id, name, email, password_hash, role, can_login_with_password
      FROM public.users
      WHERE email = ${normalizedEmail}
      LIMIT 1
    `;

    const valid = user?.password_hash && user.can_login_with_password !== false
      ? await bcrypt.compare(password, user.password_hash)
      : false;
    if (!user || !valid) {
      recordFailedAttempt(key);
      await writeAuditLog({
        companyId: user?.company_id ?? 'unknown',
        action: 'login.failed',
        entityType: 'auth',
        entityId: normalizedEmail,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ error: 'Ungültige Anmeldedaten' }, { status: 401 });
    }

    clearAttempts(key);

    await sql`UPDATE public.users SET last_login = NOW() WHERE id = ${user.id}`;

    await createSession({
      userId:    user.id,
      companyId: user.company_id,
      role:      user.role,
      name:      user.name,
      email:     user.email,
    });

    await writeAuditLog({
      companyId: user.company_id,
      action: 'login.success',
      entityType: 'auth',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      id:        user.id,
      companyId: user.company_id,
      role:      user.role,
      name:      user.name,
      email:     user.email,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
