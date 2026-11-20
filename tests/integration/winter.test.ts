/**
 * Winterdienst: recording, tamper evidence, corrections, isolation.
 * The weather service is faked (no network).
 */
import { Buffer } from 'node:buffer';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listLogs, POST as createLog } from '@/app/api/winter/logs/route';
import { POST as correctLog } from '@/app/api/winter/logs/[id]/correct/route';
import { GET as listSites } from '@/app/api/winter/sites/route';
import { GET as verify } from '@/app/api/winter/verify/route';
import { testDb } from './db-config';
import { call, seed, sql, tokenFor, type CompanyFixture, type Fixtures } from './helpers';

let fx: Fixtures;

beforeEach(async () => {
  fx = await seed();
  await sql`
    UPDATE job_sites SET winter_service_enabled = true, winter_areas = ${sql.array(['Gehweg', 'Eingang'])}, lat = 51.5, lng = 11.9
  `;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('brightsky')) {
      return new Response(JSON.stringify({
        weather: [{ timestamp: '2026-12-10T06:00:00+00:00', temperature: -3.2, condition: 'snow', precipitation: 0.4, source_id: 7 }],
        sources: [{ id: 7, station_name: 'Magdeburg' }],
      }));
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('winter photo test bytes')]);

async function record(company: CompanyFixture, role: Parameters<typeof tokenFor>[1] = 'WORKER', extra: Record<string, unknown> = {}) {
  return call(createLog, '/api/winter/logs', await tokenFor(company, role), {
    siteId: company.jobSiteId,
    activity: 'clearing_gritting',
    gritMaterial: 'salt',
    gritAmountKg: 8,
    areas: ['Gehweg', 'Eingang'],
    lat: 51.501,
    lng: 11.902,
    gpsAccuracyM: 6,
    ...extra,
  });
}

async function get(handler: (req: NextRequest) => Promise<Response>, path: string, token: string) {
  const res = await handler(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, json: await res.json() };
}

describe('recording', () => {
  it('stores a complete, hashed entry with weather and photo', async () => {
    const res = await record(fx.a, 'WORKER', { photo: `data:image/jpeg;base64,${JPEG.toString('base64')}`, notes: 'Glätte am Eingang' });
    expect(res.status).toBe(201);
    const e = res.json.data;
    expect(e).toMatchObject({
      company_id: fx.a.id, chain_seq: '1', activity: 'clearing_gritting', grit_material: 'salt',
      employee_id: fx.a.users.WORKER.id, entered_by: fx.a.users.WORKER.id, prev_hash: null,
      areas: ['Gehweg', 'Eingang'], notes: 'Glätte am Eingang',
    });
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.site_label).toContain('Objekt');
    expect(e.weather).toMatchObject({ provider: 'DWD (Bright Sky)', station: 'Magdeburg', temperatureC: -3.2, condition: 'snow' });
    expect(e.photo_url).toMatch(/^\/api\/media\//);
  });

  it('records without weather when the weather service is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const res = await record(fx.a);
    expect(res.status).toBe(201);
    expect(res.json.data.weather).toBeNull();
  });

  it('is idempotent per clientRequestId (offline retries)', async () => {
    const clientRequestId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const first = await record(fx.a, 'WORKER', { clientRequestId });
    const second = await record(fx.a, 'WORKER', { clientRequestId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.data.id).toBe(first.json.data.id);
    expect(await sql`SELECT 1 FROM winter_service_logs`).toHaveLength(1);
  });

  it('accepts an entry recorded offline two hours ago', async () => {
    const performedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const res = await record(fx.a, 'WORKER', { performedAt });
    expect(res.status).toBe(201);
    expect(new Date(res.json.data.performed_at).toISOString()).toBe(performedAt);
  });

  it.each([
    ['gritting without material', { activity: 'gritting', gritMaterial: null }],
    ['a time four days ago', { performedAt: new Date(Date.now() - 96 * 3600_000).toISOString() }],
    ['a time in the future', { performedAt: new Date(Date.now() + 3600_000).toISOString() }],
    ['half a GPS position', { lat: 51.5, lng: null }],
    ['a non-image photo', { photo: `data:image/jpeg;base64,${Buffer.from('<html>').toString('base64')}` }],
  ])('rejects %s', async (_label, extra) => {
    const res = await record(fx.a, 'WORKER', extra);
    expect(res.status).toBe(400);
    expect(await sql`SELECT 1 FROM winter_service_logs`).toHaveLength(0);
  });

  it('refuses sites without Winterdienst and sites of other companies', async () => {
    await sql`UPDATE job_sites SET winter_service_enabled = false WHERE id = ${fx.a.jobSiteId}`;
    expect((await record(fx.a)).status).toBe(400);
    const foreign = await call(createLog, '/api/winter/logs', await tokenFor(fx.a, 'WORKER'), {
      siteId: fx.b.jobSiteId, activity: 'clearing',
    });
    expect(foreign.status).toBe(404);
  });
});

