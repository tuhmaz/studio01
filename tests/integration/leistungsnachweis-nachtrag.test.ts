/**
 * Nachtrag im Leistungsnachweis: Büro trägt offene Leistungen vergangener
 * Einsätze als erledigt nach – gekennzeichnet, ohne Rückmeldungen zu überschreiben.
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as check } from '@/app/api/checks/route';
import { GET as report } from '@/app/api/reports/leistungsnachweis/route';
import { DELETE as undo, POST as nachtrag } from '@/app/api/reports/leistungsnachweis/nachtrag/route';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('nachtrag before photo')]).toString('base64')}`;
const MONTH = '2026-09';

beforeEach(async () => {
  fx = await seed();
  await sql`DELETE FROM time_entries`;
  await sql`UPDATE job_sites SET services = ${sql.json({ AR_Hof: { isActive: true, months: ['September'] }, Gartenpflege: { isActive: true, months: ['September'] } })}`;
  await sql`
    UPDATE job_assignments SET categories = ${sql.array(['AR_Hof', 'Gartenpflege'])},
           scheduled_date = '2026-09-28', is_plan_published = true
  `;
});

const post = async (role: Parameters<typeof tokenFor>[1], body: Record<string, unknown>) =>
  call(nachtrag, '/api/reports/leistungsnachweis/nachtrag', await tokenFor(fx.a, role), body);

async function itemsOf(): Promise<any[]> {
  const req = new NextRequest(`http://localhost/api/reports/leistungsnachweis?siteId=${fx.a.jobSiteId}&month=${MONTH}`, {
    headers: { authorization: `Bearer ${await tokenFor(fx.a, 'ADMIN')}` },
  });
  const json = await (await report(req)).json();
  return json.visits.flatMap((v: any) => v.items);
}

describe('Nachtrag', () => {
  it('trägt offene Leistungen als „Nachtrag Büro“ ein, Zeitpunkt = Ausstempeln', async () => {
    await sql`
      INSERT INTO time_entries (id, company_id, employee_id, job_assignment_id, status, clock_in_datetime, clock_out_datetime)
      VALUES ('te-n', 'co-a', ${fx.a.users.WORKER.id}, ${fx.a.assignmentId}, 'SUBMITTED', '2026-09-28T06:00:00Z', '2026-09-28T09:30:00Z')
    `;
    const res = await post('MANAGER', { siteId: fx.a.jobSiteId, month: MONTH });
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ visits: 1, services: 2 });

    const items = await itemsOf();
    expect(items.map(i => [i.code, i.status, i.byOffice])).toEqual([['AR_Hof', 'done', true], ['Gartenpflege', 'done', true]]);
    const [row] = await sql`SELECT checked_at, source, employee_name FROM service_checks LIMIT 1`;
    expect(new Date(row.checked_at).toISOString()).toBe('2026-09-28T09:30:00.000Z');
    expect(row.source).toBe('office');

    // Zweimal = keine Änderung.
    expect((await post('MANAGER', { siteId: fx.a.jobSiteId, month: MONTH })).json.data).toEqual({ visits: 0, services: 0 });
  });

  it('überschreibt keine Rückmeldung vom Mitarbeiter; Vorher-Foto bleibt', async () => {
    const worker = await tokenFor(fx.a, 'WORKER');
    await call(check, '/api/checks', worker, { assignmentId: fx.a.assignmentId, serviceCode: 'AR_Hof', status: 'not_possible', reason: 'Zugeparkt' });
    await call(check, '/api/checks', worker, { assignmentId: fx.a.assignmentId, serviceCode: 'Gartenpflege', status: 'started', beforePhoto: JPEG });

    expect((await post('ADMIN', { siteId: fx.a.jobSiteId, month: MONTH, assignmentId: fx.a.assignmentId })).json.data.services).toBe(1);
    const items = await itemsOf();
    expect(items.find(i => i.code === 'AR_Hof')).toMatchObject({ status: 'not_possible', byOffice: false, reason: 'Zugeparkt' });
    const garden = items.find(i => i.code === 'Gartenpflege');
    expect(garden).toMatchObject({ status: 'done', byOffice: true });
    expect(garden.beforeUrl).toBeTruthy();

    // Zurücknehmen: begonnener Eintrag wird wieder „begonnen“, Rückmeldung bleibt.
    const back = await call(undo, '/api/reports/leistungsnachweis/nachtrag', await tokenFor(fx.a, 'ADMIN'), { assignmentId: fx.a.assignmentId });
    expect(back.json.data.removed).toBe(1);
    const after = await itemsOf();
    expect(after.find(i => i.code === 'Gartenpflege')).toMatchObject({ status: 'open', byOffice: false });
    expect(after.find(i => i.code === 'AR_Hof')).toMatchObject({ status: 'not_possible' });
    expect(await sql`SELECT status FROM service_checks WHERE service_code = 'Gartenpflege'`).toEqual([{ status: 'started' }]);
  });

  it('keine zukünftigen Einsätze, nur Verwaltung, nur eigene Firma', async () => {
    await sql`UPDATE job_assignments SET scheduled_date = (now() AT TIME ZONE 'Europe/Berlin')::date + 3 WHERE company_id = 'co-a'`;
    const future = (await sql`SELECT to_char(scheduled_date, 'YYYY-MM') AS m FROM job_assignments WHERE id = ${fx.a.assignmentId}`)[0].m;
    expect((await post('ADMIN', { siteId: fx.a.jobSiteId, month: future })).json.data.services).toBe(0);
    expect((await post('ADMIN', { siteId: fx.a.jobSiteId, month: future, assignmentId: fx.a.assignmentId })).status).toBe(404);

    expect((await post('WORKER', { siteId: fx.a.jobSiteId, month: MONTH })).status).toBe(403);
    expect((await post('LEADER', { siteId: fx.a.jobSiteId, month: MONTH })).status).toBe(403);
    const other = await call(nachtrag, '/api/reports/leistungsnachweis/nachtrag', await tokenFor(fx.b, 'ADMIN'), { siteId: fx.a.jobSiteId, month: MONTH });
    expect(other.status).toBe(404);
  });
});
