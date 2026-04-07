import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession } from '@/lib/auth-server';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'E-Mail und Passwort erforderlich' }, { status: 400 });
    }

    const [user] = await sql`
      SELECT id, company_id, name, email, password_hash, role
      FROM public.users
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;

    if (!user) {
      return NextResponse.json({ error: 'Ungültige Anmeldedaten' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Ungültige Anmeldedaten' }, { status: 401 });
    }

    // Update last_login
    await sql`
      UPDATE public.users SET last_login = NOW() WHERE id = ${user.id}
    `;

    await createSession({
      userId:    user.id,
      companyId: user.company_id,
      role:      user.role,
      name:      user.name,
      email:     user.email,
    });

    return NextResponse.json({
      id:        user.id,
      companyId: user.company_id,
      role:      user.role,
      name:      user.name,
      email:     user.email,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
