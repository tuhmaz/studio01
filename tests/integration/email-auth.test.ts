/** E-Mail: Passwort vergessen, Einladung, Bestätigung – Links, Einmaligkeit, Ablauf, Abmeldung. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { GET as forgotStatus, POST as forgot } from '@/app/api/auth/password/forgot/route';
import { POST as reset } from '@/app/api/auth/password/reset/route';
import { GET as peek } from '@/app/api/auth/token/route';
import { POST as verify } from '@/app/api/auth/verify-email/route';
import { POST as resend } from '@/app/api/auth/verify-email/resend/route';
import { POST as provision } from '@/app/api/provision-user/route';
import { POST as invite } from '@/app/api/users/invite/route';
import { POST as importApi } from '@/app/api/import/route';
import { POST as clientLogins } from '@/app/api/clients/logins/route';
import { GET as mailSettings, POST as mailTest } from '@/app/api/settings/mail/route';
import { mailOutbox } from '@/lib/mail';
import { resetRateLimits } from '@/lib/rate-limit';
import { getRequestSession } from '@/lib/request-context';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeAll(() => { process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'; });
afterAll(() => { process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_URL; });
beforeEach(async () => {
  fx = await seed();
  mailOutbox.length = 0;
  resetRateLimits();
});

const anon = (handler: (req: NextRequest) => Promise<Response>, path: string, body: unknown) =>
  handler(new NextRequest(`http://evil.example${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', host: 'evil.example' }, body: JSON.stringify(body),
  })).then(async res => ({ status: res.status, json: await res.json() }));

const tokenFromMail = (index = -1) => {
  const mail = mailOutbox.at(index)!;
  const match = mail.text.match(/https:\/\/app\.example\.test(\/[\w-]+)\?token=([\w-]+)/);
  expect(match, mail.text).toBeTruthy();
  return { path: match![1], token: match![2], mail };
};

const peekToken = (token: string, purpose: string) =>
  peek(new NextRequest(`http://localhost/api/auth/token?token=${token}&purpose=${purpose}`)).then(async r => ({ status: r.status, json: await r.json() }));

describe('Passwort vergessen', () => {
  it('gleiche Antwort für unbekannte Adressen, Link immer auf APP_URL', async () => {
    expect((await forgotStatus()).status).toBe(200);
    const unknown = await anon(forgot, '/api/auth/password/forgot', { email: 'niemand@x.test' });
    const known = await anon(forgot, '/api/auth/password/forgot', { email: fx.a.users.WORKER.email.toUpperCase() });
    expect(unknown).toEqual(known);
    expect(mailOutbox).toHaveLength(1);
    const { path, mail } = tokenFromMail();
    expect(path).toBe('/passwort-zuruecksetzen');
    expect(mail.to).toBe(fx.a.users.WORKER.email);
    expect(mail.html).not.toContain('evil.example');
  });

  it('setzt das Passwort einmalig, meldet alte Sitzungen ab, bestätigt die Adresse', async () => {
    const oldToken = await tokenFor(fx.a, 'WORKER');
    await sql`UPDATE users SET email_verified_at = NULL WHERE id = ${fx.a.users.WORKER.id}`;
    await anon(forgot, '/api/auth/password/forgot', { email: fx.a.users.WORKER.email });
    const { token } = tokenFromMail();

    expect((await peekToken(token, 'reset')).json.data).toMatchObject({ email: fx.a.users.WORKER.email, purpose: 'reset' });
    expect((await anon(reset, '/api/auth/password/reset', { token, password: 'kurz' })).status).toBe(400);
    await new Promise(r => setTimeout(r, 2100)); // jenseits der 1-s-Toleranz der Sitzungsprüfung
    const ok = await anon(reset, '/api/auth/password/reset', { token, password: 'ein-neues-langes-passwort' });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ role: 'WORKER', next: '/dashboard' });

    const [u] = await sql`SELECT password_hash, email_verified_at FROM users WHERE id = ${fx.a.users.WORKER.id}`;
    expect(await bcrypt.compare('ein-neues-langes-passwort', u.password_hash)).toBe(true);
    expect(u.email_verified_at).not.toBeNull();
    const old = await getRequestSession(new NextRequest('http://localhost/x', { headers: { authorization: `Bearer ${oldToken}` } }));
    expect(old).toBeNull();

    expect((await anon(reset, '/api/auth/password/reset', { token, password: 'noch-ein-anderes-passwort' })).status).toBe(410);
  });

  it('neuer Link ersetzt den alten; abgelaufene Links gelten nicht; Begrenzung', async () => {
    const email = fx.a.users.LEADER.email;
    await anon(forgot, '/api/auth/password/forgot', { email });
    const first = tokenFromMail().token;
    await anon(forgot, '/api/auth/password/forgot', { email });
    const second = tokenFromMail().token;
    expect((await peekToken(first, 'reset')).status).toBe(404);
    await sql`UPDATE auth_tokens SET expires_at = NOW() - interval '1 minute'`;
    expect((await peekToken(second, 'reset')).status).toBe(410);
    await anon(forgot, '/api/auth/password/forgot', { email });
    expect((await anon(forgot, '/api/auth/password/forgot', { email })).status).toBe(429);
    expect((await peekToken('kein-gueltiges-format', 'reset')).status).toBe(404);
  });
});

describe('Einladungen', () => {
  it('neuer Mitarbeiter per Einladung: Link setzt das Passwort, erneut senden ersetzt den Link', async () => {
    const res = await call(provision, '/api/provision-user', await tokenFor(fx.a, 'ADMIN'), {
      name: 'Neu Mann', email: 'neu@firma.test', role: 'WORKER', sendInvite: true,
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ invited: true, inviteError: null });
    const { path, token, mail } = tokenFromMail();
    expect(path).toBe('/einladung');
    expect(mail.subject).toContain('Einladung zu');
    expect(mail.text).toContain('Mitarbeiter-App');
    expect((await peekToken(token, 'invite')).json.data).toMatchObject({ name: 'Neu Mann', companyName: expect.any(String) });
    expect((await peekToken(token, 'reset')).status).toBe(404);

    const again = await call(invite, '/api/users/invite', await tokenFor(fx.a, 'ADMIN'), { userId: res.json.userId });
    expect(again.status).toBe(200);
    expect((await peekToken(token, 'invite')).status).toBe(404);
    const fresh = tokenFromMail().token;
    expect((await anon(reset, '/api/auth/password/reset', { token: fresh, password: 'mein-eigenes-passwort' })).status).toBe(200);
    const [u] = await sql`SELECT password_hash, email_verified_at FROM users WHERE email = 'neu@firma.test'`;
    expect(await bcrypt.compare('mein-eigenes-passwort', u.password_hash)).toBe(true);
    expect(u.email_verified_at).not.toBeNull();
  });

  it('nur Admin, nur eigene Firma', async () => {
    expect((await call(invite, '/api/users/invite', await tokenFor(fx.a, 'MANAGER'), { userId: fx.a.users.WORKER.id })).status).toBe(403);
    expect((await call(invite, '/api/users/invite', await tokenFor(fx.b, 'ADMIN'), { userId: fx.a.users.WORKER.id })).status).toBe(404);
  });

  it('Excel-Import mit Einladungen: keine Passwortliste, je Mitarbeiter eine Mail', async () => {
    const res = await call(importApi, '/api/import', await tokenFor(fx.a, 'ADMIN'), {
      type: 'users', dryRun: false, sendInvites: true,
      rows: [{ name: 'Eins', email: 'eins@firma.test' }, { name: 'Zwei', email: 'zwei@firma.test' }],
    });
    expect(res.json.data).toMatchObject({ created: 2, invited: 2, inviteFailed: [] });
    expect(res.json.data.credentials).toBeUndefined();
    expect(mailOutbox.map(m => m.to)).toEqual(['eins@firma.test', 'zwei@firma.test']);
  });

  it('Portal-Zugang per Einladung führt nach dem Festlegen ins Portal', async () => {
    await sql`INSERT INTO clients (id, company_id, name) VALUES ('client-x', 'co-a', 'HV X')`;
    const res = await call(clientLogins, '/api/clients/logins', await tokenFor(fx.a, 'ADMIN'), {
      clientId: 'client-x', name: 'Frau X', email: 'x@hv.test', sendInvite: true,
    });
    expect(res.json).toMatchObject({ invited: true });
    const done = await anon(reset, '/api/auth/password/reset', { token: tokenFromMail().token, password: 'portal-passwort-1234' });
    expect(done.json.data).toMatchObject({ role: 'CLIENT', next: '/portal' });
  });
});

describe('Bestätigung und Einstellungen', () => {
  it('Bestätigungslink setzt email_verified_at; erneut anfordern nur wenn offen', async () => {
    await sql`UPDATE users SET email_verified_at = NULL WHERE id = ${fx.a.users.ADMIN.id}`;
    const admin = await tokenFor(fx.a, 'ADMIN');
    expect((await call(resend, '/api/auth/verify-email/resend', admin, {})).json.data).toMatchObject({ sent: true });
    const { path, token } = tokenFromMail();
    expect(path).toBe('/email-bestaetigen');
    expect((await anon(verify, '/api/auth/verify-email', { token })).status).toBe(200);
    expect((await anon(verify, '/api/auth/verify-email', { token })).status).toBe(410);
    expect((await call(resend, '/api/auth/verify-email/resend', admin, {})).json.data).toMatchObject({ alreadyVerified: true });
  });

  it('Mail-Einstellungen: Status und Testmail nur für Admins', async () => {
    const admin = await tokenFor(fx.a, 'ADMIN');
    const status = await mailSettings(new NextRequest('http://localhost/api/settings/mail', { headers: { authorization: `Bearer ${admin}` } }));
    expect((await status.json()).data).toMatchObject({ enabled: true, appUrl: 'https://app.example.test' });
    expect((await call(mailTest, '/api/settings/mail', admin, {})).status).toBe(200);
    expect(mailOutbox.at(-1)?.to).toBe(fx.a.users.ADMIN.email);
    expect((await call(mailTest, '/api/settings/mail', await tokenFor(fx.a, 'MANAGER'), {})).status).toBe(403);
  });

  it('ohne APP_URL ist der Versand aus', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '';
    const saved = process.env.NEXT_PUBLIC_BASE_URL;
    process.env.NEXT_PUBLIC_BASE_URL = '';
    try {
      expect((await (await forgotStatus()).json()).enabled).toBe(false);
      expect((await anon(forgot, '/api/auth/password/forgot', { email: fx.a.users.WORKER.email })).status).toBe(503);
      const res = await call(provision, '/api/provision-user', await tokenFor(fx.a, 'ADMIN'), { name: 'X', email: 'x@y.test', sendInvite: true });
      expect(res.status).toBe(503);
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
      process.env.NEXT_PUBLIC_BASE_URL = saved;
    }
  });
});
