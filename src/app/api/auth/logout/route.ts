import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/auth-server';

export async function POST() {
  await deleteSession();
  return NextResponse.json({ ok: true });
}

// GET-Fallback: ermöglicht Logout auch per Link/Redirect
export async function GET() {
  await deleteSession();
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_BASE_URL ?? 'https://mbj.news'));
}
