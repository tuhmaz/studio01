/**
 * Konto-E-Mails: Einladung, Passwort vergessen, Bestätigung der Adresse.
 * Links zeigen immer auf NEXT_PUBLIC_APP_URL (siehe src/lib/mail.ts).
 */
import sql from '@/lib/db';
import { issueToken } from '@/lib/auth-tokens';
import { appUrl, inviteMail, mailEnabled, resetMail, sendMail, verifyMail } from '@/lib/mail';

export class MailDisabledError extends Error {
  constructor() {
    super('E-Mail-Versand ist auf diesem Server nicht eingerichtet.');
  }
}

function link(path: string, token: string): string {
  const base = appUrl();
  if (!base || !mailEnabled()) throw new MailDisabledError();
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

async function loadUser(userId: string) {
  const [user] = await sql`
    SELECT u.id::text AS id, u.company_id, u.name, u.email, u.role, c.name AS company_name
      FROM users u JOIN companies c ON c.id = u.company_id
     WHERE u.id = ${userId}
  `;
  return user as { id: string; company_id: string; name: string; email: string; role: string; company_name: string } | undefined;
}

/** Einladung (neu oder erneut): Link zum Festlegen des eigenen Passworts, 7 Tage gültig. */
export async function sendInvite(userId: string, invitedBy: { userId: string; name: string }): Promise<void> {
  if (!mailEnabled()) throw new MailDisabledError();
  const user = await loadUser(userId);
  if (!user) throw new Error('Benutzer nicht gefunden');
  const token = await issueToken({ companyId: user.company_id, userId: user.id, purpose: 'invite', createdBy: invitedBy.userId });
  await sendMail(inviteMail({
    to: user.email,
    name: user.name,
    companyName: user.company_name,
    invitedBy: invitedBy.name,
    url: link('/einladung', token),
    isWorker: user.role === 'WORKER' || user.role === 'LEADER',
  }));
}

/**
 * „Passwort vergessen“. Gibt nie preis, ob es die Adresse gibt; Konten ohne
 * Passwort-Anmeldung bekommen nichts.
 */
export async function requestPasswordReset(email: string): Promise<boolean> {
  if (!mailEnabled()) throw new MailDisabledError();
  const [user] = await sql`
    SELECT id::text AS id, company_id, name, email FROM users
     WHERE lower(email) = ${email.trim().toLowerCase()} AND can_login_with_password IS NOT FALSE
     LIMIT 1
  `;
  if (!user) return false;
  const token = await issueToken({ companyId: user.company_id, userId: user.id, purpose: 'reset' });
  await sendMail(resetMail({ to: user.email, name: user.name, url: link('/passwort-zuruecksetzen', token) }));
  return true;
}

export async function sendVerification(userId: string): Promise<void> {
  if (!mailEnabled()) throw new MailDisabledError();
  const user = await loadUser(userId);
  if (!user) throw new Error('Benutzer nicht gefunden');
  const token = await issueToken({ companyId: user.company_id, userId: user.id, purpose: 'verify' });
  await sendMail(verifyMail({ to: user.email, name: user.name, url: link('/email-bestaetigen', token) }));
}
