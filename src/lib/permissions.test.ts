import { describe, expect, it } from 'vitest';
import type { SessionPayload } from '@/lib/auth-server';
import {
  ROLE_PERMISSIONS,
  hasPermission,
  hasRole,
  isAdminLike,
  isManagerLike,
  normalizeRole,
  type Permission,
  type Role,
} from '@/lib/permissions';

const session = (role: string): SessionPayload => ({
  userId: 'u1',
  companyId: 'c1',
  role,
  name: 'Test',
  email: 't@example.com',
});

describe('normalizeRole', () => {
  it('accepts known roles case-insensitively', () => {
    expect(normalizeRole('admin')).toBe('ADMIN');
    expect(normalizeRole('Leader')).toBe('LEADER');
  });

  it('falls back to the least-privileged role for unknown or missing input', () => {
    expect(normalizeRole('ROOT')).toBe('WORKER');
    expect(normalizeRole(undefined)).toBe('WORKER');
    expect(normalizeRole(null)).toBe('WORKER');
    expect(normalizeRole('')).toBe('WORKER');
  });
});

describe('hasPermission', () => {
  it('denies everything without a session', () => {
    expect(hasPermission(null, 'companies.view')).toBe(false);
  });

  it('grants SUPER_ADMIN every permission', () => {
    const all = new Set(Object.values(ROLE_PERMISSIONS).flat().filter(p => p !== '*'));
    for (const permission of all) {
      expect(hasPermission(session('SUPER_ADMIN'), permission)).toBe(true);
    }
  });

  // The matrix below is the contract other code relies on; a change here must be deliberate.
  const sensitive: Array<[Permission, Role[]]> = [
    ['payroll.settle', ['ADMIN']],
    ['payroll.manage', ['ADMIN', 'ACCOUNTANT']],
    ['users.create', ['ADMIN']],
    ['users.delete', ['ADMIN']],
    ['time_entries.approve', ['ADMIN', 'MANAGER']],
    ['settings.manage', ['ADMIN']],
    ['audit_logs.view', ['ADMIN']],
    ['winter.manage', ['ADMIN', 'MANAGER']],
  ];
  const roles: Role[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'];

  it.each(sensitive)('%s is limited to %j', (permission, allowed) => {
    for (const role of roles) {
      expect(hasPermission(session(role), permission), `${role} → ${permission}`).toBe(allowed.includes(role));
    }
  });

  it('treats an unknown role as WORKER', () => {
    expect(hasPermission(session('HACKER'), 'payroll.view')).toBe(false);
    expect(hasPermission(session('HACKER'), 'time_entries.manage')).toBe(true);
  });
});

describe('role helpers', () => {
  it('lets SUPER_ADMIN pass every role check', () => {
    expect(hasRole(session('SUPER_ADMIN'), ['WORKER'])).toBe(true);
  });

  it('classifies admin-like and manager-like roles', () => {
    expect(isAdminLike(session('ADMIN'))).toBe(true);
    expect(isAdminLike(session('MANAGER'))).toBe(false);
    expect(isManagerLike(session('MANAGER'))).toBe(true);
    expect(isManagerLike(session('LEADER'))).toBe(false);
    expect(isManagerLike(null)).toBe(false);
  });
});
