/**
 * Row-level security: PostgreSQL itself keeps tenants apart inside withTenant(),
 * even when a query has no company filter at all.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@/lib/db';
import { seed, sql, type Fixtures } from './helpers';

let fx: Fixtures;

const TABLES = [
  'users', 'job_sites', 'job_assignments', 'time_entries',
  'work_log_entries', 'account_invites', 'payroll_settlements',
];

beforeAll(async () => {
  fx = await seed();
});

describe('inside withTenant', () => {
  it.each(TABLES)('an unfiltered SELECT on %s returns only the tenant\'s rows', async table => {
    const rows = await withTenant(fx.a.id, tx => tx`SELECT company_id FROM ${tx(table)}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map(r => r.company_id))).toEqual(new Set([fx.a.id]));
  });

  it('sees only its own company row', async () => {
    const rows = await withTenant(fx.a.id, tx => tx`SELECT id FROM companies`);
    expect(rows.map(r => r.id)).toEqual([fx.a.id]);
  });

  it('cannot update or delete another tenant\'s rows, even by primary key', async () => {
    const updated = await withTenant(fx.a.id, tx => tx`
      UPDATE job_sites SET name = 'pwned' WHERE id = ${fx.b.jobSiteId} RETURNING id
    `);
    const deleted = await withTenant(fx.a.id, tx => tx`
      DELETE FROM time_entries WHERE id = ${fx.b.timeEntryId} RETURNING id
    `);
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    const [site] = await sql`SELECT name FROM job_sites WHERE id = ${fx.b.jobSiteId}`;
    expect(site.name).toBe('Objekt');
  });

  it('cannot insert a row for another tenant', async () => {
    await expect(withTenant(fx.a.id, tx => tx`
      INSERT INTO job_sites (id, company_id, name, address, city)
      VALUES ('site-smuggled', ${fx.b.id}, 'x', 'x', 'x')
    `)).rejects.toThrow(/row-level security/);
  });

  it('cannot move a row into another tenant', async () => {
    await expect(withTenant(fx.a.id, tx => tx`
      UPDATE job_sites SET company_id = ${fx.b.id} WHERE id = ${fx.a.jobSiteId}
    `)).rejects.toThrow(/row-level security/);
  });

  it('does not leak the scope to the next query on the same pooled connection', async () => {
    await withTenant(fx.a.id, tx => tx`SELECT 1`);
    const rows = await sql`SELECT DISTINCT company_id FROM job_sites`;
    expect(rows).toHaveLength(2);
  });

  it('refuses an empty company id', async () => {
    await expect(withTenant('', tx => tx`SELECT 1`)).rejects.toThrow();
  });
});
