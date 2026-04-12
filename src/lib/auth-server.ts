/**
 * Server-side JWT helpers.
 * Runs ONLY in Next.js API routes / middleware.
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'hp_session';
const EXPIRES_IN  = 60 * 60 * 24 * 7; // 7 days in seconds

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  companyId: string;
  role: string;
  name: string;
  email: string;
}

/** Sign a JWT and set it as an httpOnly cookie */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRES_IN}s`)
    .sign(getSecret());

  // Next.js 14: cookies() is synchronous
  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   EXPIRES_IN,
    path:     '/',
    domain:   process.env.NODE_ENV === 'production' ? 'mbj.news' : undefined,
  });
}

/** Verify the session cookie and return the payload, or null if invalid */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    // Next.js 14: cookies() is synchronous
    const cookieStore = cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** Clear the session cookie */
export async function deleteSession(): Promise<void> {
  const cookieStore = cookies();
  // Muss dieselben Attribute (domain, path, secure) wie beim Setzen haben,
  // sonst löscht der Browser das Cookie nicht (insb. in Production mit Domain).
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,
    path:     '/',
    domain:   process.env.NODE_ENV === 'production' ? 'mbj.news' : undefined,
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
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
