/**
 * GET  /api/auth/password/forgot — { enabled } (Link „Passwort vergessen?“ anzeigen?)
 * POST /api/auth/password/forgot { email } — Link per E-Mail. Antwortet immer
 * gleich, damit niemand herausfindet, welche Adressen registriert sind.
 * Begrenzt: 3 je Adresse und 10 je IP in 15 Minuten.
 */
import { NextRequest, NextResponse } from 'next/server';
import { mailEnabled } from '@/lib/mail';
import { requestPasswordReset } from '@/lib/account-mail';
import { takeRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getUserAgent } from '@/lib/request-context';
import { EMAIL_RE } from '@/lib/signup';

const WINDOW = 15 * 60 * 1000;
const SAME_ANSWER = { ok: true, message: 'Wenn es ein Konto mit dieser Adresse gibt, ist eine E-Mail unterwegs.' };

export async function GET() {
  return NextResponse.json({ enabled: mailEnabled() });
}

export async function POST(req: NextRequest) {
  if (!mailEnabled()) return NextResponse.json({ error: 'E-Mail-Versand ist auf diesem Server nicht eingerichtet.' }, { status: 503 });
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return NextResponse.json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, { status: 400 });

  const ip = getRequestIp(req) ?? 'unknown';
  if (!takeRateLimit(`forgot-ip:${ip}`, 10, WINDOW) || !takeRateLimit(`forgot-mail:${email}`, 3, WINDOW)) {
    return NextResponse.json({ error: 'Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.' }, { status: 429 });
  }

  try {
    const sent = await requestPasswordReset(email);
    await writeAuditLog({
      companyId: 'unknown', action: sent ? 'password.reset_requested' : 'password.reset_unknown',
      entityType: 'auth', entityId: email, ipAddress: ip, userAgent: getUserAgent(req),
    });
  } catch (error) {
    // Auch bei Versandfehlern dieselbe Antwort; Details nur im Log.
    console.error('[password/forgot]', error);
  }
  return NextResponse.json(SAME_ANSWER);
}
