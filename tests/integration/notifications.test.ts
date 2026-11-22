/**
 * Benachrichtigungen: aus Einsatz-Änderungen, Mängelmeldungen und offenen
 * Schichten; Abruf/gelesen; Push-Versand über Expo (gemockt).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as dataApi } from '@/app/api/data/route';
import { GET as listApi, POST as readApi } from '@/app/api/notifications/route';
import { POST as registerApi, DELETE as unregisterApi } from '@/app/api/push/register/route';
import { GET as cronApi } from '@/app/api/cron/notifications/route';
import { POST as defectApi } from '@/app/api/portal/defects/route';
import { createTokenString } from '@/lib/auth-server';
import { berlinToday, deliverPendingPush } from '@/lib/notifications';
import { remindOpenShifts } from '@/lib/shift-reminders';
import { NOTIFICATION_KINDS, NOTIFICATION_TEXTS } from '@/lib/notification-texts';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => berlinToday();

function send(handler: (req: NextRequest) => Promise<Response>, method: string, path: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return handler(new NextRequest(`http://localhost${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })).then(async res => ({ status: res.status, json: await res.json() }));
}

const notes = (userId?: string) => userId
  ? sql`SELECT kind, data, user_id::text AS user_id FROM notifications WHERE user_id = ${userId} ORDER BY created_at, kind`
  : sql`SELECT kind, data, user_id::text AS user_id FROM notifications ORDER BY created_at, kind`;

const data = async (role: 'MANAGER' | 'WORKER' | 'LEADER', body: Record<string, unknown>) =>
  call(dataApi, '/api/data', await tokenFor(fx.a, role), body);

beforeEach(async () => {
  fx = await seed();
  await sql`DELETE FROM time_entries`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRON_SECRET;
});

describe('Einsätze', () => {
  it('neuer veröffentlichter Einsatz → jeder zugeteilte Mitarbeiter, nicht der Planer', async () => {
    const date = addDays(today(), 1);
    const res = await data('MANAGER', {
      action: 'insert', table: 'job_assignments',
      data: {
        id: 'job-new', company_id: 'co-a', job_site_id: 'site-a', title: 'Lindenhof', scheduled_date: date, status: 'PENDING',
        is_plan_published: true, categories: [], assigned_worker_ids: [fx.a.users.WORKER.id, fx.a.users.LEADER.id, fx.a.users.MANAGER.id],
      },
    });
    expect(res.status).toBe(200);
    const rows = await notes();
    expect(rows.map(r => r.user_id).sort()).toEqual([fx.a.users.WORKER.id, fx.a.users.LEADER.id].sort());
    expect(rows.every(r => r.kind === 'assignment.new' && r.data.title === 'Lindenhof' && r.data.date === date)).toBe(true);
  });

  it('unveröffentlicht → nichts; Veröffentlichen, Verschieben, Entfernen, Erledigen', async () => {
    const date = addDays(today(), 2);
    await data('MANAGER', {
      action: 'insert', table: 'job_assignments',
      data: { id: 'job-x', company_id: 'co-a', title: 'Park', scheduled_date: date, status: 'PENDING',
        is_plan_published: false, categories: [], assigned_worker_ids: [fx.a.users.WORKER.id, fx.a.users.LEADER.id] },
    });
    expect(await notes()).toHaveLength(0);

    await data('MANAGER', { action: 'update', table: 'job_assignments', filters: { id: 'job-x' }, data: { is_plan_published: true } });
    expect((await notes()).map(r => r.kind)).toEqual(['assignment.new', 'assignment.new']);

    const later = addDays(date, 1);
    await data('MANAGER', { action: 'update', table: 'job_assignments', filters: { id: 'job-x' }, data: { scheduled_date: later } });
    const moved = (await notes(fx.a.users.WORKER.id)).filter(r => r.kind === 'assignment.moved');
    expect(moved).toHaveLength(1);
    expect(moved[0].data).toMatchObject({ from: date, date: later, title: 'Park' });

    await data('MANAGER', { action: 'update', table: 'job_assignments', filters: { id: 'job-x' }, data: { assigned_worker_ids: [fx.a.users.LEADER.id] } });
    expect((await notes(fx.a.users.WORKER.id)).map(r => r.kind)).toContain('assignment.cancelled');

    await sql`DELETE FROM notifications`;
    await data('MANAGER', { action: 'update', table: 'job_assignments', filters: { id: 'job-x' }, data: { status: 'COMPLETED' } });
    expect(await notes()).toHaveLength(0);
  });

  it('Löschen eines kommenden Einsatzes → „entfällt“; vergangene Einsätze lösen nichts aus', async () => {
    await sql`UPDATE job_assignments SET scheduled_date = ${addDays(today(), 1)} WHERE id = 'job-a'`;
    await data('MANAGER', { action: 'delete', table: 'job_assignments', filters: { id: 'job-a' } });
    expect((await notes(fx.a.users.WORKER.id)).map(r => r.kind)).toEqual(['assignment.cancelled']);

    await sql`DELETE FROM notifications`;
    await data('MANAGER', {
      action: 'insert', table: 'job_assignments',
      data: { id: 'job-old', company_id: 'co-a', title: 'Alt', scheduled_date: addDays(today(), -3), status: 'PENDING',
        is_plan_published: true, categories: [], assigned_worker_ids: [fx.a.users.WORKER.id] },
    });
    expect(await notes()).toHaveLength(0);
  });
});

describe('Abruf und gelesen', () => {
  beforeEach(async () => {
    await data('MANAGER', {
      action: 'insert', table: 'job_assignments',
      data: { id: 'job-r', company_id: 'co-a', title: 'Hof', scheduled_date: addDays(today(), 1), status: 'PENDING',
        is_plan_published: true, categories: [], assigned_worker_ids: [fx.a.users.WORKER.id] },
    });
  });

  it('nur eigene, Text in der gewünschten Sprache', async () => {
    const worker = await tokenFor(fx.a, 'WORKER');
    const ar = await send(listApi, 'GET', '/api/notifications?lang=ar', worker);
    expect(ar.status).toBe(200);
    expect(ar.json.unread).toBe(1);
    expect(ar.json.data[0]).toMatchObject({ kind: 'assignment.new', title: 'مهمة جديدة', read: false, link: '/tracking' });
    expect(ar.json.data[0].body).toContain('Hof');
    const de = await send(listApi, 'GET', '/api/notifications', worker);
    expect(de.json.data[0].title).toBe('Neuer Einsatz');

    expect((await send(listApi, 'GET', '/api/notifications', await tokenFor(fx.a, 'WORKER2'))).json.data).toHaveLength(0);
    expect((await send(listApi, 'GET', '/api/notifications', await tokenFor(fx.b, 'WORKER'))).json.data).toHaveLength(0);
    expect((await send(listApi, 'GET', '/api/notifications', null)).status).toBe(401);
  });

  it('als gelesen markieren – fremde Benachrichtigungen bleiben unberührt', async () => {
    const [{ id }] = await sql`SELECT id FROM notifications`;
    const other = await send(readApi, 'POST', '/api/notifications', await tokenFor(fx.a, 'WORKER2'), { ids: [id] });
    expect(other.json.data.updated).toBe(0);
    const own = await send(readApi, 'POST', '/api/notifications', await tokenFor(fx.a, 'WORKER'), { all: true });
    expect(own.json.data.updated).toBe(1);
    expect((await send(listApi, 'GET', '/api/notifications', await tokenFor(fx.a, 'WORKER'))).json.unread).toBe(0);
  });
});

describe('Push', () => {
  const TOKEN = 'ExponentPushToken[abcdefghij1234567890]';

  it('Gerät anmelden, Versand in der Gerätesprache, abgemeldete Geräte entfernen', async () => {
    const worker = await tokenFor(fx.a, 'WORKER');
    expect((await send(registerApi, 'POST', '/api/push/register', worker, { token: 'nope', lang: 'ar' })).status).toBe(400);
    expect((await send(registerApi, 'POST', '/api/push/register', worker, { token: TOKEN, lang: 'tr', platform: 'android' })).status).toBe(200);

    await data('MANAGER', {
      action: 'insert', table: 'job_assignments',
      data: { id: 'job-p', company_id: 'co-a', title: 'Hof', scheduled_date: addDays(today(), 1), status: 'PENDING',
        is_plan_published: true, categories: [], assigned_worker_ids: [fx.a.users.WORKER.id, fx.a.users.LEADER.id] },
    });

    const fetchMock = vi.fn(async (_url: string, init: { body?: unknown }) => {
      const messages = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await deliverPendingPush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentMessages = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    // Nur der Mitarbeiter hat ein Gerät; Text auf Türkisch.
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({ to: TOKEN, title: 'Yeni görev', data: { kind: 'assignment.new', link: '/tracking' } });
    expect(result.removedTokens).toBe(1);
    expect(await sql`SELECT 1 FROM push_tokens`).toHaveLength(0);
    // Alle Zeilen erledigt – kein zweiter Versand.
    expect(await deliverPendingPush()).toMatchObject({ sent: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Dienst nicht erreichbar → nächster Lauf versucht es erneut', async () => {
    await send(registerApi, 'POST', '/api/push/register', await tokenFor(fx.a, 'WORKER'), { token: TOKEN, lang: 'de' });
    await data('MANAGER', {
      action: 'insert', table: 'job_assignments',
      data: { id: 'job-q', company_id: 'co-a', title: 'Hof', scheduled_date: addDays(today(), 1), status: 'PENDING',
        is_plan_published: true, categories: [], assigned_worker_ids: [fx.a.users.WORKER.id] },
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await deliverPendingPush()).toMatchObject({ sent: 0, failed: 1 });
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: [{ status: 'ok' }] })));
    vi.stubGlobal('fetch', ok);
    expect(await deliverPendingPush()).toMatchObject({ sent: 1 });
  });

  it('Gerät wechselt den Benutzer; Abmelden nur eigenes Token', async () => {
    await send(registerApi, 'POST', '/api/push/register', await tokenFor(fx.a, 'WORKER'), { token: TOKEN });
    await send(registerApi, 'POST', '/api/push/register', await tokenFor(fx.b, 'WORKER'), { token: TOKEN });
    const rows = await sql`SELECT company_id, user_id::text AS user_id FROM push_tokens`;
    expect(rows).toEqual([{ company_id: 'co-b', user_id: fx.b.users.WORKER.id }]);
    await send(unregisterApi, 'DELETE', '/api/push/register', await tokenFor(fx.a, 'WORKER'), { token: TOKEN });
    expect(await sql`SELECT 1 FROM push_tokens`).toHaveLength(1);
    await send(unregisterApi, 'DELETE', '/api/push/register', await tokenFor(fx.b, 'WORKER'), { token: TOKEN });
    expect(await sql`SELECT 1 FROM push_tokens`).toHaveLength(0);
  });
});

describe('Erinnerung offene Schicht', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it('Team mit Teamleiter: Teamleiter + Büro, je Einsatz einmal', async () => {
    await sql`UPDATE job_assignments SET assigned_worker_ids = ${sql.array([fx.a.users.WORKER.id, fx.a.users.LEADER.id])} WHERE id = 'job-a'`;
    await sql`
      INSERT INTO time_entries (id, company_id, employee_id, job_assignment_id, job_site_id, status, clock_in_datetime) VALUES
        ('te-1', 'co-a', ${fx.a.users.WORKER.id}, 'job-a', 'site-a', 'OPEN', ${hoursAgo(11)}),
        ('te-2', 'co-a', ${fx.a.users.LEADER.id}, 'job-a', 'site-a', 'OPEN', ${hoursAgo(11)}),
        ('te-3', 'co-a', ${fx.a.worker2.id}, NULL, 'site-a', 'OPEN', ${hoursAgo(4)})
    `;
    await remindOpenShifts();
    const rows = await notes();
    const reminder = rows.filter(r => r.kind === 'clockout.reminder');
    expect(reminder.map(r => r.user_id)).toEqual([fx.a.users.LEADER.id]);
    expect(reminder[0].data).toMatchObject({ site: 'Objekt', hours: 11 });
    const office = rows.filter(r => r.kind === 'clockout.office');
    expect(office.map(r => r.user_id).sort()).toEqual([fx.a.users.ADMIN.id, fx.a.users.MANAGER.id].sort());
    expect(office[0].data.names).toBe(`${fx.a.users.LEADER.name}, ${fx.a.users.WORKER.name}`);

    await remindOpenShifts();
    expect(await notes()).toHaveLength(rows.length);
  });

  it('Einzeleinsatz: der Mitarbeiter selbst; Cron nur mit Geheimnis', async () => {
    await sql`
      INSERT INTO time_entries (id, company_id, employee_id, job_assignment_id, job_site_id, status, clock_in_datetime)
      VALUES ('te-solo', 'co-a', ${fx.a.users.WORKER.id}, 'job-a', 'site-a', 'OPEN', ${hoursAgo(10.5)})
    `;
    expect((await send(cronApi, 'GET', '/api/cron/notifications', null)).status).toBe(503);
    process.env.CRON_SECRET = 'a-very-long-cron-secret';
    expect((await send(cronApi, 'GET', '/api/cron/notifications', 'wrong')).status).toBe(401);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    const res = await send(cronApi, 'GET', '/api/cron/notifications', 'a-very-long-cron-secret');
    expect(res.status).toBe(200);
    expect((await notes(fx.a.users.WORKER.id)).map(r => r.kind)).toEqual(['clockout.reminder']);
  });
});

describe('Mängelmeldung aus dem Portal', () => {
  it('benachrichtigt Verwaltung (ADMIN, MANAGER), nicht die Mitarbeiter', async () => {
    const clientUser = '00000000-0000-4000-8000-c00000000001';
    await sql`INSERT INTO clients (id, company_id, name) VALUES ('client-nord', 'co-a', 'HV Nord')`;
    await sql`UPDATE job_sites SET client_id = 'client-nord' WHERE id = 'site-a'`;
    await sql`INSERT INTO users (id, company_id, name, email, password_hash, role, client_id)
              VALUES (${clientUser}, 'co-a', 'Frau Nord', 'nord@hv.test', 'x', 'CLIENT', 'client-nord')`;
    const token = await createTokenString({ userId: clientUser, companyId: 'co-a', role: 'CLIENT', name: 'Frau Nord', email: 'nord@hv.test', clientId: 'client-nord' } as never);
    const res = await send(defectApi, 'POST', '/api/portal/defects', token, { siteId: 'site-a', title: 'Tor klemmt' });
    expect(res.status).toBe(201);
    const rows = await notes();
    expect(rows.map(r => r.user_id).sort()).toEqual([fx.a.users.ADMIN.id, fx.a.users.MANAGER.id].sort());
    expect(rows[0]).toMatchObject({ kind: 'defect.new', data: { site: 'Objekt', client: 'HV Nord', text: 'Tor klemmt' } });
  });
});

describe('Texte', () => {
  it('jede Sprache hat jede Art mit denselben Platzhaltern', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const [lang, texts] of Object.entries(NOTIFICATION_TEXTS)) {
      for (const kind of NOTIFICATION_KINDS) {
        expect(texts[kind]?.title, `${lang} ${kind}`).toBeTruthy();
        expect(ph(texts[kind].body), `${lang} ${kind}`).toEqual(ph(NOTIFICATION_TEXTS.de[kind].body));
      }
    }
  });
});
