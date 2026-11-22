/** POST /api/auth/verify-email { token } — E-Mail-Adresse bestätigen (Link aus der Mail). */
import { NextRequest, NextResponse } from 'next/server';
import { TokenError, verifyEmailWithToken } from '@/lib/auth-tokens';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  try {
    const user = await verifyEmailWithToken(body?.token);
    return NextResponse.json({ data: { email: user.email } });
  } catch (error) {
    if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[verify-email]', error);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
