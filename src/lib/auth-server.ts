/**
 * Server-side JWT helpers.
 * Runs ONLY in Next.js API routes / middleware.
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import sql from '@/lib/db';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'hp_session';
const EXPIRES_IN  = Number(process.env.SESSION_EXPIRES_SECONDS ?? 60 * 60 * 24 * 7); // default: 7 days

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  return new TextEncoder().encode(secret);
}

function getCookieDomain(): string | undefined {
  const value = process.env.COOKIE_DOMAIN?.trim();
  return value || undefined;
}

export interface SessionPayload {
  userId: string;
  companyId: string;
  role: string;
  name: string;
  email: string;
}

type RawSessionPayload = SessionPayload & {
  iat?: number;
  exp?: number;
};

async function validateSessionPayload(payload: RawSessionPayload): Promise<SessionPayload | null> {
  if (!payload.userId || !payload.companyId) return null;

  const [user] = await sql`
    SELECT id, company_id, role, name, email, password_changed_at, sessions_revoked_at
      FROM public.users
     WHERE id = ${payload.userId}
     LIMIT 1
  `;
  if (!user || user.company_id !== payload.companyId) return null;

  const issuedAtMs = typeof payload.iat === 'number' ? payload.iat * 1000 : 0;
  const passwordChangedAtMs = user.password_changed_at
    ? new Date(user.password_changed_at).getTime()
    : 0;
  const sessionsRevokedAtMs = user.sessions_revoked_at
    ? new Date(user.sessions_revoked_at).getTime()
    : 0;

  // Reject tokens issued before an explicit password change or logout/revocation.
  // The 1s slack absorbs clock granularity between JWT iat (seconds) and DB timestamps.
  const invalidatedBeforeMs = Math.max(passwordChangedAtMs, sessionsRevokedAtMs);
  if (invalidatedBeforeMs && issuedAtMs + 1000 < invalidatedBeforeMs) {
    return null;
  }

  return {
    userId: user.id,
    companyId: user.company_id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
}

/** Sign a JWT and set it as an httpOnly cookie */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRES_IN}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   EXPIRES_IN,
    path:     '/',
    domain:   getCookieDomain(),
  });
}

/** Verify the session cookie and return the payload, or null if invalid */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecret());
    return validateSessionPayload(payload as unknown as RawSessionPayload);
  } catch {
    return null;
  }
}

/**
 * Server-side revocation: invalidates every JWT issued to this user before now
 * (all devices — web cookie and mobile bearer tokens). Used on logout.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await sql`
    UPDATE public.users
       SET sessions_revoked_at = date_trunc('second', NOW())
     WHERE id = ${userId}
  `;
}

/** Clear the session cookie */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  // Muss dieselben Attribute (domain, path, secure) wie beim Setzen haben,
  // sonst löscht der Browser das Cookie nicht (insb. in Production mit Domain).
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,
    path:     '/',
    domain:   getCookieDomain(),
  });
}

/** Sign a JWT and return it as a string (used by mobile login — no cookie) */
export async function createTokenString(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRES_IN}s`)
    .sign(getSecret());
}

/** Verify a raw JWT string (used by mobile API requests via Authorization header) */
export async function verifyTokenString(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return validateSessionPayload(payload as unknown as RawSessionPayload);
  } catch {
    return null;
  }
}
