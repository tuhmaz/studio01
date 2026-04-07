import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth-server';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  return NextResponse.json(session);
}
