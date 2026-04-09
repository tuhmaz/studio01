/**
 * Generic data API — replaces all Supabase client calls.
 *
 * POST /api/data
 * Body: { action, table, filters?, select?, orderBy?, data?, id?, ids? }
 *
 * Actions:
 *   query   → SELECT with optional filters + order
 *   insert  → INSERT one row
 *   upsert  → INSERT ... ON CONFLICT DO UPDATE
 *   update  → UPDATE rows matching filters
 *   delete  → DELETE rows matching filters
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, verifyTokenString } from '@/lib/auth-server';
import sql from '@/lib/db';

// Allowed tables — whitelist to prevent SQL injection
const ALLOWED_TABLES = new Set([
  'users', 'companies', 'job_sites', 'job_assignments',
  'time_entries', 'work_log_entries',
]);

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  // Accept both cookie-based (web) and Bearer token (mobile)
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = bearerToken
    ? await verifyTokenString(bearerToken)
    : await getSession();
  if (!session) return err('Nicht authentifiziert', 401);

  const body = await req.json();
  const { action, table, filters = {}, select = '*', orderBy, data, ids } = body;

  if (!ALLOWED_TABLES.has(table)) return err(`Unbekannte Tabelle: ${table}`);

  try {
    switch (action) {
      // ── SELECT ──────────────────────────────────────────────────────────────
      case 'query': {
        // Build WHERE clause from filters object
        const filterEntries = Object.entries(filters) as [string, unknown][];

        let query = sql`SELECT ${sql.unsafe(select === '*' ? '*' : select)} FROM ${sql(table)}`;

        if (filterEntries.length > 0) {
          // Build dynamic WHERE using sql fragments — null values become IS NULL
          const conditions = filterEntries.map(
            ([col, val]) => val === null
              ? sql`${sql(col)} IS NULL`
              : sql`${sql(col)} = ${val as any}`
          );
          query = sql`${query} WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`;
        }

        if (orderBy) {
          const dir = orderBy.ascending === false ? sql`DESC` : sql`ASC`;
          query = sql`${query} ORDER BY ${sql(orderBy.column)} ${dir}`;
        }

        const rows = await query;
        return NextResponse.json({ data: rows });
      }

      // ── TRACKING ASSIGNMENTS (Custom for Tracking Page) ──────────────────────
      case 'tracking_assignments': {
        const { companyId, today, workerId } = body;
        
        let query = sql`
          SELECT * FROM job_assignments 
          WHERE company_id = ${companyId} 
          AND is_plan_published = true 
          AND (
            scheduled_date = ${today} 
            OR (scheduled_date < ${today} AND status != 'COMPLETED')
          )
        `;

        if (workerId) {
          query = sql`${query} AND assigned_worker_ids @> ARRAY[${workerId}]::text[]`;
        }

        const rows = await query;
        return NextResponse.json({ data: rows });
      }

      // ── QUERY WITH DATE RANGE ────────────────────────────────────────────────
      // Body: { action:'query_range', table, filters, rangeFilters:[{column,gte?,lte?}], select?, orderBy? }
      case 'query_range': {
        const filterEntries = Object.entries(filters) as [string, unknown][];
        const rangeFilters: Array<{ column: string; gte?: string; lte?: string }> = body.rangeFilters ?? [];

        let query = sql`SELECT ${sql.unsafe(select === '*' ? '*' : select)} FROM ${sql(table)}`;

        const conditions = [
          ...filterEntries.map(([col, val]) => val === null
            ? sql`${sql(col)} IS NULL`
            : sql`${sql(col)} = ${val as any}`),
          ...rangeFilters.flatMap(rf => {
            const parts = [];
            if (rf.gte !== undefined) parts.push(sql`${sql(rf.column)} >= ${rf.gte}`);
            if (rf.lte !== undefined) parts.push(sql`${sql(rf.column)} <= ${rf.lte}`);
            return parts;
          }),
        ];

        if (conditions.length > 0) {
          query = sql`${query} WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`;
        }

        if (orderBy) {
          const dir = orderBy.ascending === false ? sql`DESC` : sql`ASC`;
          query = sql`${query} ORDER BY ${sql(orderBy.column)} ${dir}`;
        }

        const rows = await query;
        return NextResponse.json({ data: rows });
      }

      // ── CONTAINS (array filter, e.g. assigned_worker_ids @> ARRAY[userId]) ─
      case 'query_contains': {
        const { column, value, extraFilters = {} } = body;
        const extraEntries = Object.entries(extraFilters) as [string, unknown][];

        let baseQuery = sql`SELECT * FROM ${sql(table)} WHERE ${sql(column)} @> ${sql.array([value])}`;

        for (const [col, val] of extraEntries) {
          baseQuery = sql`${baseQuery} AND ${sql(col)} = ${val as any}`;
        }

        if (orderBy) {
          const dir = orderBy.ascending === false ? sql`DESC` : sql`ASC`;
          baseQuery = sql`${baseQuery} ORDER BY ${sql(orderBy.column)} ${dir}`;
        }

        const rows = await baseQuery;
        return NextResponse.json({ data: rows });
      }

      // ── INSERT ──────────────────────────────────────────────────────────────
      case 'insert': {
        const rows = Array.isArray(data) ? data : [data];
        const inserted = await sql`INSERT INTO ${sql(table)} ${sql(rows)} RETURNING *`;
        return NextResponse.json({ data: inserted });
      }

      // ── UPSERT ──────────────────────────────────────────────────────────────
      case 'upsert': {
        const rows = Array.isArray(data) ? data : [data];
        const upserted = await sql`
          INSERT INTO ${sql(table)} ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET ${sql(rows[0], ...Object.keys(rows[0]).filter(k => k !== 'id'))}
          RETURNING *
        `;
        return NextResponse.json({ data: upserted });
      }

      // ── UPDATE ──────────────────────────────────────────────────────────────
      case 'update': {
        const filterEntries = Object.entries(filters) as [string, unknown][];
        if (filterEntries.length === 0) return err('update requires at least one filter');

        const conditions = filterEntries.map(
          ([col, val]) => sql`${sql(col)} = ${val as any}`
        );
        const whereClause = conditions.reduce((a, b) => sql`${a} AND ${b}`);

        const updated = await sql`
          UPDATE ${sql(table)} SET ${sql(data)} WHERE ${whereClause} RETURNING *
        `;
        return NextResponse.json({ data: updated });
      }

      // ── DELETE ──────────────────────────────────────────────────────────────
      case 'delete': {
        const filterEntries = Object.entries(filters) as [string, unknown][];
        if (filterEntries.length === 0) return err('delete requires at least one filter');

        const conditions = filterEntries.map(
          ([col, val]) => sql`${sql(col)} = ${val as any}`
        );
        const whereClause = conditions.reduce((a, b) => sql`${a} AND ${b}`);

        await sql`DELETE FROM ${sql(table)} WHERE ${whereClause}`;
        return NextResponse.json({ data: null });
      }

      default:
        return err(`Unbekannte Aktion: ${action}`);
    }
  } catch (e: any) {
    console.error(`[api/data] ${action} ${table}:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
