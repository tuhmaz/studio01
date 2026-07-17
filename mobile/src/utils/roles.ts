/**
 * Role model for the mobile app — kept in sync with the backend
 * (src/lib/permissions.ts). The API is the source of truth for authorization;
 * these helpers only drive client-side UI gating (which tabs/screens to show).
 */

export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MANAGER'
  | 'ACCOUNTANT'
  | 'LEADER'
  | 'WORKER';

const KNOWN_ROLES: readonly Role[] = [
  'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER',
];

/** Roles that can plan/assign jobs — mirrors the backend `assignments.manage`. */
const MANAGEMENT_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEADER'];

/** Roles that appear in the field-team picker (people who work on site). */
const FIELD_ROLES: readonly Role[] = ['WORKER', 'LEADER'];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Administrator',
  ADMIN:       'Administrator',
  MANAGER:     'Manager',
  ACCOUNTANT:  'Buchhaltung',
  LEADER:      'Teamleiter',
  WORKER:      'Mitarbeiter',
};

/** Coerce an unknown API value to a valid Role, defaulting to the least-privileged. */
export function normalizeRole(role?: string | null): Role {
  const upper = String(role ?? '').toUpperCase();
  return (KNOWN_ROLES as readonly string[]).includes(upper) ? (upper as Role) : 'WORKER';
}

/** Can plan assignments and see the leader/management dashboard. */
export function isManagement(role?: string | null): boolean {
  return MANAGEMENT_ROLES.includes(normalizeRole(role));
}

/** Belongs in the on-site team list (for assignment). */
export function isFieldRole(role?: string | null): boolean {
  return FIELD_ROLES.includes(normalizeRole(role));
}

export function roleLabel(role?: string | null): string {
  return ROLE_LABELS[normalizeRole(role)];
}
