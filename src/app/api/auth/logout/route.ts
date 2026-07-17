import { NextResponse } from 'next/server';
import { deleteSession, getSession, revokeUserSessions } from '@/lib/auth-server';

async function performLogout() {
  const session = await getSession();
  if (session) await revokeUserSessions(session.userId);
  await deleteSession();
}

export async function POST() {
  await performLogout();
  return NextResponse.json({ ok: true });
}

// GET-Fallback: ermöglicht Logout auch per Link/Redirect
export async function GET() {
  await performLogout();
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:9002'));
}
