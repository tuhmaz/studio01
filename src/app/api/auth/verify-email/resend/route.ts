/** POST /api/auth/verify-email/resend — Bestätigungs-Mail an die eigene Adresse (3 pro Stunde). */
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getRequestSession } from '@/lib/request-context';
import { MailDisabledError, sendVerification } from '@/lib/account-mail';
import { takeRateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req, { allowClient: true });
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  const [user] = await sql`SELECT email_verified_at FROM users WHERE id = ${session.userId}`;
  if (user?.email_verified_at) return NextResponse.json({ data: { alreadyVerified: true } });
  if (!takeRateLimit(`verify-resend:${session.userId}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Bitte etwas warten, bevor Sie eine weitere E-Mail anfordern.' }, { status: 429 });
  }
  try {
    await sendVerification(session.userId);
    return NextResponse.json({ data: { sent: true, email: session.email } });
  } catch (error) {
    if (error instanceof MailDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error('[verify-email/resend]', error);
    return NextResponse.json({ error: 'E-Mail konnte nicht gesendet werden.' }, { status: 502 });
  }
}
