/**
 * Leistungsnachweis: per-visit checklists and the monthly report.
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getChecklist, POST as check } from '@/app/api/checks/route';
import { GET as report } from '@/app/api/reports/leistungsnachweis/route';
import { call, seed, sql, tokenFor, type CompanyFixture, type Fixtures } from './helpers';

let fx: Fixtures;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('before/after test')]).toString('base64')}`;

beforeEach(async () => {
  fx = await seed();
  await sql`
    UPDATE job_sites SET services = ${sql.json({
      AR_Oeffen: { isActive: true, months: ['November'] },
      Gullis: { isActive: true, months: ['November'] },
      custom_treppenhaus: { isActive: true, months: ['November'], label: 'Treppenhaus reinigen' },
    })}
  `;
  await sql`
    UPDATE job_assignments
       SET categories = ${sql.array(['AR_Oeffen', 'Gullis', 'custom_treppenhaus', 'WINTERDIENST'])}
  `;
});

async function getList(company: CompanyFixture, role: Parameters<typeof tokenFor>[1], assignmentId = company.assignmentId) {
  const req = new NextRequest(`http://localhost/api/checks?assignmentId=${assignmentId}`, {
    headers: { authorization: `Bearer ${await tokenFor(company, role)}` },
  });
  const res = await getChecklist(req);
  return { status: res.status, json: await res.json() };
}

async function tick(company: CompanyFixture, role: Parameters<typeof tokenFor>[1], body: Record<string, unknown>) {
  return call(check, '/api/checks', await tokenFor(company, role), { assignmentId: company.assignmentId, ...body });
}

async function getReport(company: CompanyFixture, role: Parameters<typeof tokenFor>[1], query: string) {
  const req = new NextRequest(`http://localhost/api/reports/leistungsnachweis?${query}`, {
    headers: { authorization: `Bearer ${await tokenFor(company, role)}` },
  });
  const res = await report(req);
  return { status: res.status, json: await res.json() };
}

describe('checklist of a visit', () => {
  it('lists the visit\'s services with their names, without Winterdienst', async () => {
    const res = await getList(fx.a, 'WORKER');
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: any) => [i.code, i.label])).toEqual([
      ['AR_Oeffen', 'Außengehwege'],
      ['Gullis', 'Gullis'],
      ['custom_treppenhaus', 'Treppenhaus reinigen'],
    ]);
    expect(res.json.items.every((i: any) => i.check === null)).toBe(true);
    expect(res.json.assignment.site.name).toBe('Objekt');
  });

  it('is hidden from workers not on the visit and from other companies', async () => {
    expect((await getList(fx.a, 'WORKER2')).status).toBe(404);
    expect((await getList(fx.b, 'ADMIN', fx.a.assignmentId)).status).toBe(404);
  });

  it('records done with before and after photos, and keeps photos when updated without them', async () => {
    const first = await tick(fx.a, 'WORKER', { serviceCode: 'AR_Oeffen', status: 'done', beforePhoto: JPEG, afterPhoto: JPEG });
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ status: 'done', service_label: 'Außengehwege', employee_id: fx.a.users.WORKER.id });
    expect(first.json.data.before_url).toMatch(/^\/api\/media\//);
    expect(first.json.data.after_url).toMatch(/^\/api\/media\//);

    const again = await tick(fx.a, 'WORKER', { serviceCode: 'AR_Oeffen', status: 'done' });
    expect(again.json.data.before_url).toBe(first.json.data.before_url);
    expect(await sql`SELECT 1 FROM service_checks`).toHaveLength(1);
  });

  it('needs a reason for "not possible" and can be undone', async () => {
    expect((await tick(fx.a, 'WORKER', { serviceCode: 'Gullis', status: 'not_possible' })).status).toBe(400);
    const ok = await tick(fx.a, 'WORKER', { serviceCode: 'Gullis', status: 'not_possible', reason: 'Zufahrt zugeparkt' });
    expect(ok.json.data).toMatchObject({ status: 'not_possible', reason: 'Zufahrt zugeparkt' });

    await tick(fx.a, 'WORKER', { serviceCode: 'Gullis', status: 'open' });
    expect(await sql`SELECT 1 FROM service_checks`).toHaveLength(0);
  });

  it('saves a before photo without finishing the work, and never undoes a finished check', async () => {
    const started = await tick(fx.a, 'WORKER', { serviceCode: 'AR_Oeffen', status: 'started', beforePhoto: JPEG });
    expect(started.json.data.status).toBe('started');
    const done = await tick(fx.a, 'WORKER', { serviceCode: 'AR_Oeffen', status: 'done', afterPhoto: JPEG });
    expect(done.json.data).toMatchObject({ status: 'done' });
    expect(done.json.data.before_url).toBe(started.json.data.before_url);
    const late = await tick(fx.a, 'WORKER', { serviceCode: 'AR_Oeffen', status: 'started', beforePhoto: JPEG });
    expect(late.json.data.status).toBe('done');

    await tick(fx.a, 'WORKER', { serviceCode: 'Gullis', status: 'started', beforePhoto: JPEG });
    const rep = await getReport(fx.a, 'MANAGER', `siteId=${fx.a.jobSiteId}&month=2026-11`);
    expect(rep.json.totals).toMatchObject({ done: 1, open: 2 });
    expect(rep.json.visits[0].items[1]).toMatchObject({ status: 'open', employeeName: null });
    expect(rep.json.visits[0].items[1].beforeUrl).toMatch(/^\/api\/media\//);
  });

  it('only accepts services of that visit', async () => {
    expect((await tick(fx.a, 'WORKER', { serviceCode: 'Rasen_Fl1', status: 'done' })).status).toBe(400);
    expect((await tick(fx.a, 'WORKER', { serviceCode: 'WINTERDIENST', status: 'done' })).status).toBe(400);
  });

  it('lets leaders tick any visit of their company, but not workers of other visits', async () => {
    expect((await tick(fx.a, 'LEADER', { serviceCode: 'Gullis', status: 'done' })).status).toBe(200);
    expect((await tick(fx.a, 'WORKER2', { serviceCode: 'Gullis', status: 'done' })).status).toBe(404);
    expect((await tick(fx.a, 'ACCOUNTANT', { serviceCode: 'Gullis', status: 'done' })).status).toBe(403);
  });

  it('rejects non-image photos', async () => {
    const html = `data:image/jpeg;base64,${Buffer.from('<html>').toString('base64')}`;
    expect((await tick(fx.a, 'WORKER', { serviceCode: 'Gullis', status: 'done', beforePhoto: html })).status).toBe(400);
  });
});

describe('monthly report', () => {
  it('compares planned with ticked-off services and computes the rate', async () => {
    await tick(fx.a, 'WORKER', { serviceCode: 'AR_Oeffen', status: 'done', afterPhoto: JPEG });
    await tick(fx.a, 'WORKER', { serviceCode: 'Gullis', status: 'not_possible', reason: 'Zufahrt zugeparkt' });

    const res = await getReport(fx.a, 'MANAGER', `siteId=${fx.a.jobSiteId}&month=2026-11`);
    expect(res.status).toBe(200);
    expect(res.json.totals).toEqual({ visits: 1, planned: 3, done: 1, notPossible: 1, open: 1, compliancePercent: 33.3 });
    const [visit] = res.json.visits;
    expect(visit).toMatchObject({ date: '2026-11-20', workers: ['WORKER a'] });
    expect(visit.items.map((i: any) => i.status)).toEqual(['done', 'not_possible', 'open']);
    expect(visit.items[0]).toMatchObject({ employeeName: 'WORKER a', beforeUrl: null });
    expect(visit.items[0].afterUrl).toMatch(/^\/api\/media\//);
    expect(res.json.company.name).toBe('Company A');
  });

  it('leaves out unpublished visits and other months', async () => {
    await sql`UPDATE job_assignments SET is_plan_published = false WHERE id = ${fx.a.assignmentId}`;
    expect((await getReport(fx.a, 'MANAGER', `siteId=${fx.a.jobSiteId}&month=2026-11`)).json.totals.planned).toBe(0);
    await sql`UPDATE job_assignments SET is_plan_published = true WHERE id = ${fx.a.assignmentId}`;
    expect((await getReport(fx.a, 'MANAGER', `siteId=${fx.a.jobSiteId}&month=2026-12`)).json.totals.planned).toBe(0);
  });

  it('is limited to reports.export, the own company and a valid month', async () => {
    expect((await getReport(fx.a, 'WORKER', `siteId=${fx.a.jobSiteId}&month=2026-11`)).status).toBe(403);
    expect((await getReport(fx.a, 'ACCOUNTANT', `siteId=${fx.a.jobSiteId}&month=2026-11`)).status).toBe(200);
    expect((await getReport(fx.a, 'ADMIN', `siteId=${fx.b.jobSiteId}&month=2026-11`)).status).toBe(404);
    expect((await getReport(fx.a, 'ADMIN', `siteId=${fx.a.jobSiteId}&month=2026-13`)).status).toBe(400);
  });
});
