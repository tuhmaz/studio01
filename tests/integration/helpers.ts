import { NextRequest } from 'next/server';
import sql from '@/lib/db';
import { createTokenString } from '@/lib/auth-server';
import type { Role } from '@/lib/permissions';

export const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'];

export interface CompanyFixture {
  id: string;
  users: Record<Role, { id: string; email: string; name: string }>;
  /** A second worker, to test isolation between workers of the same company. */
  worker2: { id: string; email: string; name: string };
  jobSiteId: string;
  assignmentId: string;
  timeEntryId: string;
  worker2TimeEntryId: string;
  workLogId: string;
  inviteId: string;
}

export interface Fixtures {
  a: CompanyFixture;
  b: CompanyFixture;
}

const TABLES = [
  'audit_logs', 'payroll_settlements', 'work_log_entries', 'time_entries',
  'job_assignments', 'job_sites', 'account_invites', 'users', 'companies',
];

// Fixed UUIDs keep failures readable: ...a1.. = company A, ...b1.. = company B.
function uuid(company: 'a' | 'b', n: number) {
  const c = company === 'a' ? 'a' : 'b';
  return `00000000-0000-4000-8000-${c}${String(n).padStart(11, '0')}`;
}

async function seedCompany(key: 'a' | 'b'): Promise<CompanyFixture> {
  const id = `co-${key}`;
  await sql`INSERT INTO companies (id, name) VALUES (${id}, ${`Company ${key.toUpperCase()}`})`;

  const users = {} as CompanyFixture['users'];
  let n = 1;
  for (const role of ROLES) {
    const user = { id: uuid(key, n++), email: `${role.toLowerCase()}@${key}.test`, name: `${role} ${key}` };
    await sql`
      INSERT INTO users (id, company_id, name, email, password_hash, role)
      VALUES (${user.id}, ${id}, ${user.name}, ${user.email}, 'not-a-real-hash', ${role})
    `;
    users[role] = user;
  }
  const worker2 = { id: uuid(key, 99), email: `worker2@${key}.test`, name: `WORKER2 ${key}` };
  await sql`
    INSERT INTO users (id, company_id, name, email, password_hash, role)
    VALUES (${worker2.id}, ${id}, ${worker2.name}, ${worker2.email}, 'not-a-real-hash', 'WORKER')
  `;

  const jobSiteId = `site-${key}`;
  await sql`INSERT INTO job_sites (id, company_id, name, address, city) VALUES (${jobSiteId}, ${id}, 'Objekt', 'Str. 1', 'Stadt')`;

  const assignmentId = `job-${key}`;
  await sql`
    INSERT INTO job_assignments (id, company_id, job_site_id, title, scheduled_date, assigned_worker_ids, is_plan_published)
    VALUES (${assignmentId}, ${id}, ${jobSiteId}, 'Reinigung', '2026-11-20', ${sql.array([users.WORKER.id])}, true)
  `;

  const timeEntryId = `te-${key}`;
  const worker2TimeEntryId = `te-${key}-w2`;
  await sql`
    INSERT INTO time_entries (id, company_id, employee_id, job_assignment_id, job_site_id, status, clock_in_datetime, clock_out_datetime)
    VALUES
      (${timeEntryId}, ${id}, ${users.WORKER.id}, ${assignmentId}, ${jobSiteId}, 'SUBMITTED', '2026-11-20T07:00:00Z', '2026-11-20T11:00:00Z'),
      (${worker2TimeEntryId}, ${id}, ${worker2.id}, NULL, ${jobSiteId}, 'SUBMITTED', '2026-11-20T07:00:00Z', '2026-11-20T09:00:00Z')
  `;

  const workLogId = `log-${key}`;
  await sql`
    INSERT INTO work_log_entries (id, company_id, time_entry_id, employee_id, type, content, author_name)
    VALUES (${workLogId}, ${id}, ${timeEntryId}, ${users.WORKER.id}, 'text', 'Treppenhaus gereinigt', ${users.WORKER.name})
  `;

  await sql`
    INSERT INTO payroll_settlements (company_id, employee_id, period_start, period_end)
    VALUES (${id}, ${users.WORKER.id}, '2026-10-21', '2026-11-20')
  `;

  const inviteId = `invite-${key}`;
  await sql`INSERT INTO account_invites (id, company_id, email, role) VALUES (${inviteId}, ${id}, ${`new@${key}.test`}, 'WORKER')`;

  return { id, users, worker2, jobSiteId, assignmentId, timeEntryId, worker2TimeEntryId, workLogId, inviteId };
}

/** Empties every table and seeds two fully populated companies, A and B. */
export async function seed(): Promise<Fixtures> {
  await sql.unsafe(`TRUNCATE ${TABLES.map(t => `public.${t}`).join(', ')} CASCADE`);
  return { a: await seedCompany('a'), b: await seedCompany('b') };
}

export async function tokenFor(company: CompanyFixture, role: Role | 'WORKER2'): Promise<string> {
  const user = role === 'WORKER2' ? company.worker2 : company.users[role];
  return createTokenString({
    userId: user.id,
    companyId: company.id,
    role: role === 'WORKER2' ? 'WORKER' : role,
    name: user.name,
    email: user.email,
  });
}

export function jsonRequest(path: string, token: string | null, body: unknown): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function call(
  handler: (req: NextRequest) => Promise<Response>,
  path: string,
  token: string | null,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await handler(jsonRequest(path, token, body));
  return { status: res.status, json: await res.json() };
}

export { sql };
