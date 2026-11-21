/** Notizen werden mit Einsatz und Objekt gespeichert und darüber gefunden (Migration 0009). */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as dataApi } from '@/app/api/data/route';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => { fx = await seed(); });

describe('work_log_entries ↔ Einsatz', () => {
  it('speichert und filtert nach job_assignment_id und job_site_id', async () => {
    const worker = await tokenFor(fx.a, 'WORKER');
    await sql`
      INSERT INTO time_entries (id, company_id, employee_id, job_assignment_id, job_site_id, clock_in_datetime, status)
      VALUES ('te-1', 'co-a', ${fx.a.users.WORKER.id}, 'job-a', ${fx.a.jobSiteId}, now(), 'OPEN')
    `;
    const insert = await call(dataApi, '/api/data', worker, {
      action: 'insert',
      table: 'work_log_entries',
      data: {
        id: 'note-1', company_id: 'co-a', time_entry_id: 'te-1', employee_id: fx.a.users.WORKER.id,
        job_assignment_id: 'job-a', job_site_id: fx.a.jobSiteId, type: 'text', content: 'Tor klemmt', author_name: 'WORKER a',
      },
    });
    expect(insert.status).toBe(200);
    const byTask = await call(dataApi, '/api/data', await tokenFor(fx.a, 'ADMIN'), {
      action: 'query', table: 'work_log_entries', filters: { job_assignment_id: 'job-a' },
    });
    expect(byTask.status).toBe(200);
    expect(byTask.json.data.map((n: any) => n.content)).toEqual(['Tor klemmt']);
    const bySite = await call(dataApi, '/api/data', await tokenFor(fx.a, 'ADMIN'), {
      action: 'query', table: 'work_log_entries', filters: { job_site_id: fx.a.jobSiteId },
    });
    expect(bySite.json.data).toHaveLength(1);
  });
});
