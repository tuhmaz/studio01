import { NextRequest } from 'next/server';
import { getSession, verifyTokenString, type SessionPayload } from '@/lib/auth-server';

export async function getRequestSession(req: NextRequest): Promise<SessionPayload | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  return bearerToken ? verifyTokenString(bearerToken) : getSession();
}

export function getRequestIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  );
}

export function getUserAgent(req: NextRequest): string | null {
  return req.headers.get('user-agent');
}
