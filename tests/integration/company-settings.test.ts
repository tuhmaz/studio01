/**
 * Per-company settings: headquarters, travel rules, overview, travel times.
 * Nominatim and OSRM are replaced by a fake fetch, so no network is used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as data } from '@/app/api/data/route';
import { POST as geocode } from '@/app/api/geocode/route';
import { POST as geoRoute } from '@/app/api/geo/route/route';
import { POST as hq } from '@/app/api/settings/hq/route';
import { GET as overview } from '@/app/api/settings/overview/route';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;

beforeEach(async () => {
  fx = await seed();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fake Nominatim (fixed point) and OSRM (fixed distance/duration). */
function stubGeoServices({ km, minutes }: { km: number; minutes: number }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes('nominatim')) {
      return new Response(JSON.stringify([{ lat: '51.5', lon: '11.9', display_name: 'Fake Straße 1, Halle' }]));
    }
    if (url.includes('router.project-osrm.org')) {
      return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: km * 1000, duration: minutes * 60 }] }));
    }
    return new Response('not found', { status: 404 });
  }));
  return calls;
}

async function getOverview(role: Parameters<typeof tokenFor>[1]) {
  const req = new NextRequest('http://localhost/api/settings/overview', {
    headers: { authorization: `Bearer ${await tokenFor(fx.a, role)}` },
  });
  const res = await overview(req);
  return { status: res.status, json: await res.json() };
}

describe('/api/settings/overview', () => {
  it('reports setup progress, travel rules and storage for the admin\'s company only', async () => {
    const res = await getOverview('ADMIN');
    expect(res.status).toBe(200);
    expect(res.json.setup).toMatchObject({ hqLocated: false, jobSites: 1, workers: 3, publishedAssignments: 1 });
    expect(res.json.travel).toEqual({ hqLat: null, hqLng: null, remoteThresholdKm: 95, remoteBonusMinutes: 60 });
    expect(res.json.media).toEqual({ files: 0, bytes: 0, inlineLegacy: 0 });
    expect(res.json.platform).toBeNull();
  });

  it('shows server details to SUPER_ADMIN only', async () => {
    const res = await getOverview('SUPER_ADMIN');
    expect(res.json.platform.storageDriver).toBe('local');
    expect(res.json.platform.migrations.pending).toEqual([]);
  });

  it('is limited to settings.manage', async () => {
    for (const role of ['MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'] as const) {
      expect((await getOverview(role)).status, role).toBe(403);
    }
  });
});

describe('/api/settings/hq', () => {
  it('stores explicit coordinates for the caller\'s company and audits it', async () => {
    const res = await call(hq, '/api/settings/hq', await tokenFor(fx.a, 'ADMIN'), { lat: 52.5, lng: 13.4 });
    expect(res.status).toBe(200);
    const [a] = await sql`SELECT hq_lat, hq_lng FROM companies WHERE id = ${fx.a.id}`;
    const [b] = await sql`SELECT hq_lat FROM companies WHERE id = ${fx.b.id}`;
    expect([Number(a.hq_lat), Number(a.hq_lng)]).toEqual([52.5, 13.4]);
    expect(b.hq_lat).toBeNull();
    const audit = await sql`SELECT action FROM audit_logs WHERE company_id = ${fx.a.id}`;
    expect(audit.map(r => r.action)).toContain('company.hq_updated');
  });

  it('geocodes the saved company address', async () => {
    stubGeoServices({ km: 10, minutes: 12 });
    await sql`UPDATE companies SET address = 'Hauptstr. 1', city = 'Halle' WHERE id = ${fx.a.id}`;
    const res = await call(hq, '/api/settings/hq', await tokenFor(fx.a, 'ADMIN'), {});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ lat: 51.5, lng: 11.9 });
  });

  it('asks for an address first when none is saved', async () => {
    const res = await call(hq, '/api/settings/hq', await tokenFor(fx.a, 'ADMIN'), {});
    expect(res.status).toBe(400);
  });

  it('rejects invalid coordinates and non-admins', async () => {
    expect((await call(hq, '/api/settings/hq', await tokenFor(fx.a, 'ADMIN'), { lat: 200, lng: 0 })).status).toBe(400);
    expect((await call(hq, '/api/settings/hq', await tokenFor(fx.a, 'MANAGER'), { lat: 1, lng: 1 })).status).toBe(403);
  });
});

describe('travel rules', () => {
  it('can be changed through the settings form and are range-checked by the database', async () => {
    const token = await tokenFor(fx.a, 'ADMIN');
    const ok = await call(data, '/api/data', token, {
      action: 'update', table: 'companies', filters: { id: fx.a.id }, data: { remote_threshold_km: 80, remote_bonus_minutes: 45 },
    });
    expect(ok.status).toBe(200);
    const bad = await call(data, '/api/data', token, {
      action: 'update', table: 'companies', filters: { id: fx.a.id }, data: { remote_bonus_minutes: 5000 },
    });
    expect(bad.status).toBe(400);
  });

  it('/api/geo/route applies the company\'s own threshold and bonus', async () => {
    stubGeoServices({ km: 85, minutes: 70 });
    await sql`UPDATE companies SET hq_lat = 52, hq_lng = 11.7, remote_threshold_km = 80, remote_bonus_minutes = 45 WHERE id = ${fx.a.id}`;
    await sql`UPDATE companies SET hq_lat = 52, hq_lng = 11.7 WHERE id = ${fx.b.id}`;

    const a = await call(geoRoute, '/api/geo/route', await tokenFor(fx.a, 'MANAGER'), { address: 'x', city: 'Halle' });
    expect(a.json).toMatchObject({ distanceKm: 85, travelMinutes: 115, isRemote: true, hqMissing: false });

    // Company B keeps the defaults (95 km / 60 min), so 85 km is not remote there.
    const b = await call(geoRoute, '/api/geo/route', await tokenFor(fx.b, 'MANAGER'), { address: 'x', city: 'Halle' });
    expect(b.json).toMatchObject({ distanceKm: 85, travelMinutes: 70, isRemote: false });
  });

  it('/api/geo/route returns coordinates but no travel time without a headquarters', async () => {
    stubGeoServices({ km: 10, minutes: 10 });
    const res = await call(geoRoute, '/api/geo/route', await tokenFor(fx.a, 'ADMIN'), { city: 'Halle' });
    expect(res.json).toMatchObject({ lat: 51.5, lng: 11.9, hqMissing: true, distanceKm: null });
  });

  it('recalculating all sites requires a headquarters and only touches the own company', async () => {
    const token = await tokenFor(fx.a, 'ADMIN');
    expect((await call(geocode, '/api/geocode', token, { recalculate: true })).status).toBe(400);

    stubGeoServices({ km: 120, minutes: 90 });
    await sql`UPDATE companies SET hq_lat = 52, hq_lng = 11.7 WHERE id = ${fx.a.id}`;
    await sql`UPDATE job_sites SET lat = 51, lng = 12`;
    const res = await call(geocode, '/api/geocode', token, { recalculate: true });
    expect(res.status).toBe(200);
    expect(res.json.routed).toBe(1);

    const [a] = await sql`SELECT distance_from_hq, travel_time_from_hq, is_remote FROM job_sites WHERE id = ${fx.a.jobSiteId}`;
    expect(a).toEqual({ distance_from_hq: '120', travel_time_from_hq: 150, is_remote: true });
    const [b] = await sql`SELECT distance_from_hq, is_remote FROM job_sites WHERE id = ${fx.b.jobSiteId}`;
    expect(b).toEqual({ distance_from_hq: null, is_remote: false });
  });
});