describe('tamper evidence', () => {
  it('cannot be updated or deleted, not even by direct SQL', async () => {
    const { json } = await record(fx.a);
    await expect(sql`UPDATE winter_service_logs SET notes = 'x' WHERE id = ${json.data.id}`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM winter_service_logs WHERE id = ${json.data.id}`).rejects.toThrow(/append-only/);
  });

  it('keeps one chain per company', async () => {
    await record(fx.a);
    await record(fx.a);
    const b = await record(fx.b);
    expect(b.json.data.chain_seq).toBe('1');
    expect(b.json.data.prev_hash).toBeNull();
  });

  it('verifies an intact chain and pinpoints a manipulated entry', async () => {
    for (let i = 0; i < 3; i++) await record(fx.a);
    const token = await tokenFor(fx.a, 'MANAGER');
    expect((await get(verify, '/api/winter/verify', token)).json).toMatchObject({ valid: true, entries: 3, brokenAt: null });

    // Someone with database owner rights bypasses the trigger and edits entry 2.
    const owner = postgres({ ...testDb, max: 1, onnotice: () => {} });
    try {
      await owner.begin(async tx => {
        await tx`ALTER TABLE winter_service_logs DISABLE TRIGGER winter_logs_no_update`;
        await tx`UPDATE winter_service_logs SET grit_amount_kg = 50 WHERE company_id = ${fx.a.id} AND chain_seq = 2`;
        await tx`ALTER TABLE winter_service_logs ENABLE TRIGGER winter_logs_no_update`;
      });
    } finally {
      await owner.end();
    }
    expect((await get(verify, '/api/winter/verify', token)).json).toMatchObject({ valid: false, entries: 1, brokenAt: 2 });
  });

  it('limits verification to winter.manage', async () => {
    expect((await get(verify, '/api/winter/verify', await tokenFor(fx.a, 'WORKER'))).status).toBe(403);
  });
});

async function correct(company: CompanyFixture, role: Parameters<typeof tokenFor>[1], id: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/winter/logs/${id}/correct`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await tokenFor(company, role)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await correctLog(req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
}

describe('corrections', () => {
  it('appends a correction that supersedes the original, which stays unchanged', async () => {
    const original = (await record(fx.a)).json.data;
    const res = await correct(fx.a, 'MANAGER', original.id, { reason: 'Falsche Menge eingetragen', gritAmountKg: 4 });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      corrects_log_id: original.id,
      correction_reason: 'Falsche Menge eingetragen',
      grit_amount_kg: '4.00',
      employee_id: fx.a.users.WORKER.id,
      entered_by: fx.a.users.MANAGER.id,
      chain_seq: '2',
      prev_hash: original.hash,
    });

    const [stored] = await sql`SELECT grit_amount_kg FROM winter_service_logs WHERE id = ${original.id}`;
    expect(stored.grit_amount_kg).toBe('8.00');

    const list = await get(listLogs, `/api/winter/logs?siteId=${fx.a.jobSiteId}`, await tokenFor(fx.a, 'MANAGER'));
    const byId = Object.fromEntries(list.json.data.map((r: any) => [r.id, r]));
    expect(byId[original.id].superseded_by).toBe(res.json.data.id);
    expect((await get(verify, '/api/winter/verify', await tokenFor(fx.a, 'ADMIN'))).json.valid).toBe(true);
  });

  it('can void an entry, which then no longer counts for today', async () => {
    const original = (await record(fx.a)).json.data;
    const token = await tokenFor(fx.a, 'MANAGER');
    expect((await get(listSites, '/api/winter/sites', token)).json.data[0].entries_today).toBe(1);

    await correct(fx.a, 'MANAGER', original.id, { reason: 'Falsches Objekt gebucht', voided: true });
    expect((await get(listSites, '/api/winter/sites', token)).json.data[0].entries_today).toBe(0);
  });

  it('requires winter.manage, a reason, and an entry of the own company', async () => {
    const a = (await record(fx.a)).json.data;
    expect((await correct(fx.a, 'WORKER', a.id, { reason: 'Korrektur bitte' })).status).toBe(403);
    expect((await correct(fx.a, 'MANAGER', a.id, { reason: 'x' })).status).toBe(400);
    expect((await correct(fx.b, 'MANAGER', a.id, { reason: 'Fremder Eintrag' })).status).toBe(404);
  });
});

describe('reading', () => {
  it('shows workers only their own entries and managers all of their company', async () => {
    await record(fx.a, 'WORKER');
    await record(fx.a, 'WORKER2');
    await record(fx.b, 'WORKER');

    const worker = await get(listLogs, '/api/winter/logs', await tokenFor(fx.a, 'WORKER'));
    expect(worker.json.data.map((r: any) => r.employee_id)).toEqual([fx.a.users.WORKER.id]);

    const manager = await get(listLogs, '/api/winter/logs', await tokenFor(fx.a, 'MANAGER'));
    expect(manager.json.data).toHaveLength(2);
    expect(manager.json.data.every((r: any) => r.company_id === fx.a.id)).toBe(true);
  });

  it('lists only the own company\'s winter sites with today\'s status', async () => {
    await record(fx.a);
    const res = await get(listSites, '/api/winter/sites', await tokenFor(fx.a, 'WORKER'));
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0]).toMatchObject({ id: fx.a.jobSiteId, entries_today: 1, last_activity: 'clearing_gritting', winter_areas: ['Gehweg', 'Eingang'] });
  });
});
