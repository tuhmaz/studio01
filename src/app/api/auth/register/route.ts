/**
 * GET  /api/auth/register — { enabled, termsUrl, privacyUrl } for the login and sign-up pages.
 * POST /api/auth/register — creates a company and its first ADMIN, then signs in.
 *
 * Only available when ALLOW_SIGNUP=true. Limited to 5 sign-ups per IP and hour.
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession } from '@/lib/auth-server';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getUserAgent } from '@/lib/request-context';
import { companyIdFromName, isSignupEnabled, validateSignup } from '@/lib/signup';
import { mailEnabled } from '@/lib/mail';
import { sendVerification } from '@/lib/account-mail';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_SIGNUPS_PER_IP = 5;

declare global {
  // eslint-disable-next-line no-var
  var __signupAttempts: Map<string, { count: number; resetAt: number }> | undefined;
}
const attempts = globalThis.__signupAttempts ?? (globalThis.__signupAttempts = new Map());

function takeSignupSlot(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_SIGNUPS_PER_IP) return false;
  entry.count += 1;
  return true;
}

export async function GET() {
  return NextResponse.json({
    enabled: isSignupEnabled(),
    termsUrl: process.env.TERMS_URL || null,
    privacyUrl: process.env.PRIVACY_URL || null,
  });
}

export async function POST(req: NextRequest) {
  if (!isSignupEnabled()) {
    return NextResponse.json({ error: 'Registrierung ist auf diesem Server nicht freigeschaltet.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }
  const problem = validateSignup(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const ipAddress = getRequestIp(req);
  const userAgent = getUserAgent(req);
  if (!takeSignupSlot(ipAddress ?? 'unknown')) {
    return NextResponse.json({ error: 'Zu viele Registrierungen. Bitte später erneut versuchen.' }, { status: 429 });
  }

  const companyName = String(body.companyName).trim();
  const name = String(body.name).trim();
  const email = String(body.email).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(String(body.password), 12);
  const companyId = companyIdFromName(companyName);

  let user: { id: string };
  try {
    user = await sql.begin(async tx => {
      await tx`SELECT set_config('app.company_id', ${companyId}, true)`;
      await tx`INSERT INTO companies (id, name, email) VALUES (${companyId}, ${companyName}, ${email})`;
      const [created] = await tx`
        INSERT INTO users (company_id, name, email, password_hash, role, contract_type, hourly_rate)
        VALUES (${companyId}, ${name}, ${email}, ${passwordHash}, 'ADMIN', 'VOLLZEIT', 0)
        RETURNING id
      `;
      return created as { id: string };
    }) as { id: string };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      // Same answer as a taken email elsewhere; the address is already a login.
      return NextResponse.json({ error: 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte anmelden.' }, { status: 409 });
    }
    console.error('[auth/register]', error);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }

  await writeAuditLog({
    companyId,
    action: 'company.registered',
    entityType: 'companies',
    entityId: companyId,
    newValue: { companyName, adminUserId: user.id, termsAcceptedAt: new Date().toISOString() },
    ipAddress,
    userAgent,
  });

  await createSession({ userId: user.id, companyId, role: 'ADMIN', name, email });
  // Bestätigung der Adresse anfordern (die Anmeldung funktioniert schon vorher).
  if (mailEnabled()) {
    await sendVerification(user.id).catch(error => console.error('[auth/register] verify mail', error));
  }
  return NextResponse.json({ companyId, userId: user.id }, { status: 201 });
}
