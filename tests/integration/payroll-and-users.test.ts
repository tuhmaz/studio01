/**
 * Tenant isolation and authorization for /api/payroll and /api/provision-user.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as payroll } from '@/app/api/payroll/route';
import { POST as provisionUser } from '@/app/api/provision-user/route';
import { call, seed, sql, tokenFor, type Fixtures } from './helpers';

let fx: Fixtures;

beforeEach(async () => {
  fx = await seed();
});

const period = '2026-10-21';

describe('/api/payroll', () => {
  it('lists only the caller\'s company', async () => {
    const res = await call(payroll, '/api/payroll', await tokenFor(fx.a, 'ADMIN'), { action: 'list', periodStart: period });
    expect(res.status).toBe(200);
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0].company_id).toBe(fx.a.id);
  });

  it.each(['get', 'prev_rollover', 'upsert', 'settle', 'delete'])(
    'refuses %s for an employee of another company',
    async action => {
      const before = await sql`SELECT * FROM payroll_settlements WHERE company_id = ${fx.b.id}`;
      const res = await call(payroll, '/api/payroll', await tokenFor(fx.a, 'ADMIN'), {
        action,
        employeeId: fx.b.users.WORKER.id,
        periodStart: period,
        beforePeriodStart: '2027-01-01',
        periodEnd: '2026-11-20',
        totalMinutes: 1,
      });
      expect(res.status).toBe(404);
      const after = await sql`SELECT * FROM payroll_settlements WHERE company_id = ${fx.b.id}`;
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    },
  );

  it('lets a worker read only their own settlement', async () => {
    const token = await tokenFor(fx.a, 'WORKER');
    const own = await call(payroll, '/api/payroll', token, { action: 'get', employeeId: fx.a.users.WORKER.id, periodStart: period });
    expect(own.status).toBe(200);
    const colleague = await call(payroll, '/api/payroll', token, { action: 'get', employeeId: fx.a.worker2.id, periodStart: period });
    expect(colleague.status).toBe(403);
    const list = await call(payroll, '/api/payroll', token, { action: 'list', periodStart: period });
    expect(list.status).toBe(403);
  });

  it('allows settling only with payroll.settle', async () => {
    const res = await call(payroll, '/api/payroll', await tokenFor(fx.a, 'ACCOUNTANT'), {
      action: 'settle', employeeId: fx.a.users.WORKER.id, periodStart: period,
    });
    expect(res.status).toBe(403);
  });

  it('rejects a malformed body with 400 instead of crashing', async () => {
    const req = new (await import('next/server')).NextRequest('http://localhost/api/payroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokenFor(fx.a, 'ADMIN')}` },
      body: 'not json',
    });
    const res = await payroll(req);
    expect(res.status).toBe(400);
  });
});

describe('/api/provision-user', () => {
  const body = { email: 'neu@a.test', password: 'ein-sicheres-passwort', name: 'Neu', role: 'WORKER' };

  it('creates the user in the caller\'s company, ignoring a forged companyId', async () => {
    const res = await call(provisionUser, '/api/provision-user', await tokenFor(fx.a, 'ADMIN'), {
      ...body, companyId: fx.b.id, company_id: fx.b.id,
    });
    expect(res.status).toBe(201);
    const [row] = await sql`SELECT company_id, role FROM users WHERE email = 'neu@a.test'`;
    expect(row).toEqual({ company_id: fx.a.id, role: 'WORKER' });
  });

  it('refuses roles without users.create', async () => {
    for (const role of ['MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'] as const) {
      const res = await call(provisionUser, '/api/provision-user', await tokenFor(fx.a, role), body);
      expect(res.status, role).toBe(403);
    }
  });

  it('refuses SUPER_ADMIN as a target role and short passwords', async () => {
    const token = await tokenFor(fx.a, 'ADMIN');
    expect((await call(provisionUser, '/api/provision-user', token, { ...body, role: 'SUPER_ADMIN' })).status).toBe(400);
    expect((await call(provisionUser, '/api/provision-user', token, { ...body, password: 'kurz' })).status).toBe(400);
  });

  it('reports a duplicate email as 409', async () => {
    const res = await call(provisionUser, '/api/provision-user', await tokenFor(fx.a, 'ADMIN'), {
      ...body, email: fx.b.users.WORKER.email,
    });
    expect(res.status).toBe(409);
  });
});
