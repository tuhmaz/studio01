import { NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET() {
  const info: Record<string, any> = {
    node_env:    process.env.NODE_ENV,
    db_host:     process.env.DB_HOST     ?? '❌ NOT SET',
    db_username: process.env.DB_USERNAME ?? '❌ NOT SET',
    db_status:   'pending',
    users_count: null,
    has_password_hash_column: null,
    admin_user: null,
    db_error: null,
  };

  try {
    // 1. Check password_hash column exists
    const colCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_hash'
    `;
    info.has_password_hash_column = colCheck.length > 0;

    // 2. Count users
    const [cnt] = await sql`SELECT COUNT(*)::int AS c FROM public.users`;
    info.users_count = cnt.c;

    // 3. Check admin user
    const [admin] = await sql`
      SELECT id, email, role,
             (password_hash IS NOT NULL AND password_hash <> '') AS has_hash
      FROM public.users WHERE email = 'j.tuhmaz@gmail.com' LIMIT 1
    `;
    info.admin_user = admin ?? '❌ not found';

    info.db_status = '✓ connected';
  } catch (err: any) {
    info.db_status = '❌ failed';
    info.db_error  = err?.message ?? String(err);
  }

  return NextResponse.json(info, { status: 200 });
}
