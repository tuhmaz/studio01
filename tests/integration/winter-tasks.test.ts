/**
 * Verbindung Tourplan/Einsatzplanung ↔ Streuprotokoll:
 * Aufgaben mit WINTERDIENST, Protokoll-Status, Nachtrag durch das Büro,
 * automatisches Abschließen beim Protokollieren.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createLog } from '@/app/api/winter/logs/route';
import { GET as listSites } from '@/app/api/winter/sites/route';
import { GET as listTasks } from '@/app/api/winter/tasks/route';
import { POST as dataApi } from '@/app/api/data/route';
import { berlinDate } from '@/lib/winter-plan';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
const today = berlinDate();

beforeEach(async () => {
  fx = await seed();
  await sql`UPDATE job_sites SET winter_service_enabled = true, winter_areas = ${sql.array(['Gehweg'])}, lat = 51.5, lng = 11.9`;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});

afterEach(() => vi.unstubAllGlobals());

async function get(handler: (req: NextRequest) => Promise<Response>, path: string, token: string) {
  const res = await handler(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, json: await res.json() };
}

/** Wie die Einsatzplanung: Aufgabe für heute mit dem Mitarbeiter von Firma A. */
async function planTask(categories: string[], id = 'assign-winter-1') {
  const res = await call(dataApi, '/api/data', await tokenFor(fx.a, 'MANAGER'), {
    action: 'insert',
    table: 'job_assignments',
    data: {
      id,
      company_id: 'co-a',
      job_site_id: fx.a.jobSiteId,
      assigned_worker_ids: [fx.a.users.WORKER.id],
      scheduled_date: today,
      title: 'Winterdienst',
      status: 'PENDING',
      is_plan_published: true,
      categories,
    },
  });
  expect(res.status).toBe(200);
  return id;
}

describe('Winterdienst-Aufgaben aus der Einsatzplanung', () => {
  it('erledigt ohne Protokoll → "missing", nach Nachtrag durch das Büro → "documented"', async () => {
    const id = await planTask(['WINTERDIENST']);
    const manager = await tokenFor(fx.a, 'MANAGER');

    let tasks = await get(listTasks, '/api/winter/tasks', manager);
    expect(tasks.json.data).toHaveLength(1);
    expect(tasks.json.data[0]).toMatchObject({ id, protocol: 'pending', workers: ['WORKER a'] });

    // Mitarbeiter stempelt aus → Aufgabe erledigt, aber kein Eintrag.
    await sql`UPDATE job_assignments SET status = 'COMPLETED' WHERE id = ${id}`;
    tasks = await get(listTasks, '/api/winter/tasks', manager);
    expect(tasks.json.data[0].protocol).toBe('missing');
    expect(tasks.json.missing).toBe(1);
    const sites = await get(listSites, '/api/winter/sites', manager);
    expect(sites.json.data[0]).toMatchObject({ entries_today: 0, task_status_today: 'COMPLETED', task_workers_today: ['WORKER a'] });

    // Büro trägt für den Mitarbeiter nach.
    const res = await call(createLog, '/api/winter/logs', manager, {
      siteId: fx.a.jobSiteId, activity: 'clearing', areas: ['Gehweg'],
      employeeId: fx.a.users.WORKER.id, lat: 52.1, lng: 11.6,
      performedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    expect(res.status).toBe(201);
    const [log] = await sql`SELECT employee_name, entered_by_name, lat, lng FROM winter_service_logs`;
    // Gearbeitet hat der Mitarbeiter, erfasst hat das Büro; die Büro-Position wird nicht gespeichert.
    expect(log).toMatchObject({ employee_name: 'WORKER a', entered_by_name: 'MANAGER a', lat: null, lng: null });

    tasks = await get(listTasks, '/api/winter/tasks', manager);
    expect(tasks.json.data[0].protocol).toBe('documented');
  });

  it('Mitarbeiter dürfen nicht für andere erfassen, und nur Mitarbeiter der eigenen Firma', async () => {
    const worker = await tokenFor(fx.a, 'WORKER');
    const asOther = await call(createLog, '/api/winter/logs', worker, {
      siteId: fx.a.jobSiteId, activity: 'clearing', employeeId: fx.a.users.LEADER.id,
    });
    expect(asOther.status).toBe(403);
    const foreign = await call(createLog, '/api/winter/logs', await tokenFor(fx.a, 'MANAGER'), {
      siteId: fx.a.jobSiteId, activity: 'clearing', employeeId: fx.b.users.WORKER.id,
    });
    expect(foreign.status).toBe(404);
  });

  it('der Eintrag schließt eine reine Winterdienst-Aufgabe ab, aber keine mit weiteren Leistungen', async () => {
    const pure = await planTask(['WINTERDIENST'], 'assign-pure');
    await call(createLog, '/api/winter/logs', await tokenFor(fx.a, 'WORKER'), { siteId: fx.a.jobSiteId, activity: 'clearing' });
    expect((await sql`SELECT status FROM job_assignments WHERE id = ${pure}`)[0].status).toBe('COMPLETED');

    await sql`DELETE FROM job_assignments WHERE id = ${pure}`;
    const mixed = await planTask(['WINTERDIENST', 'Gullis'], 'assign-mixed');
    await call(createLog, '/api/winter/logs', await tokenFor(fx.a, 'WORKER'), { siteId: fx.a.jobSiteId, activity: 'clearing' });
    expect((await sql`SELECT status FROM job_assignments WHERE id = ${mixed}`)[0].status).toBe('PENDING');
  });

  it('bleibt offen, solange noch jemand eingestempelt ist', async () => {
    const id = await planTask(['WINTERDIENST'], 'assign-clocked');
    await sql`
      INSERT INTO time_entries (id, company_id, employee_id, job_assignment_id, job_site_id, clock_in_datetime, status)
      VALUES ('te-open', 'co-a', ${fx.a.users.WORKER.id}, ${id}, ${fx.a.jobSiteId}, now(), 'OPEN')
    `;
    await sql`UPDATE job_assignments SET status = 'IN_PROGRESS' WHERE id = ${id}`;
    await call(createLog, '/api/winter/logs', await tokenFor(fx.a, 'WORKER'), { siteId: fx.a.jobSiteId, activity: 'clearing' });
    expect((await sql`SELECT status FROM job_assignments WHERE id = ${id}`)[0].status).toBe('IN_PROGRESS');
  });

  it('Mitarbeiter sehen nur eigene Aufgaben; andere Firmen nichts', async () => {
    await planTask(['WINTERDIENST']);
    expect((await get(listTasks, '/api/winter/tasks', await tokenFor(fx.a, 'WORKER'))).json.data).toHaveLength(1);
    expect((await get(listTasks, '/api/winter/tasks', await tokenFor(fx.a, 'LEADER'))).json.data).toHaveLength(1);
    expect((await get(listTasks, '/api/winter/tasks', await tokenFor(fx.b, 'ADMIN'))).json.data).toHaveLength(0);
    await sql`UPDATE job_assignments SET assigned_worker_ids = '{}'`;
    expect((await get(listTasks, '/api/winter/tasks', await tokenFor(fx.a, 'WORKER'))).json.data).toHaveLength(0);
    expect((await get(listTasks, '/api/winter/tasks?from=2026-01-05&to=2026-01-01', await tokenFor(fx.a, 'ADMIN'))).status).toBe(400);
  });
});
