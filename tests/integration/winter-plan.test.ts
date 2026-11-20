/**
 * Automatic Winterdienst tasks in the Tourplan. Forecasts are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as plan } from '@/app/api/winter/plan/route';
import { GET as cron } from '@/app/api/cron/winter-plan/route';
import { POST as createLog } from '@/app/api/winter/logs/route';
import { POST as data } from '@/app/api/data/route';
import { addDays, berlinDate, winterTaskId } from '@/lib/winter-plan';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
const tomorrow = () => addDays(berlinDate(), 1);

function stubForecast(minTemp: number, condition = 'dry') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('brightsky')) {
      return new Response(JSON.stringify({
        weather: [
          { temperature: minTemp + 3, condition: 'dry', precipitation: 0 },
          { temperature: minTemp, condition, precipitation: 0.2 },
        ],
      }));
    }
    return new Response('{}', { status: 404 });
  }));
}

beforeEach(async () => {
  fx = await seed();
  await sql`UPDATE job_sites SET winter_service_enabled = true, lat = 51.5, lng = 11.9`;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const manager = () => tokenFor(fx.a, 'MANAGER');

describe('/api/winter/plan', () => {
  it('previews without creating anything', async () => {
    stubForecast(-3);
    const res = await call(plan, '/api/winter/plan', await manager(), { dryRun: true });
    expect(res.status).toBe(200);
    expect(res.json.sites[0]).toMatchObject({ risk: true, status: 'created' });
    expect(res.json.created).toBe(0);
    expect(await sql`SELECT 1 FROM job_assignments WHERE 'WINTERDIENST' = ANY(categories)`).toHaveLength(0);
  });

  it('creates one draft task per site on a frosty day, and never twice', async () => {
    stubForecast(-3);
    const first = await call(plan, '/api/winter/plan', await manager(), {});
    expect(first.json.created).toBe(1);

    const [task] = await sql`SELECT * FROM job_assignments WHERE id = ${winterTaskId(fx.a.jobSiteId, tomorrow())}`;
    expect(task).toMatchObject({
      company_id: fx.a.id, job_site_id: fx.a.jobSiteId, title: 'Winterdienst',
      categories: ['WINTERDIENST'], status: 'PENDING', is_plan_published: false, assigned_worker_ids: [],
    });

    const second = await call(plan, '/api/winter/plan', await manager(), {});
    expect(second.json.created).toBe(0);
    expect(second.json.sites[0].status).toBe('exists');
    // Company B was not touched.
    expect(await sql`SELECT 1 FROM job_assignments WHERE company_id = ${fx.b.id} AND 'WINTERDIENST' = ANY(categories)`).toHaveLength(0);
  });

  it('reuses the workers of the site\'s last Winterdienst and publishes right away', async () => {
    await sql`
      INSERT INTO job_assignments (id, company_id, job_site_id, title, scheduled_date, assigned_worker_ids, categories, is_plan_published)
      VALUES ('old-winter', ${fx.a.id}, ${fx.a.jobSiteId}, 'Winterdienst', ${addDays(berlinDate(), -3)},
              ${sql.array([fx.a.worker2.id])}, ${sql.array(['WINTERDIENST'])}, true)
    `;
    stubForecast(-1);
    await call(plan, '/api/winter/plan', await manager(), {});
    const [task] = await sql`SELECT assigned_worker_ids, is_plan_published FROM job_assignments WHERE id = ${winterTaskId(fx.a.jobSiteId, tomorrow())}`;
    expect(task).toEqual({ assigned_worker_ids: [fx.a.worker2.id], is_plan_published: true });
  });

  it('skips mild days unless forced, and treats snow as a risk at any temperature', async () => {
    stubForecast(5);
    expect((await call(plan, '/api/winter/plan', await manager(), {})).json.sites[0].status).toBe('skipped');
    stubForecast(3, 'snow');
    expect((await call(plan, '/api/winter/plan', await manager(), { dryRun: true })).json.sites[0].risk).toBe(true);
    stubForecast(5);
    expect((await call(plan, '/api/winter/plan', await manager(), { force: true })).json.created).toBe(1);
  });

  it('uses each company\'s own temperature threshold', async () => {
    stubForecast(4);
    await sql`UPDATE companies SET winter_plan_min_temp_c = 5 WHERE id = ${fx.a.id}`;
    expect((await call(plan, '/api/winter/plan', await manager(), { dryRun: true })).json.sites[0].risk).toBe(true);
    expect((await call(plan, '/api/winter/plan', await tokenFor(fx.b, 'MANAGER'), { dryRun: true })).json.sites[0].risk).toBe(false);
  });

  it('reports sites without any position as "no forecast"', async () => {
    stubForecast(-5);
    await sql`UPDATE job_sites SET lat = NULL, lng = NULL WHERE id = ${fx.a.jobSiteId}`;
    expect((await call(plan, '/api/winter/plan', await manager(), { dryRun: true })).json.sites[0].status).toBe('no_forecast');
  });

  it('requires winter.manage and a date from today to 7 days ahead', async () => {
    stubForecast(-3);
    expect((await call(plan, '/api/winter/plan', await tokenFor(fx.a, 'WORKER'), {})).status).toBe(403);
    expect((await call(plan, '/api/winter/plan', await manager(), { date: addDays(berlinDate(), -1) })).status).toBe(400);
    expect((await call(plan, '/api/winter/plan', await manager(), { date: addDays(berlinDate(), 8) })).status).toBe(400);
  });
});

describe('recording work completes the day\'s task', () => {
  it('marks today\'s Winterdienst task as done', async () => {
    stubForecast(-3);
    await call(plan, '/api/winter/plan', await manager(), { date: berlinDate() });
    await call(createLog, '/api/winter/logs', await tokenFor(fx.a, 'WORKER'), { siteId: fx.a.jobSiteId, activity: 'clearing' });
    const [task] = await sql`SELECT status FROM job_assignments WHERE id = ${winterTaskId(fx.a.jobSiteId, berlinDate())}`;
    expect(task.status).toBe('COMPLETED');
  });
});

describe('/api/cron/winter-plan', () => {
  const cronRequest = (secret?: string, day?: string) =>
    new NextRequest(`http://localhost/api/cron/winter-plan${day ? `?day=${day}` : ''}`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });

  it('is disabled without CRON_SECRET and rejects a wrong secret', async () => {
    expect((await cron(cronRequest('x'.repeat(20)))).status).toBe(503);
    process.env.CRON_SECRET = 'a-long-enough-cron-secret';
    expect((await cron(cronRequest('wrong-secret-of-same-len'))).status).toBe(401);
  });

  it('plans tomorrow for every company with automatic planning on', async () => {
    stubForecast(-4);
    process.env.CRON_SECRET = 'a-long-enough-cron-secret';
    await sql`UPDATE companies SET winter_auto_plan = false WHERE id = ${fx.b.id}`;
    const res = await cron(cronRequest('a-long-enough-cron-secret'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ date: tomorrow(), companies: [{ companyId: fx.a.id, created: 1 }] });
    expect(await sql`SELECT company_id FROM job_assignments WHERE 'WINTERDIENST' = ANY(categories)`).toEqual([{ company_id: fx.a.id }]);
  });
});

describe('site setup from the Objekte dialog', () => {
  it('stores Winterdienst, areas and notes through the data API', async () => {
    const res = await call(data, '/api/data', await tokenFor(fx.a, 'ADMIN'), {
      action: 'update', table: 'job_sites', filters: { id: fx.a.jobSiteId },
      data: { winter_service_enabled: true, winter_areas: ['Gehweg', 'Parkplatz'], winter_notes: 'ab 7 Uhr' },
    });
    expect(res.status).toBe(200);
    const [site] = await sql`SELECT winter_areas, winter_notes FROM job_sites WHERE id = ${fx.a.jobSiteId}`;
    expect(site).toEqual({ winter_areas: ['Gehweg', 'Parkplatz'], winter_notes: 'ab 7 Uhr' });
  });
});
