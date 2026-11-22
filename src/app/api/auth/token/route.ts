/**
 * GET /api/auth/token?token=…&purpose=reset|invite|verify
 * Prüft einen Link, ohne ihn einzulösen (für die Seite: Name, Firma, E-Mail).
 */
import { NextRequest, NextResponse } from 'next/server';
import { TokenError, peekToken, type TokenPurpose } from '@/lib/auth-tokens';

export async function GET(req: NextRequest) {
  const purpose = req.nextUrl.searchParams.get('purpose');
  const purposes: TokenPurpose[] = purpose === 'verify' ? ['verify'] : purpose === 'invite' ? ['invite'] : ['reset'];
  try {
    const t = await peekToken(req.nextUrl.searchParams.get('token'), purposes);
    return NextResponse.json({ data: { purpose: t.purpose, name: t.name, email: t.email, companyName: t.companyName } });
  } catch (error) {
    if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[auth/token]', error);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
