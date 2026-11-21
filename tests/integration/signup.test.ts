/**
 * Self-service registration of new companies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// createSession() writes a cookie through next/headers, which only exists inside
// a real Next.js request. Capture what would be set instead.
const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
  }),
}));

import { GET, POST as register } from '@/app/api/auth/register/route';
import { POST as data } from '@/app/api/data/route';
import { call, seed, sql, type Fixtures } from './helpers';

let fx: Fixtures;
const valid = {
  companyName: 'Neue Hausmeister GmbH',
  name: 'Nina Neu',
  email: 'Nina@Neu.test',
  password: 'ein-sicheres-passwort',
  acceptTerms: true,
};

beforeEach(async () => {
  fx = await seed();
  cookieJar.clear();
  globalThis.__signupAttempts?.clear();
  process.env.ALLOW_SIGNUP = 'true';
});

afterEach(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('/api/auth/register', () => {
  it('is off unless ALLOW_SIGNUP=true', async () => {
    delete process.env.ALLOW_SIGNUP;
    expect((await (await GET()).json()).enabled).toBe(false);
    const res = await call(register, '/api/auth/register', null, valid);
    expect(res.status).toBe(403);
    expect(await sql`SELECT 1 FROM companies WHERE name = ${valid.companyName}`).toHaveLength(0);
  });

  it('creates the company and its admin, and signs the admin in', async () => {
    const res = await call(register, '/api/auth/register', null, valid);
    expect(res.status).toBe(201);

    const [company] = await sql`SELECT id, name, email FROM companies WHERE id = ${res.json.companyId}`;
    expect(company).toMatchObject({ name: valid.companyName, email: 'nina@neu.test' });
    expect(company.id).toMatch(/^neue-hausmeister-gmbh-[0-9a-f]{6}$/);

    const [admin] = await sql`SELECT company_id, role, email FROM users WHERE id = ${res.json.userId}`;
    expect(admin).toEqual({ company_id: company.id, role: 'ADMIN', email: 'nina@neu.test' });

    expect(cookieJar.size).toBe(1);
    const [audit] = await sql`SELECT action FROM audit_logs WHERE company_id = ${company.id}`;
    expect(audit.action).toBe('company.registered');
  });

  it('gives the new company an empty, isolated workspace', async () => {
    await call(register, '/api/auth/register', null, valid);
    const token = [...cookieJar.values()][0];
    for (const table of ['job_sites', 'users', 'time_entries', 'companies']) {
      const res = await call(data, '/api/data', token, { action: 'query', table });
      expect(res.status, table).toBe(200);
      const foreign = res.json.data.filter((r: any) => [fx.a.id, fx.b.id].includes(r.company_id ?? r.id));
      expect(foreign, table).toEqual([]);
    }
  });

  it('refuses an email that already has a login', async () => {
    const res = await call(register, '/api/auth/register', null, { ...valid, email: fx.a.users.WORKER.email });
    expect(res.status).toBe(409);
    expect(await sql`SELECT 1 FROM companies WHERE name = ${valid.companyName}`).toHaveLength(0);
  });

  it('validates the form', async () => {
    const res = await call(register, '/api/auth/register', null, { ...valid, acceptTerms: false });
    expect(res.status).toBe(400);
  });

  it('limits sign-ups per IP', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await call(register, '/api/auth/register', null, { ...valid, email: `n${i}@neu.test` });
      expect(res.status).toBe(201);
    }
    const blocked = await call(register, '/api/auth/register', null, { ...valid, email: 'n9@neu.test' });
    expect(blocked.status).toBe(429);
  });
});
