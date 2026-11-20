/**
 * Authorization inside one company: what each role may do to colleagues' data.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/data/route';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;

beforeEach(async () => {
  fx = await seed();
});

describe('workers', () => {
  it('see only their own time entries', async () => {
    const res = await call(POST, '/api/data', await tokenFor(fx.a, 'WORKER'), {
      action: 'query', table: 'time_entries',
    });
    expect(res.status).toBe(200);
    expect(res.json.data.map((r: any) => r.id)).toEqual([fx.a.timeEntryId]);
  });

  it('cannot read a colleague\'s profile', async () => {
    // The users query of a worker is always narrowed to their own row.
    const res = await call(POST, '/api/data', await tokenFor(fx.a, 'WORKER'), {
      action: 'query', table: 'users', filters: { id: fx.a.worker2.id },
    });
    expect(res.json.data.map((r: any) => r.id)).toEqual([fx.a.users.WORKER.id]);
  });

  it('cannot take over a colleague\'s time entry via upsert', async () => {
    await call(POST, '/api/data', await tokenFor(fx.a, 'WORKER'), {
      action: 'upsert',
      table: 'time_entries',
      data: { id: fx.a.worker2TimeEntryId, employee_id: fx.a.users.WORKER.id, status: 'SUBMITTED', travel_bonus_minutes: 600 },
    });
    const [row] = await sql`SELECT employee_id, travel_bonus_minutes FROM time_entries WHERE id = ${fx.a.worker2TimeEntryId}`;
    expect(row.employee_id).toBe(fx.a.worker2.id);
    expect(row.travel_bonus_minutes).toBe(0);
  });

  it('cannot update or delete a colleague\'s time entry', async () => {
    const token = await tokenFor(fx.a, 'WORKER');
    await call(POST, '/api/data', token, {
      action: 'update', table: 'time_entries', filters: { id: fx.a.worker2TimeEntryId }, data: { travel_bonus_minutes: 600 },
    });
    await call(POST, '/api/data', token, {
      action: 'delete', table: 'time_entries', filters: { id: fx.a.worker2TimeEntryId },
    });
    const rows = await sql`SELECT travel_bonus_minutes FROM time_entries WHERE id = ${fx.a.worker2TimeEntryId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].travel_bonus_minutes).toBe(0);
  });

  it('cannot approve their own time entry', async () => {
    const res = await call(POST, '/api/data', await tokenFor(fx.a, 'WORKER'), {
      action: 'update', table: 'time_entries', filters: { id: fx.a.timeEntryId }, data: { status: 'APPROVED' },
    });
    expect(res.status).toBe(403);
    const [row] = await sql`SELECT status FROM time_entries WHERE id = ${fx.a.timeEntryId}`;
    expect(row.status).toBe('SUBMITTED');
  });

  it('cannot promote themselves', async () => {
    await call(POST, '/api/data', await tokenFor(fx.a, 'WORKER'), {
      action: 'update', table: 'users', filters: { id: fx.a.users.WORKER.id }, data: { role: 'ADMIN' },
    });
    const [row] = await sql`SELECT role FROM users WHERE id = ${fx.a.users.WORKER.id}`;
    expect(row.role).toBe('WORKER');
  });

  it('may only set the status of a job they are assigned to', async () => {
    const own = await call(POST, '/api/data', await tokenFor(fx.a, 'WORKER'), {
      action: 'update', table: 'job_assignments', filters: { id: fx.a.assignmentId }, data: { status: 'IN_PROGRESS' },
    });
    expect(own.status).toBe(200);

    const other = await call(POST, '/api/data', await tokenFor(fx.a, 'WORKER2'), {
      action: 'update', table: 'job_assignments', filters: { id: fx.a.assignmentId }, data: { status: 'COMPLETED' },
    });
    expect(other.status).toBe(403);
  });
});

describe('admins', () => {
  it('cannot assign SUPER_ADMIN', async () => {
    const res = await call(POST, '/api/data', await tokenFor(fx.a, 'ADMIN'), {
      action: 'update', table: 'users', filters: { id: fx.a.users.WORKER.id }, data: { role: 'SUPER_ADMIN' },
    });
    expect(res.status).toBe(403);
  });

  it('cannot delete or create a company through the data API', async () => {
    const token = await tokenFor(fx.a, 'ADMIN');
    const del = await call(POST, '/api/data', token, { action: 'delete', table: 'companies', filters: { id: fx.a.id } });
    expect(del.status).toBe(403);
    const ins = await call(POST, '/api/data', token, { action: 'insert', table: 'companies', data: { id: 'co-new', name: 'Neu' } });
    expect(ins.status).toBe(403);
  });

  it('can rename their own company', async () => {
    const res = await call(POST, '/api/data', await tokenFor(fx.a, 'ADMIN'), {
      action: 'update', table: 'companies', filters: { id: fx.a.id }, data: { name: 'Neuer Name' },
    });
    expect(res.status).toBe(200);
    const [row] = await sql`SELECT name FROM companies WHERE id = ${fx.a.id}`;
    expect(row.name).toBe('Neuer Name');
  });
});

describe('special actions respect table permissions', () => {
  it('tracking_assignments requires permission to read job assignments', async () => {
    // ACCOUNTANT has no assignments.view; naming a readable table must not unlock assignments.
    const res = await call(POST, '/api/data', await tokenFor(fx.a, 'ACCOUNTANT'), {
      action: 'tracking_assignments', table: 'companies', today: '2026-11-20',
    });
    expect(res.status).toBe(403);
  });

  it('accountants never see job assignments', async () => {
    const res = await call(POST, '/api/data', await tokenFor(fx.a, 'ACCOUNTANT'), {
      action: 'query', table: 'job_assignments',
    });
    expect(res.status).toBe(403);
  });
});
