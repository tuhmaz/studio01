import { NextRequest, NextResponse } from 'next/server';
import { SessionPayload } from '@/lib/auth-server';
import sql from '@/lib/db';
import { getRequestSession } from '@/lib/request-context';
import { hasPermission, normalizeRole, Role } from '@/lib/permissions';

type FilterValue = string | number | boolean | null;
type Filters = Record<string, FilterValue>;

const TABLE_COLUMNS = {
  account_invites: new Set(['id', 'company_id', 'email', 'role', 'created_by', 'created_at']),
  companies: new Set([
    'id', 'name', 'site_name', 'address', 'city', 'postal_code', 'tax_number',
    'phone', 'email', 'website', 'logo_data', 'created_at',
  ]),
  job_assignments: new Set([
    'id', 'company_id', 'job_site_id', 'title', 'scheduled_date', 'status',
    'assigned_worker_ids', 'categories', 'is_plan_published', 'created_by', 'created_at',
  ]),
  job_sites: new Set([
    'id', 'company_id', 'name', 'address', 'city', 'postal_code', 'region',
    'route_code', 'is_remote', 'distance_from_hq', 'travel_time_from_hq',
    'estimated_travel_time_minutes_from_hq', 'lat', 'lng', 'services', 'created_at',
  ]),
  time_entries: new Set([
    'id', 'company_id', 'employee_id', 'job_assignment_id', 'job_site_id',
    'clock_in_datetime', 'clock_out_datetime', 'actual_work_minutes',
    'travel_bonus_minutes', 'status', 'gps_verified', 'lat', 'lng',
    'is_manual_entry', 'submission_datetime', 'created_at',
  ]),
  users: new Set([
    'id', 'company_id', 'name', 'email', 'role', 'avatar_url',
    'hourly_rate', 'contract_type', 'tax_class', 'kinder', 'has_church_tax',
    'bundesland', 'monthly_target_hours', 'auth_provider', 'can_login_with_password',
    'invite_id', 'last_login', 'sv_nr', 'steuer_id', 'status_taetigkeit',
    'kv_zusatz_rate', 'signature_data', 'created_at', 'updated_at',
  ]),
  work_log_entries: new Set([
    'id', 'company_id', 'time_entry_id', 'job_site_id', 'job_assignment_id',
    'employee_id', 'type', 'content', 'author_name', 'duration', 'created_at',
  ]),
} as const;

type TableName = keyof typeof TABLE_COLUMNS;

const USER_ADMIN_COLUMNS = TABLE_COLUMNS.users;
const USER_ACCOUNTANT_COLUMNS = new Set([
  'id', 'company_id', 'name', 'email', 'role', 'avatar_url',
  'hourly_rate', 'contract_type', 'tax_class', 'kinder', 'has_church_tax',
  'bundesland', 'monthly_target_hours', 'sv_nr', 'steuer_id', 'status_taetigkeit',
  'kv_zusatz_rate', 'signature_data', 'last_login', 'created_at', 'updated_at',
]);
const USER_MANAGER_COLUMNS = new Set([
  'id', 'company_id', 'name', 'email', 'role', 'avatar_url',
  'hourly_rate', 'contract_type', 'tax_class', 'kinder', 'has_church_tax',
  'bundesland', 'monthly_target_hours', 'status_taetigkeit',
  'kv_zusatz_rate', 'last_login', 'created_at', 'updated_at',
]);
const USER_DIRECTORY_COLUMNS = new Set([
  'id', 'company_id', 'name', 'email', 'role', 'avatar_url',
  'contract_type', 'status_taetigkeit', 'created_at',
]);
const USER_SELF_COLUMNS = new Set([
  'id', 'company_id', 'name', 'email', 'role', 'avatar_url',
  'hourly_rate', 'contract_type', 'tax_class', 'kinder', 'has_church_tax',
  'bundesland', 'monthly_target_hours', 'sv_nr', 'steuer_id', 'status_taetigkeit',
  'kv_zusatz_rate', 'signature_data', 'last_login', 'created_at', 'updated_at',
]);

