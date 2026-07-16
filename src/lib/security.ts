export const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const SELECT_RE = /^\s*(\*|[a-zA-Z_][a-zA-Z0-9_]*(\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?(\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*)\s*$/i;

export function assertIdentifier(value: string, label = 'identifier'): string {
  if (!IDENTIFIER_RE.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

export function safeSelect(value: unknown): string {
  const select = typeof value === 'string' && value.trim() ? value.trim() : '*';
  if (!SELECT_RE.test(select)) throw new Error('Invalid select expression');
  return select;
}

export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function withoutKeys<T extends Record<string, unknown>>(obj: T, keys: Iterable<string>): Partial<T> {
  const forbidden = new Set([...keys].map(k => k.toLowerCase()));
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !forbidden.has(key.toLowerCase()))
  ) as Partial<T>;
}

export const ALWAYS_FORBIDDEN_WRITE_FIELDS = new Set([
  'company_id',
  'password_hash',
  'created_at',
  'updated_at',
  'last_login',
]);

export const ADMIN_ONLY_USER_FIELDS = new Set([
  'role',
  'hourly_rate',
  'contract_type',
  'monthly_target_hours',
  'tax_class',
  'kinder',
  'has_church_tax',
  'bundesland',
  'sv_nr',
  'steuer_id',
  'status_taetigkeit',
]);
