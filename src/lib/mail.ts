/**
 * E-Mail-Versand über das eigene SMTP-Postfach der Installation.
 *
 * Konfiguration (Umgebungsvariablen):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE ("true" bei Port 465),
 *   SMTP_USER, SMTP_PASS, MAIL_FROM ("Hausmeister Pro <noreply@firma.de>"),
 *   NEXT_PUBLIC_APP_URL — Basis aller Links in E-Mails. Bewusst NICHT aus dem
 *   Host-Header der Anfrage, damit niemand Links auf eine fremde Domain
 *   umbiegen kann (Password-Reset-Poisoning).
 *
 * Ohne SMTP_HOST ist der Versand aus: Einladungen/Passwort vergessen werden
 * in der Oberfläche nicht angeboten. In Entwicklung und Tests landen
 * Mails in einem Speicher-Postausgang (und in der Konsole).
 */
import nodemailer, { type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __mailOutbox: Mail[] | undefined;
  // eslint-disable-next-line no-var
  var __mailTransport: Transporter | undefined;
}

/** Nur Entwicklung/Tests: hier landen die Mails statt im SMTP. */
export const mailOutbox: Mail[] = globalThis.__mailOutbox ?? (globalThis.__mailOutbox = []);

const devMode = () => process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST;

export function appUrl(): string | null {
  const url = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(url) ? url : null;
}

/** Kann diese Installation E-Mails mit gültigen Links verschicken? */
export function mailEnabled(): boolean {
  if (!appUrl()) return false;
  return devMode() || !!process.env.SMTP_HOST;
}

function transport(): Transporter {
  if (globalThis.__mailTransport) return globalThis.__mailTransport;
  const port = Number(process.env.SMTP_PORT || 587);
  globalThis.__mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return globalThis.__mailTransport;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
}

export async function sendMail(mail: Mail): Promise<void> {
  if (!mailEnabled()) throw new Error('E-Mail-Versand ist nicht eingerichtet (SMTP_HOST, NEXT_PUBLIC_APP_URL).');
  if (devMode()) {
    mailOutbox.push(mail);
    if (process.env.NODE_ENV !== 'test') console.info(`[mail] an ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  await transport().sendMail({ from: mailFrom(), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

/* ------------------------------------------------------------ Vorlagen */

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

interface Layout {
  to: string;
  subject: string;
  greeting: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footer: string[];
}

function render({ to, subject, greeting, paragraphs, button, footer }: Layout): Mail {
  const text = [
    greeting, '',
    ...paragraphs.flatMap(p => [p, '']),
    `${button.label}: ${button.url}`, '',
    ...footer,
  ].join('\n');
  const html = `<!DOCTYPE html><html lang="de"><body style="margin:0;background:#f1f3f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0f2850;color:#ffffff;padding:18px 28px;font-size:18px;font-weight:bold">Hausmeister Pro</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 16px;font-size:15px">${esc(greeting)}</p>
${paragraphs.map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join('\n')}
<p style="margin:24px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#2a4ea0;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">${esc(button.label)}</a></p>
<p style="margin:0 0 6px;font-size:12px;color:#6b7280">Falls der Button nicht funktioniert, diesen Link in den Browser kopieren:</p>
<p style="margin:0 0 20px;font-size:12px;word-break:break-all"><a href="${esc(button.url)}" style="color:#2a4ea0">${esc(button.url)}</a></p>
${footer.map(f => `<p style="margin:0 0 6px;font-size:12px;color:#6b7280">${esc(f)}</p>`).join('\n')}
</td></tr></table></td></tr></table></body></html>`;
  return { to, subject, text, html };
}

export function inviteMail(p: { to: string; name: string; companyName: string; invitedBy: string; url: string; isWorker: boolean }): Mail {
  return render({
    to: p.to,
    subject: `Einladung zu ${p.companyName} – Hausmeister Pro`,
    greeting: `Hallo ${p.name},`,
    paragraphs: [
      `${p.invitedBy} hat für Sie ein Konto bei ${p.companyName} angelegt.`,
      'Bitte legen Sie über den folgenden Link Ihr eigenes Passwort fest. Der Link ist 7 Tage gültig und kann nur einmal verwendet werden.',
      ...(p.isWorker ? ['Danach melden Sie sich mit Ihrer E-Mail-Adresse und dem neuen Passwort in der Mitarbeiter-App an.'] : []),
    ],
    button: { label: 'Passwort festlegen', url: p.url },
    footer: [`Ihr Benutzername ist diese E-Mail-Adresse: ${p.to}`, 'Wenn Sie diese Einladung nicht erwartet haben, können Sie die E-Mail ignorieren.'],
  });
}

export function resetMail(p: { to: string; name: string; url: string }): Mail {
  return render({
    to: p.to,
    subject: 'Passwort zurücksetzen – Hausmeister Pro',
    greeting: `Hallo ${p.name},`,
    paragraphs: [
      'Für Ihr Konto wurde das Zurücksetzen des Passworts angefordert.',
      'Über den folgenden Link legen Sie ein neues Passwort fest. Der Link ist 60 Minuten gültig und kann nur einmal verwendet werden. Danach werden alle Geräte abgemeldet.',
    ],
    button: { label: 'Neues Passwort festlegen', url: p.url },
    footer: ['Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail – Ihr Passwort bleibt unverändert.'],
  });
}

export function verifyMail(p: { to: string; name: string; url: string }): Mail {
  return render({
    to: p.to,
    subject: 'E-Mail-Adresse bestätigen – Hausmeister Pro',
    greeting: `Hallo ${p.name},`,
    paragraphs: ['Bitte bestätigen Sie Ihre E-Mail-Adresse, damit wir Ihnen wichtige Nachrichten zu Ihrem Konto (z. B. zum Zurücksetzen des Passworts) schicken können. Der Link ist 48 Stunden gültig.'],
    button: { label: 'E-Mail-Adresse bestätigen', url: p.url },
    footer: ['Wenn Sie kein Konto angelegt haben, ignorieren Sie diese E-Mail.'],
  });
}

export function testMail(to: string): Mail {
  return render({
    to,
    subject: 'Testnachricht – Hausmeister Pro',
    greeting: 'Hallo,',
    paragraphs: ['der E-Mail-Versand Ihrer Installation funktioniert.', `Absender: ${mailFrom()}`],
    button: { label: 'Hausmeister Pro öffnen', url: appUrl() ?? 'http://localhost' },
    footer: [],
  });
}
