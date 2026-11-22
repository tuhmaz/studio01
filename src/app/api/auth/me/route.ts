import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/auth-server';
import { mailEnabled } from '@/lib/mail';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  const [row] = await sql`SELECT email_verified_at FROM users WHERE id = ${session.userId}`;
  return NextResponse.json({ ...session, emailVerified: !!row?.email_verified_at, mailEnabled: mailEnabled() });
}
