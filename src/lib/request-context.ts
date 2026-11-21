import { NextRequest } from 'next/server';
import { getSession, verifyTokenString, type SessionPayload } from '@/lib/auth-server';

export interface SessionOptions {
  /** Nur die Portal-Routen setzen das: sonst gilt ein Kunden-Login als nicht angemeldet. */
  allowClient?: boolean;
}

export function isClientSession(session: SessionPayload | null | undefined): boolean {
  return String(session?.role ?? '').toUpperCase() === 'CLIENT';
}

/**
 * Sitzung aus Cookie (Web) oder Bearer-Token (Mobile).
 *
 * Kunden-Logins (Hausverwaltung, role CLIENT) werden standardmäßig abgewiesen:
 * jede interne API behandelt sie wie "nicht angemeldet". So kann keine
 * bestehende oder künftige Route versehentlich interne Daten an das Portal geben.
 */
export async function getRequestSession(req: NextRequest, options: SessionOptions = {}): Promise<SessionPayload | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const session = await (bearerToken ? verifyTokenString(bearerToken) : getSession());
  if (session && isClientSession(session)) {
    if (!options.allowClient || !session.clientId) return null;
  }
  return session;
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
