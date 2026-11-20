/**
 * Kundenportal (Hausverwaltung): Abschottung, Leistungsnachweis, Winterdienst,
 * Fotos, Mängelmeldungen → Tourplan, Verwaltung der Hausverwaltungen.
 */
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTokenString } from '@/lib/auth-server';
import { POST as dataApi } from '@/app/api/data/route';
import { GET as internalReport } from '@/app/api/reports/leistungsnachweis/route';
import { GET as internalMedia } from '@/app/api/media/[id]/route';
import { GET as winterLogs, POST as recordWinter } from '@/app/api/winter/logs/route';
import { POST as check } from '@/app/api/checks/route';
import { GET as overview } from '@/app/api/portal/overview/route';
import { GET as portalReport } from '@/app/api/portal/leistungsnachweis/route';
import { GET as portalWinter } from '@/app/api/portal/winter/route';
import { GET as listDefects, POST as reportDefect } from '@/app/api/portal/defects/route';
import { GET as portalMedia } from '@/app/api/portal/media/[id]/route';
import { GET as listClients, POST as createClient, PATCH as updateClient, DELETE as deleteClient } from '@/app/api/clients/route';
import { POST as createLogin, DELETE as deleteLogin } from '@/app/api/clients/logins/route';
import { GET as adminDefects, PATCH as updateDefect } from '@/app/api/defects/route';
import { berlinToday } from '@/lib/portal';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('portal photo')]).toString('base64')}`;
const MONTH = '2026-11';

const CLIENT_USER = '00000000-0000-4000-8000-c00000000001';
const OTHER_CLIENT_USER = '00000000-0000-4000-8000-c00000000002';

async function clientToken(userId = CLIENT_USER) {
  const [u] = await sql`SELECT id, company_id, name, email FROM users WHERE id = ${userId}`;
  return createTokenString({ userId: u.id, companyId: u.company_id, role: 'CLIENT', name: u.name, email: u.email });
}

function get(handler: (req: NextRequest, ctx?: any) => Promise<Response>, path: string, token: string, ctx?: unknown) {
  return handler(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }), ctx)
    .then(async res => ({ status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null }));
}

function send(handler: (req: NextRequest) => Promise<Response>, method: string, path: string, token: string, body?: unknown) {
  return handler(new NextRequest(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })).then(async res => ({ status: res.status, json: await res.json() }));
}

beforeEach(async () => {
  fx = await seed();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  // Firma A: Hausverwaltung "HV Nord" mit Objekt site-a; zweite HV "HV Süd" mit eigenem Objekt.
  await sql`INSERT INTO clients (id, company_id, name) VALUES ('client-nord', 'co-a', 'HV Nord'), ('client-sued', 'co-a', 'HV Süd')`;
  await sql`UPDATE job_sites SET client_id = 'client-nord', winter_service_enabled = true, lat = 51.5, lng = 11.9 WHERE id = 'site-a'`;
  await sql`INSERT INTO job_sites (id, company_id, name, address, city, client_id) VALUES ('site-sued', 'co-a', 'Südhaus', 'Weg 2', 'Stadt', 'client-sued')`;
  await sql`
    INSERT INTO users (id, company_id, name, email, password_hash, role, client_id) VALUES
      (${CLIENT_USER}, 'co-a', 'Frau Nord', 'nord@hv.test', 'x', 'CLIENT', 'client-nord'),
      (${OTHER_CLIENT_USER}, 'co-a', 'Herr Süd', 'sued@hv.test', 'x', 'CLIENT', 'client-sued')
  `;
  await sql`UPDATE job_sites SET services = ${sql.json({ Gullis: { isActive: true, months: ['Nov.'] } })} WHERE id = 'site-a'`;
  await sql`UPDATE job_assignments SET categories = ${sql.array(['Gullis'])} WHERE id = 'job-a'`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('abschottung des portal-logins', () => {
  it('gilt in allen internen APIs als nicht angemeldet', async () => {
    const token = await clientToken();
    for (const table of ['users', 'job_sites', 'job_assignments', 'time_entries', 'work_log_entries', 'companies']) {
      expect((await call(dataApi, '/api/data', token, { action: 'query', table })).status, table).toBe(401);
    }
    expect((await get(internalReport, `/api/reports/leistungsnachweis?siteId=site-a&month=${MONTH}`, token)).status).toBe(401);
    expect((await get(winterLogs, '/api/winter/logs', token)).status).toBe(401);
    expect((await get(listClients, '/api/clients', token)).status).toBe(401);
  });

  it('wird ohne Zuordnung zu einer Hausverwaltung auch im Portal abgewiesen', async () => {
    // Ein Token mit role CLIENT für einen Mitarbeiter (client_id NULL) darf nichts.
    const forged = await createTokenString({ userId: fx.a.users.WORKER.id, companyId: 'co-a', role: 'CLIENT', name: 'x', email: 'x' });
    expect((await get(overview, '/api/portal/overview', forged)).status).toBe(403);
  });

  it('Mitarbeiter-Logins kommen nicht ins Portal', async () => {
    for (const role of ['ADMIN', 'WORKER'] as const) {
      expect((await get(overview, '/api/portal/overview', await tokenFor(fx.a, role))).status).toBe(403);
    }
  });

  it('Portal-Logins erscheinen nicht im Team und lassen sich dort nicht ändern', async () => {
    const admin = await tokenFor(fx.a, 'ADMIN');
    const team = await call(dataApi, '/api/data', admin, { action: 'query', table: 'users' });
    expect(team.json.data.some((u: any) => u.role === 'CLIENT')).toBe(false);
    await call(dataApi, '/api/data', admin, { action: 'update', table: 'users', filters: { id: CLIENT_USER }, data: { name: 'gekapert' } });
    await call(dataApi, '/api/data', admin, { action: 'delete', table: 'users', filters: { id: CLIENT_USER } });
    const [u] = await sql`SELECT name FROM users WHERE id = ${CLIENT_USER}`;
    expect(u.name).toBe('Frau Nord');
  });
});

describe('übersicht und objekte', () => {
  it('zeigt nur die Objekte der eigenen Hausverwaltung', async () => {
    const res = await get(overview, '/api/portal/overview', await clientToken());
    expect(res.status).toBe(200);
    expect(res.json.client.name).toBe('HV Nord');
    expect(res.json.provider.name).toBe('Company A');
    expect(res.json.sites.map((s: any) => s.id)).toEqual(['site-a']);
  });

  it('fremde Objekte (andere HV, andere Firma) sind nicht abrufbar', async () => {
    const token = await clientToken();
    for (const siteId of ['site-sued', 'site-b']) {
      expect((await get(portalReport, `/api/portal/leistungsnachweis?siteId=${siteId}&month=${MONTH}`, token)).status).toBe(404);
      expect((await get(portalWinter, `/api/portal/winter?siteId=${siteId}&month=${MONTH}`, token)).status).toBe(404);
    }
  });
});

describe('leistungsnachweis im portal', () => {
  beforeEach(async () => {
    const res = await call(check, '/api/checks', await tokenFor(fx.a, 'WORKER'), {
      assignmentId: 'job-a', serviceCode: 'Gullis', status: 'done', afterPhoto: JPEG,
    });
    expect(res.status).toBe(200);
  });

  it('blendet Mitarbeiternamen standardmäßig aus und liefert Fotos über die Portal-Route', async () => {
    const token = await clientToken();
    const res = await get(portalReport, `/api/portal/leistungsnachweis?siteId=site-a&month=${MONTH}`, token);
    expect(res.status).toBe(200);
    expect(res.json.showWorkerNames).toBe(false);
    expect(res.json.totals).toMatchObject({ planned: 1, done: 1 });
    const visit = res.json.visits[0];
    expect(visit.workers).toEqual([]);
    expect(visit.items[0].employeeName).toBeNull();
    expect(visit.items[0].afterUrl).toMatch(/^\/api\/portal\/media\//);
    expect(JSON.stringify(res.json)).not.toContain('WORKER a');

    const mediaId = visit.items[0].afterUrl.split('/').pop();
    const own = await portalMedia(new NextRequest(`http://localhost${visit.items[0].afterUrl}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: mediaId }) });
    expect(own.status).toBe(200);
    // Die andere Hausverwaltung derselben Firma sieht das Foto nicht.
    const other = await portalMedia(new NextRequest(`http://localhost${visit.items[0].afterUrl}`, { headers: { authorization: `Bearer ${await clientToken(OTHER_CLIENT_USER)}` } }), { params: Promise.resolve({ id: mediaId }) });
    expect(other.status).toBe(404);
    // Und die interne Medien-Route bleibt für den Kunden zu.
    const internal = await internalMedia(new NextRequest(`http://localhost/api/media/${mediaId}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: mediaId }) });
    expect(internal.status).toBe(401);
  });

  it('zeigt Namen, wenn der Dienstleister es einstellt', async () => {
    await sql`UPDATE companies SET portal_show_worker_names = true WHERE id = 'co-a'`;
    const res = await get(portalReport, `/api/portal/leistungsnachweis?siteId=site-a&month=${MONTH}`, await clientToken());
    expect(res.json.visits[0].workers).toEqual(['WORKER a']);
    expect(res.json.visits[0].items[0].employeeName).toBe('WORKER a');
  });

  it('zeigt unveröffentlichte Einsätze nicht', async () => {
    await sql`UPDATE job_assignments SET is_plan_published = false WHERE id = 'job-a'`;
    const res = await get(portalReport, `/api/portal/leistungsnachweis?siteId=site-a&month=${MONTH}`, await clientToken());
    expect(res.json.visits).toEqual([]);
  });
});

describe('winterdienst im portal', () => {
  it('zeigt die Einsätze des Monats mit gültiger Kette, ohne Mitarbeiternamen', async () => {
    const rec = await call(recordWinter, '/api/winter/logs', await tokenFor(fx.a, 'WORKER'), {
      siteId: 'site-a', activity: 'gritting', gritMaterial: 'salt', gritAmountKg: 5, areas: ['Gehweg'],
      photo: JPEG,
    });
    expect(rec.status).toBe(201);
    const thisMonth = berlinToday().slice(0, 7);
    const res = await get(portalWinter, `/api/portal/winter?siteId=site-a&month=${thisMonth}`, await clientToken());
    expect(res.status).toBe(200);
    expect(res.json.chainValid).toBe(true);
    expect(res.json.entries).toHaveLength(1);
    expect(res.json.entries[0]).toMatchObject({ activityLabel: 'Streuen', material: 'Streusalz', amountKg: 5, employeeName: null });
    expect(res.json.entries[0].photoUrl).toMatch(/^\/api\/portal\/media\//);
    const other = await get(portalWinter, '/api/portal/winter?siteId=site-a&month=2020-01', await clientToken());
    expect(other.json.entries).toHaveLength(0);
  });
});

describe('mängelmeldung', () => {
  it('legt eine Tourplan-Aufgabe an, deren Fortschritt der Kunde sieht', async () => {
    const token = await clientToken();
    const res = await send(reportDefect, 'POST', '/api/portal/defects', token, {
      siteId: 'site-a', title: 'Haustür schließt nicht', description: 'Seit gestern', photo: JPEG,
    });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ status: 'open', title: 'Haustür schließt nicht' });
    expect(res.json.data.photoUrl).toMatch(/^\/api\/portal\/media\//);

    const [d] = await sql`SELECT * FROM defect_reports`;
    const [a] = await sql`SELECT * FROM job_assignments WHERE id = ${d.job_assignment_id}`;
    expect(a).toMatchObject({ job_site_id: 'site-a', is_plan_published: false, status: 'PENDING' });
    expect(a.title).toBe('Mängelmeldung: Haustür schließt nicht');
    expect(a.categories).toEqual(['MAENGEL']);

    await sql`UPDATE job_assignments SET is_plan_published = true WHERE id = ${a.id}`;
    expect((await get(listDefects, '/api/portal/defects', token)).json.data[0].status).toBe('scheduled');
    await sql`UPDATE job_assignments SET status = 'COMPLETED' WHERE id = ${a.id}`;
    expect((await get(listDefects, '/api/portal/defects', token)).json.data[0].status).toBe('done');

    // Die andere HV sieht die Meldung nicht.
    expect((await get(listDefects, '/api/portal/defects', await clientToken(OTHER_CLIENT_USER))).json.data).toEqual([]);
  });

  it('nimmt keine Meldungen für fremde Objekte an', async () => {
    const res = await send(reportDefect, 'POST', '/api/portal/defects', await clientToken(), { siteId: 'site-sued', title: 'x' });
    expect(res.status).toBe(404);
    expect((await sql`SELECT count(*)::int AS n FROM job_assignments WHERE id LIKE 'mangel-%'`)[0].n).toBe(0);
  });

  it('der Dienstleister kann ablehnen – nur mit Begründung', async () => {
    await send(reportDefect, 'POST', '/api/portal/defects', await clientToken(), { siteId: 'site-a', title: 'Laub' });
    const manager = await tokenFor(fx.a, 'MANAGER');
    const list = await get(adminDefects, '/api/defects', manager);
    expect(list.json.data[0]).toMatchObject({ clientName: 'HV Nord', siteName: 'Objekt', status: 'open' });
    const id = list.json.data[0].id;
    expect((await send(updateDefect, 'PATCH', '/api/defects', manager, { id, status: 'rejected' })).status).toBe(400);
    expect((await send(updateDefect, 'PATCH', '/api/defects', manager, { id, status: 'rejected', response: 'Gehört zum Gartenvertrag' })).status).toBe(200);
    const seen = (await get(listDefects, '/api/portal/defects', await clientToken())).json.data[0];
    expect(seen).toMatchObject({ status: 'rejected', response: 'Gehört zum Gartenvertrag' });
    // Andere Firma kommt nicht dran.
    expect((await send(updateDefect, 'PATCH', '/api/defects', await tokenFor(fx.b, 'ADMIN'), { id, status: 'done' })).status).toBe(404);
    expect((await get(adminDefects, '/api/defects', await tokenFor(fx.a, 'WORKER'))).status).toBe(403);
  });
});

describe('verwaltung der hausverwaltungen', () => {
  it('Admin legt HV an, ordnet Objekte zu und erstellt einen Zugang', async () => {
    const admin = await tokenFor(fx.a, 'ADMIN');
    const created = await send(createClient, 'POST', '/api/clients', admin, { name: 'HV West', email: 'info@west.test', siteIds: ['site-sued', 'site-b'] });
    expect(created.status).toBe(201);
    const [moved] = await sql`SELECT client_id FROM job_sites WHERE id = 'site-sued'`;
    expect(moved.client_id).toBe(created.json.id);
    // Objekt einer anderen Firma wird nicht angefasst.
    expect((await sql`SELECT client_id FROM job_sites WHERE id = 'site-b'`)[0].client_id).toBeNull();

    const login = await send(createLogin, 'POST', '/api/clients/logins', admin, {
      clientId: created.json.id, name: 'Frau West', email: 'West@HV.test', password: 'sehr-sicheres-pw-1',
    });
    expect(login.status).toBe(201);
    const [u] = await sql`SELECT role, client_id, email FROM users WHERE id = ${login.json.id}`;
    expect(u).toMatchObject({ role: 'CLIENT', client_id: created.json.id, email: 'west@hv.test' });

    const dup = await send(createLogin, 'POST', '/api/clients/logins', admin, {
      clientId: created.json.id, name: 'X', email: 'admin@a.test', password: 'sehr-sicheres-pw-1',
    });
    expect(dup.status).toBe(409);

    const list = await get(listClients, '/api/clients', admin);
    const west = list.json.clients.find((c: any) => c.name === 'HV West');
    expect(west.sites.map((s: any) => s.id)).toEqual(['site-sued']);
    expect(west.logins.map((l: any) => l.email)).toEqual(['west@hv.test']);

    // Zuordnung ersetzen: site-sued wieder frei.
    expect((await send(updateClient, 'PATCH', '/api/clients', admin, { id: created.json.id, name: 'HV West', siteIds: [] })).status).toBe(200);
    expect((await sql`SELECT client_id FROM job_sites WHERE id = 'site-sued'`)[0].client_id).toBeNull();

    const removed = await deleteLogin(new NextRequest(`http://localhost/api/clients/logins?userId=${login.json.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } }));
    expect(removed.status).toBe(200);
    // Mitarbeiter lassen sich über diese Route nicht löschen.
    const notClient = await deleteLogin(new NextRequest(`http://localhost/api/clients/logins?userId=${fx.a.users.WORKER.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } }));
    expect(notClient.status).toBe(404);
  });

  it('Manager verwaltet HVs, aber keine Zugänge; Mitarbeiter gar nichts', async () => {
    const manager = await tokenFor(fx.a, 'MANAGER');
    expect((await send(createClient, 'POST', '/api/clients', manager, { name: 'HV M' })).status).toBe(201);
    expect((await send(createLogin, 'POST', '/api/clients/logins', manager, {
      clientId: 'client-nord', name: 'X', email: 'x@hv.test', password: 'sehr-sicheres-pw-1',
    })).status).toBe(403);
    expect((await get(listClients, '/api/clients', await tokenFor(fx.a, 'WORKER'))).status).toBe(403);
    expect((await send(createClient, 'POST', '/api/clients', await tokenFor(fx.a, 'LEADER'), { name: 'HV L' })).status).toBe(403);
  });

  it('Löschen der HV entfernt ihre Zugänge sofort', async () => {
    const token = await clientToken();
    const admin = await tokenFor(fx.a, 'ADMIN');
    const res = await deleteClient(new NextRequest('http://localhost/api/clients?id=client-nord', { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } }));
    expect(res.status).toBe(200);
    expect((await get(overview, '/api/portal/overview', token)).status).toBe(401);
    expect((await sql`SELECT client_id FROM job_sites WHERE id = 'site-a'`)[0].client_id).toBeNull();
    // Firma B kann HVs von A nicht löschen.
    const b = await deleteClient(new NextRequest('http://localhost/api/clients?id=client-sued', { method: 'DELETE', headers: { authorization: `Bearer ${await tokenFor(fx.b, 'ADMIN')}` } }));
    expect(b.status).toBe(404);
  });
});
