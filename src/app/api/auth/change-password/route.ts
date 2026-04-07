import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession } from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });

  const { newPassword } = await req.json();
  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: 'Mindestens 6 Zeichen erforderlich' }, { status: 400 });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await sql`UPDATE public.users SET password_hash = ${hash} WHERE id = ${session.userId}`;

  return NextResponse.json({ ok: true });
}
