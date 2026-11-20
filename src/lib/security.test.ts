import { describe, expect, it } from 'vitest';
import { assertIdentifier, safeSelect, stripUndefined, withoutKeys } from '@/lib/security';

describe('assertIdentifier', () => {
  it('accepts plain SQL identifiers', () => {
    expect(assertIdentifier('job_sites')).toBe('job_sites');
  });

  it.each(['users; DROP TABLE users', 'a-b', '1abc', 'name"', ''])('rejects %j', value => {
    expect(() => assertIdentifier(value)).toThrow();
  });
});

describe('safeSelect', () => {
  it('defaults to *', () => {
    expect(safeSelect(undefined)).toBe('*');
    expect(safeSelect('  ')).toBe('*');
  });

  it('accepts column lists with aliases', () => {
    expect(safeSelect('id, name AS n')).toBe('id, name AS n');
  });

  it.each(['id; DELETE FROM users', 'count(*)', 'id, (select 1)', "name || 'x'"])('rejects %j', value => {
    expect(() => safeSelect(value)).toThrow();
  });
});

describe('object helpers', () => {
  it('stripUndefined keeps null and drops undefined', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
  });

  it('withoutKeys is case-insensitive', () => {
    expect(withoutKeys({ Company_Id: 'x', name: 'n' }, ['company_id'])).toEqual({ name: 'n' });
  });
});
