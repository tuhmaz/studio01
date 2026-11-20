/** Eingaben für Hausverwaltungen (Admin-Seite /kunden). */
import { PortalError, cleanText } from '@/lib/portal';

export interface ClientInput {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseClientInput(body: Record<string, unknown>): ClientInput {
  const name = cleanText(body.name, 200);
  if (!name) throw new PortalError('Name der Hausverwaltung fehlt');
  const email = cleanText(body.email, 200)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) throw new PortalError('Ungültige E-Mail-Adresse');
  return {
    name,
    contactName: cleanText(body.contactName, 200),
    email,
    phone: cleanText(body.phone, 60),
    address: cleanText(body.address, 300),
    notes: cleanText(body.notes, 2000),
  };
}

export function parseSiteIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new PortalError('siteIds muss eine Liste sein');
  return Array.from(new Set(value as string[])).slice(0, 2000);
}

export function isValidEmail(value: string) {
  return EMAIL_RE.test(value);
}