const COMPANY_SCOPED_TABLES = new Set<TableName>([
  'account_invites',
  'companies',
  'job_assignments',
  'job_sites',
  'time_entries',
  'users',
  'work_log_entries',
]);

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function safeDataError(error: unknown): { message: string; status: number } {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Keine Berechtigung') return { message, status: 403 };
  if (
    message === 'select must be a string' ||
    message === 'data must be an object' ||
    message === 'update requires at least one filter' ||
    message === 'delete requires at least one filter' ||
    message.startsWith('Unbekannte Spalte:')
  ) {
    return { message, status: 400 };
  }
  return { message: 'Serverfehler', status: 500 };
}

function roleOf(session: SessionPayload): Role {
  return normalizeRole(session.role);
}

function tableName(value: unknown): TableName | null {
  return typeof value === 'string' && value in TABLE_COLUMNS ? value as TableName : null;
}

function assertColumn(table: TableName, column: string) {
  if (!TABLE_COLUMNS[table].has(column as never)) {
    throw new Error(`Unbekannte Spalte: ${column}`);
  }
}

function normalizeFilters(table: TableName, input: unknown): Filters {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Filters = {};
  for (const [column, value] of Object.entries(input as Record<string, unknown>)) {
    assertColumn(table, column);
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[column] = value;
    }
  }
  return out;
}

function isSelfUserRead(table: TableName, filters: Filters | undefined, session: SessionPayload) {
  return table === 'users' && filters?.id === session.userId;
}

function readableColumns(table: TableName, session: SessionPayload, filters?: Filters): Set<string> {
  if (table !== 'users') return TABLE_COLUMNS[table] as Set<string>;
  if (isSelfUserRead(table, filters, session)) return USER_SELF_COLUMNS;

  const role = roleOf(session);
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return USER_ADMIN_COLUMNS as Set<string>;
  if (role === 'ACCOUNTANT') return USER_ACCOUNTANT_COLUMNS;
  if (role === 'MANAGER') return USER_MANAGER_COLUMNS;
  if (role === 'WORKER') return USER_SELF_COLUMNS;
  return USER_DIRECTORY_COLUMNS;
}

function selectFragment(table: TableName, select: unknown, session: SessionPayload, filters?: Filters) {
  const readable = readableColumns(table, session, filters);
  if (!select || select === '*') {
    if (table !== 'users') return sql`*`;
    return Array.from(readable)
      .map(column => sql`${sql(column)}`)
      .reduce((a, b) => sql`${a}, ${b}`);
  }
  if (typeof select !== 'string') throw new Error('select must be a string');

  const columns = select.split(',').map(s => s.trim()).filter(Boolean);
  if (!columns.length) return sql`*`;
  columns.forEach(column => assertColumn(table, column));
  columns.forEach(column => {
    if (!readable.has(column)) throw new Error(`Keine Berechtigung fuer Spalte: ${column}`);
  });
  return columns.map(column => sql`${sql(column)}`).reduce((a, b) => sql`${a}, ${b}`);
}

function filterConditions(table: TableName, filters: Filters) {
  return Object.entries(filters).map(([column, value]) => (
    value === null ? sql`${sql(column)} IS NULL` : sql`${sql(column)} = ${value}`
  ));
}

function scopedFilters(table: TableName, filters: Filters, session: SessionPayload): Filters {
  const scoped = { ...filters };
  if (COMPANY_SCOPED_TABLES.has(table)) {
    const companyColumn = table === 'companies' ? 'id' : 'company_id';
    scoped[companyColumn] = session.companyId;
  }

  const role = roleOf(session);
  if (role === 'WORKER') {
    if (table === 'users') scoped.id = session.userId;
    if (table === 'time_entries' || table === 'work_log_entries') scoped.employee_id = session.userId;
  }

  return scoped;
}

