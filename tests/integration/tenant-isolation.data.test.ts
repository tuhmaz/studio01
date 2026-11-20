/**
 * Tenant isolation for /api/data.
 *
 * Every role of company A attacks every table of company B with every action.
 * The invariant: nothing of company B is ever returned, changed or deleted.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/data/route';
import { ROLES, call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;

type Table =
  | 'companies' | 'users' | 'job_sites' | 'job_assignments'
  | 'time_entries' | 'work_log_entries' | 'account_invites';

const TABLES: Table[] = [
  'companies', 'users', 'job_sites', 'job_assignments',
  'time_entries', 'work_log_entries', 'account_invites',
];

function targetId(table: Table): string {
  const b = fx.b;
  return {
    companies: b.id,
    users: b.users.WORKER.id,
    job_sites: b.jobSiteId,
    job_assignments: b.assignmentId,
    time_entries: b.timeEntryId,
    work_log_entries: b.workLogId,
    account_invites: b.inviteId,
  }[table];
}

function patch(table: Table): Record<string, unknown> {
  return {
    companies: { name: 'pwned' },
    users: { name: 'pwned' },
    job_sites: { name: 'pwned' },
    job_assignments: { title: 'pwned' },
    time_entries: { travel_bonus_minutes: 999 },
    work_log_entries: { content: 'pwned' },
    account_invites: { email: 'pwned@evil.test' },
  }[table];
}

/** A complete row carrying company B's primary key, for insert/upsert attacks. */
function fullRow(table: Table): Record<string, unknown> {
  const b = fx.b;
  const id = targetId(table);
  return {
    companies: { id, name: 'pwned' },
    users: { id, name: 'pwned', email: 'pwned-user@evil.test', role: 'WORKER' },
    job_sites: { id, name: 'pwned', address: 'x', city: 'x' },
    job_assignments: { id, title: 'pwned', scheduled_date: '2026-11-21' },
    time_entries: { id, employee_id: b.users.WORKER.id, status: 'OPEN', travel_bonus_minutes: 999 },
    work_log_entries: {
      id, time_entry_id: b.timeEntryId, employee_id: b.users.WORKER.id,
      type: 'text', content: 'pwned', author_name: 'x',
    },
    account_invites: { id, email: 'pwned@evil.test', role: 'WORKER' },
  }[table];
}

/** Everything company B owns, as comparable JSON. */
async function snapshotB() {
  const rows: Record<string, unknown> = {};
  rows.companies = await sql`SELECT * FROM companies WHERE id = ${fx.b.id}`;
  for (const table of TABLES.filter(t => t !== 'companies')) {
    rows[table] = await sql`SELECT * FROM ${sql(table)} WHERE company_id = ${fx.b.id} ORDER BY id`;
  }
  rows.payroll = await sql`SELECT * FROM payroll_settlements WHERE company_id = ${fx.b.id} ORDER BY id`;
  return JSON.stringify(rows);
}

function leaksB(table: Table, rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some((row: any) =>
    table === 'companies' ? row.id === fx.b.id : row.company_id === fx.b.id,
  );
}

beforeAll(async () => {
  fx = await seed();
});

describe.each(ROLES)('role %s of company A', role => {
  let token: string;
  beforeAll(async () => {
    token = await tokenFor(fx.a, role);
  });

  it.each(TABLES)('cannot read %s of company B', async table => {
    const attempts = [
      { action: 'query', table },
      { action: 'query', table, filters: { id: targetId(table) } },
      { action: 'query', table, filters: table === 'companies' ? { id: fx.b.id } : { company_id: fx.b.id } },
      { action: 'query_range', table, rangeFilters: [{ column: 'created_at', gte: '2000-01-01' }] },
    ];
    if (table === 'job_assignments') {
      attempts.push({ action: 'query_contains', table, column: 'assigned_worker_ids', value: fx.b.users.WORKER.id } as any);
      attempts.push({ action: 'tracking_assignments', table, today: '2026-11-20', workerId: fx.b.users.WORKER.id } as any);
    }

    for (const body of attempts) {
      const res = await call(POST, '/api/data', token, body);
      expect(res.status, JSON.stringify(body)).not.toBe(500);
      expect(leaksB(table, res.json.data), `${JSON.stringify(body)} leaked company B data`).toBe(false);
    }
  });

  it.each(TABLES)('cannot change or delete %s of company B', async table => {
    const before = await snapshotB();
    const id = targetId(table);
    const idColumn = 'id';

    const attempts = [
      { action: 'update', table, filters: { [idColumn]: id }, data: patch(table) },
      { action: 'update', table, filters: { company_id: fx.b.id }, data: patch(table) },
      { action: 'upsert', table, data: fullRow(table) },
      { action: 'insert', table, data: { ...fullRow(table), id: `${id}-copy`, company_id: fx.b.id } },
      { action: 'delete', table, filters: { [idColumn]: id } },
    ];
    for (const body of attempts) {
      await call(POST, '/api/data', token, body);
    }

    expect(await snapshotB()).toBe(before);
  });
});

describe('writes are always stamped with the caller\'s company', () => {
  it('ignores a forged company_id on insert', async () => {
    const token = await tokenFor(fx.a, 'ADMIN');
    const res = await call(POST, '/api/data', token, {
      action: 'insert',
      table: 'job_sites',
      data: { id: 'site-forged', company_id: fx.b.id, name: 'Neu', address: 'x', city: 'x' },
    });
    expect(res.status).toBe(200);
    const [row] = await sql`SELECT company_id FROM job_sites WHERE id = 'site-forged'`;
    expect(row.company_id).toBe(fx.a.id);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await call(POST, '/api/data', null, { action: 'query', table: 'job_sites' });
    expect(res.status).toBe(401);
  });

  it('rejects a token signed for company B but claiming company A', async () => {
    const { createTokenString } = await import('@/lib/auth-server');
    const forged = await createTokenString({
      userId: fx.b.users.ADMIN.id,
      companyId: fx.a.id,
      role: 'ADMIN',
      name: 'x',
      email: 'x',
    });
    const res = await call(POST, '/api/data', forged, { action: 'query', table: 'job_sites' });
    expect(res.status).toBe(401);
  });
});
