import { NextResponse } from 'next/server';
import type { SessionPayload } from '@/lib/auth-server';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'LEADER' | 'WORKER';
export type Permission =
  | '*'
  | 'companies.view'
  | 'companies.update'
  | 'users.view'
  | 'users.create'
  | 'users.update'
  | 'users.delete'
  | 'job_sites.view'
  | 'job_sites.manage'
  | 'assignments.view'
  | 'assignments.manage'
  | 'time_entries.view'
  | 'time_entries.manage'
  | 'time_entries.approve'
  | 'work_logs.view'
  | 'work_logs.create'
  | 'payroll.view'
  | 'payroll.manage'
  | 'payroll.settle'
  | 'reports.export'
  | 'audit_logs.view'
  | 'settings.manage';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'companies.view', 'companies.update',
    'users.view', 'users.create', 'users.update', 'users.delete',
    'job_sites.view', 'job_sites.manage',
    'assignments.view', 'assignments.manage',
    'time_entries.view', 'time_entries.manage', 'time_entries.approve',
    'work_logs.view', 'work_logs.create',
    'payroll.view', 'payroll.manage', 'payroll.settle',
    'reports.export', 'audit_logs.view', 'settings.manage',
  ],
  MANAGER: [
    'companies.view', 'users.view', 'job_sites.view', 'job_sites.manage',
    'assignments.view', 'assignments.manage',
    'time_entries.view', 'time_entries.manage', 'time_entries.approve',
    'work_logs.view', 'work_logs.create', 'payroll.view', 'reports.export',
  ],
  ACCOUNTANT: [
    'companies.view', 'users.view', 'time_entries.view', 'work_logs.view',
    'payroll.view', 'payroll.manage', 'reports.export',
  ],
  LEADER: [
    'companies.view', 'users.view', 'job_sites.view', 'assignments.view',
    'time_entries.view', 'time_entries.manage', 'work_logs.view', 'work_logs.create',
  ],
  WORKER: [
    'companies.view', 'job_sites.view', 'assignments.view',
    'time_entries.view', 'time_entries.manage', 'work_logs.view', 'work_logs.create',
  ],
};

export function normalizeRole(role?: string | null): Role {
  const normalized = String(role ?? 'WORKER').toUpperCase();
  if (normalized in ROLE_PERMISSIONS) return normalized as Role;
  return 'WORKER';
}

export function hasRole(session: SessionPayload | null, roles: Role[]): boolean {
  if (!session) return false;
  const role = normalizeRole(session.role);
  return role === 'SUPER_ADMIN' || roles.includes(role);
}

export function hasPermission(session: SessionPayload | null, permission: Permission): boolean {
  if (!session) return false;
  const role = normalizeRole(session.role);
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return permissions.includes('*') || permissions.includes(permission);
}

export function forbidden(message = 'Keine Berechtigung') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function requirePermission(session: SessionPayload | null, permission: Permission): NextResponse | null {
  return hasPermission(session, permission) ? null : forbidden();
}

export function requireRole(session: SessionPayload | null, roles: Role[]): NextResponse | null {
  return hasRole(session, roles) ? null : forbidden();
}

export function isAdminLike(session: SessionPayload | null): boolean {
  return hasRole(session, ['SUPER_ADMIN', 'ADMIN']);
}

export function isManagerLike(session: SessionPayload | null): boolean {
  return hasRole(session, ['SUPER_ADMIN', 'ADMIN', 'MANAGER']);
}