function canRead(table: TableName, session: SessionPayload) {
  const role = roleOf(session);
  if (table === 'account_invites') return hasPermission(session, 'users.create');
  if (table === 'companies') return hasPermission(session, 'companies.view');
  if (table === 'users') return hasPermission(session, 'users.view') || role === 'WORKER';
  if (table === 'job_sites') return hasPermission(session, 'job_sites.view');
  if (table === 'job_assignments') return hasPermission(session, 'assignments.view');
  if (table === 'time_entries') return hasPermission(session, 'time_entries.view');
  if (table === 'work_log_entries') return hasPermission(session, 'work_logs.view');
  return false;
}

function onlyColumns(data: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(data).every(key => allowed.has(key));
}

function canWrite(table: TableName, action: string, data: unknown, session: SessionPayload) {
  const role = roleOf(session);
  if (table === 'account_invites') return hasPermission(session, 'users.create');
  if (table === 'companies') return hasPermission(session, 'companies.update');
  if (table === 'users') {
    if (action === 'insert') return hasPermission(session, 'users.create');
    if (action === 'delete') return hasPermission(session, 'users.delete');
    if (hasPermission(session, 'users.update')) return true;
  }
  if (table === 'job_sites') return hasPermission(session, 'job_sites.manage');
  if (table === 'job_assignments' && hasPermission(session, 'assignments.manage')) return true;
  if (table === 'time_entries' && hasPermission(session, 'time_entries.manage')) return true;
  if (table === 'work_log_entries' && action === 'insert') return hasPermission(session, 'work_logs.create');
  if (table === 'work_log_entries' && action !== 'insert') return hasPermission(session, 'time_entries.manage');

  if (role === 'WORKER' && (table === 'time_entries' || table === 'work_log_entries')) return true;
  if (table === 'users' && action === 'update') {
    return !!data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      onlyColumns(data as Record<string, unknown>, new Set(['signature_data']));
  }
  if (table === 'job_assignments' && action === 'update') {
    return !!data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      onlyColumns(data as Record<string, unknown>, new Set(['status']));
  }

  return false;
}

function sanitizeRows(table: TableName, data: unknown, session: SessionPayload) {
  const rows = Array.isArray(data) ? data : [data];
  const role = roleOf(session);

  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('data must be an object');
    }
    const clean = { ...(row as Record<string, unknown>) };
    for (const key of Object.keys(clean)) assertColumn(table, key);

    if (COMPANY_SCOPED_TABLES.has(table)) {
      const companyColumn = table === 'companies' ? 'id' : 'company_id';
      clean[companyColumn] = session.companyId;
    }
    if (role === 'WORKER' && (table === 'time_entries' || table === 'work_log_entries')) {
      clean.employee_id = session.userId;
    }
    if ((role === 'LEADER' || role === 'WORKER') && table === 'job_assignments' && !clean.created_by) {
      clean.created_by = session.userId;
    }

    return clean;
  });
}

function roundDateToNearestMinutes(date: Date, intervalMinutes = 5): Date {
  const intervalMs = intervalMinutes * 60 * 1000;
  return new Date(Math.round(date.getTime() / intervalMs) * intervalMs);
}

function roundIsoDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return roundDateToNearestMinutes(date).toISOString();
}

function normalizeTimeEntryRow(
  row: Record<string, unknown>,
  existing?: { clock_in_datetime?: string | null; clock_out_datetime?: string | null },
) {
  const hasClockIn = Object.prototype.hasOwnProperty.call(row, 'clock_in_datetime');
  const hasClockOut = Object.prototype.hasOwnProperty.call(row, 'clock_out_datetime');

  if (hasClockIn) {
    const rounded = roundIsoDateTime(row.clock_in_datetime);
    if (rounded) row.clock_in_datetime = rounded;
  }

  if (hasClockOut) {
    const rounded = roundIsoDateTime(row.clock_out_datetime);
    if (rounded) row.clock_out_datetime = rounded;
  }

  const start = typeof row.clock_in_datetime === 'string'
    ? row.clock_in_datetime
    : existing?.clock_in_datetime;
  const end = typeof row.clock_out_datetime === 'string'
    ? row.clock_out_datetime
    : existing?.clock_out_datetime;

  if ((hasClockIn || hasClockOut || Object.prototype.hasOwnProperty.call(row, 'actual_work_minutes')) && start && end) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      row.actual_work_minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    }
  }

  return row;
}

