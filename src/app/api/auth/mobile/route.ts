/**
 * Mobile Authentication Endpoint
 * POST /api/auth/mobile  — login, returns JWT in response body (no cookie)
 * GET  /api/auth/mobile  — verify Bearer token, returns user profile
 */
import { NextRequest, NextResponse } from 'next/server';
import { createTokenString, verifyTokenString } from '@/lib/auth-server';
import sql from '@/lib/db';
import bcrypt from 'bcryptjs';

// ── POST /api/auth/mobile  →  Login ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'E-Mail und Passwort erforderlich' }, { status: 400 });
    }

    const rows = await sql`
      SELECT u.*, c.name as company_name
      FROM users u
      JOIN companies c ON c.id = u.company_id
      WHERE u.email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) {
      return NextResponse.json({ error: 'Ungültige Anmeldedaten' }, { status: 401 });
    }

    if (!user.password_hash) {
      return NextResponse.json({ error: 'Kein Passwort gesetzt' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Ungültige Anmeldedaten' }, { status: 401 });
    }

    // Update last_login
    await sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`;

    const token = await createTokenString({
      userId:    user.id,
      companyId: user.company_id,
      role:      user.role,
      name:      user.name,
      email:     user.email,
    });

    return NextResponse.json({
      token,
      user: {
        id:          user.id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        companyId:   user.company_id,
        companyName: user.company_name,
      },
    });
  } catch (err) {
    console.error('[mobile/login]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}

// ── GET /api/auth/mobile  →  Verify token & return profile ──────────────────
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Kein Token' }, { status: 401 });
    }

    const session = await verifyTokenString(token);
    if (!session) {
      return NextResponse.json({ error: 'Token ungültig oder abgelaufen' }, { status: 401 });
    }

    return NextResponse.json({
      userId:    session.userId,
      companyId: session.companyId,
      role:      session.role,
      name:      session.name,
      email:     session.email,
    });
  } catch (err) {
    console.error('[mobile/me]', err);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
