/**
 * Self-service registration of a new company.
 *
 * Disabled unless ALLOW_SIGNUP=true, so an installation decides itself
 * whether strangers may create companies (e.g. only once billing and email
 * verification are in place).
 */
import { randomBytes } from 'node:crypto';

export function isSignupEnabled(): boolean {
  return process.env.ALLOW_SIGNUP === 'true';
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Readable, unique company id: "muster-hausmeister-gmbh-k3f9x2". */
export function companyIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüß]/g, ch => UMLAUTS[ch])
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const suffix = randomBytes(4).toString('hex').slice(0, 6);
  return `${slug || 'firma'}-${suffix}`;
}

export interface SignupInput {
  companyName: string;
  name: string;
  email: string;
  password: string;
  acceptTerms: boolean;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Returns a German error message, or null when the input is valid. */
export function validateSignup(input: Partial<SignupInput>): string | null {
  const companyName = String(input.companyName ?? '').trim();
  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim();
  const password = String(input.password ?? '');

  if (companyName.length < 2 || companyName.length > 120) return 'Bitte einen Firmennamen (2–120 Zeichen) angeben.';
  if (name.length < 2 || name.length > 120) return 'Bitte Ihren Namen angeben.';
  if (!EMAIL_RE.test(email) || email.length > 254) return 'Bitte eine gültige E-Mail-Adresse angeben.';
  if (password.length < 12) return 'Das Passwort muss mindestens 12 Zeichen haben.';
  if (password.length > 200) return 'Das Passwort ist zu lang.';
  if (input.acceptTerms !== true) return 'Bitte AGB und Datenschutzerklärung akzeptieren.';
  return null;
}