async function assertAssignedJobAccess(filters: Filters, session: SessionPayload) {
  const id = filters.id;
  if (typeof id !== 'string') throw new Error('Keine Berechtigung');

  const rows = await sql`
    SELECT id
      FROM job_assignments
     WHERE id = ${id}
       AND company_id = ${session.companyId}
       AND assigned_worker_ids @> ARRAY[${session.userId}]::text[]
     LIMIT 1
  `;
  if (!rows.length) throw new Error('Keine Berechtigung');
}

async function getAuthSession(req: NextRequest) {
  return getRequestSession(req);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) return err('Nicht authentifiziert', 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err('Ungultiger JSON-Body');
  }

  const table = tableName(body.table);
  if (!table) return err(`Unbekannte Tabelle: ${body.table}`);
  if (!canRead(table, session)) return err('Keine Berechtigung', 403);

  const { action, orderBy } = body;

  try {
    switch (action) {
      case 'query': {
        const filters = scopedFilters(table, normalizeFilters(table, body.filters), session);
        const conditions = filterConditions(table, filters);
        let query = sql`SELECT ${selectFragment(table, body.select, session, filters)} FROM ${sql(table)}`;

        if (conditions.length > 0) {
          query = sql`${query} WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`;
        }
        if (orderBy) {
          assertColumn(table, orderBy.column);
          const dir = orderBy.ascending === false ? sql`DESC` : sql`ASC`;
          query = sql`${query} ORDER BY ${sql(orderBy.column)} ${dir}`;
        }

        const rows = await query;
        return NextResponse.json({ data: rows });
      }

      case 'tracking_assignments': {
        const today = typeof body.today === 'string' ? body.today : null;
        if (!today) return err('today required');

        let query = sql`
          SELECT * FROM job_assignments
           WHERE company_id = ${session.companyId}
             AND is_plan_published = true
             AND (
               scheduled_date = ${today}
               OR (scheduled_date < ${today} AND status != 'COMPLETED')
             )
        `;

        const requestedWorkerId = typeof body.workerId === 'string' ? body.workerId : null;
        const workerId = roleOf(session) === 'WORKER' ? session.userId : requestedWorkerId;
        if (workerId) {
          query = sql`${query} AND assigned_worker_ids @> ARRAY[${workerId}]::text[]`;
        }

        const rows = await query;
        return NextResponse.json({ data: rows });
      }

      case 'query_range': {
        const filters = scopedFilters(table, normalizeFilters(table, body.filters), session);
        const rangeFilters: Array<{ column: string; gte?: string; lte?: string }> = body.rangeFilters ?? [];
        const conditions = filterConditions(table, filters);

        for (const range of rangeFilters) {
          assertColumn(table, range.column);
          if (range.gte !== undefined) conditions.push(sql`${sql(range.column)} >= ${range.gte}`);
          if (range.lte !== undefined) conditions.push(sql`${sql(range.column)} <= ${range.lte}`);
        }

        let query = sql`SELECT ${selectFragment(table, body.select, session, filters)} FROM ${sql(table)}`;
        if (conditions.length > 0) {
          query = sql`${query} WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`;
        }
        if (orderBy) {
          assertColumn(table, orderBy.column);
          const dir = orderBy.ascending === false ? sql`DESC` : sql`ASC`;
          query = sql`${query} ORDER BY ${sql(orderBy.column)} ${dir}`;
        }

        const rows = await query;
        return NextResponse.json({ data: rows });
      }

      case 'query_contains': {
        const column = String(body.column ?? '');
        assertColumn(table, column);
        const filters = scopedFilters(table, normalizeFilters(table, body.extraFilters), session);

        let query = sql`SELECT * FROM ${sql(table)} WHERE ${sql(column)} @> ${sql.array([body.value])}`;
        const conditions = filterConditions(table, filters);
        if (conditions.length > 0) {
          query = sql`${query} AND ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`;
        }
        if (orderBy) {
          assertColumn(table, orderBy.column);
          const dir = orderBy.ascending === false ? sql`DESC` : sql`ASC`;
          query = sql`${query} ORDER BY ${sql(orderBy.column)} ${dir}`;
        }

        const rows = await query;
        return NextResponse.json({ data: rows });
      }

      case 'insert': {
        if (!canWrite(table, action, body.data, session)) return err('Keine Berechtigung', 403);
        const rows = sanitizeRows(table, body.data, session);
        if (table === 'time_entries') {
          rows.forEach(row => normalizeTimeEntryRow(row));
        }
        const inserted = await sql`INSERT INTO ${sql(table)} ${sql(rows)} RETURNING *`;
        return NextResponse.json({ data: inserted });
      }

      case 'upsert': {
        if (!canWrite(table, action, body.data, session)) return err('Keine Berechtigung', 403);
        const rows = sanitizeRows(table, body.data, session);
        if (table === 'time_entries') {
          rows.forEach(row => normalizeTimeEntryRow(row));
        }
        const updateColumns = Object.keys(rows[0]).filter(key => key !== 'id');
        const upserted = await sql`
          INSERT INTO ${sql(table)} ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET ${sql(rows[0], ...updateColumns)}
          RETURNING *
        `;
        return NextResponse.json({ data: upserted });
      }

      case 'update': {
        if (!canWrite(table, action, body.data, session)) return err('Keine Berechtigung', 403);
        const filters = scopedFilters(table, normalizeFilters(table, body.filters), session);
        if (table === 'users' && !hasPermission(session, 'users.update')) {
          filters.id = session.userId;
        }
        if (Object.keys(filters).length === 0) return err('update requires at least one filter');
        if (table === 'job_assignments' && !hasPermission(session, 'assignments.manage')) {
          await assertAssignedJobAccess(filters, session);
        }
        const rows = sanitizeRows(table, body.data, session);
        if (table === 'time_entries') {
          const id = filters.id;
          let existing: { clock_in_datetime?: string | null; clock_out_datetime?: string | null } | undefined;
          if (typeof id === 'string') {
            const existingRows = await sql`
              SELECT clock_in_datetime, clock_out_datetime
                FROM time_entries
               WHERE id = ${id}
                 AND company_id = ${session.companyId}
               LIMIT 1
            `;
            existing = existingRows[0];
          }
          rows.forEach(row => normalizeTimeEntryRow(row, existing));
        }
        const conditions = filterConditions(table, filters);
        const whereClause = conditions.reduce((a, b) => sql`${a} AND ${b}`);
        const updated = await sql`
          UPDATE ${sql(table)} SET ${sql(rows[0])} WHERE ${whereClause} RETURNING *
        `;
        return NextResponse.json({ data: updated });
      }

      case 'delete': {
        if (!canWrite(table, action, body.data, session)) return err('Keine Berechtigung', 403);
        const filters = scopedFilters(table, normalizeFilters(table, body.filters), session);
        if (Object.keys(filters).length === 0) return err('delete requires at least one filter');
        const conditions = filterConditions(table, filters);
        const whereClause = conditions.reduce((a, b) => sql`${a} AND ${b}`);
        await sql`DELETE FROM ${sql(table)} WHERE ${whereClause}`;
        return NextResponse.json({ data: null });
      }

      default:
        return err(`Unbekannte Aktion: ${action}`);
    }
  } catch (e: any) {
    const safeError = safeDataError(e);
    console.error(`[api/data] ${action} ${table}:`, e?.message ?? e);
    return NextResponse.json({ error: safeError.message }, { status: safeError.status });
  }
}
