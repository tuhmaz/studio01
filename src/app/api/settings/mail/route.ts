/**
 * E-Mail-Versand der Installation (Einstellungen).
 * GET  — { enabled, from, host, appUrl } (ohne Passwort)
 * POST — Testmail an die eigene Adresse. Recht: settings.manage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { appUrl, mailEnabled, mailFrom, sendMail, testMail } from '@/lib/mail';
import { takeRateLimit } from '@/lib/rate-limit';

async function guard(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return { error: NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 }) };
  if (!hasPermission(session, 'settings.manage')) return { error: NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }) };
  return { session };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (!g.session) return g.error;
  return NextResponse.json({
    data: {
      enabled: mailEnabled(),
      smtpConfigured: !!process.env.SMTP_HOST,
      host: process.env.SMTP_HOST ? `${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}` : null,
      from: process.env.SMTP_HOST ? mailFrom() : null,
      appUrl: appUrl(),
    },
  });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (!g.session) return g.error;
  if (!mailEnabled()) return NextResponse.json({ error: 'E-Mail-Versand ist nicht eingerichtet.' }, { status: 503 });
  if (!takeRateLimit(`mail-test:${g.session.userId}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Bitte etwas warten.' }, { status: 429 });
  }
  try {
    await sendMail(testMail(g.session.email));
    return NextResponse.json({ data: { sent: true, to: g.session.email } });
  } catch (error: any) {
    // Fehlermeldung des SMTP-Servers hilft beim Einrichten (enthält kein Passwort).
    return NextResponse.json({ error: `Versand fehlgeschlagen: ${String(error?.message ?? error).slice(0, 300)}` }, { status: 502 });
  }
}
