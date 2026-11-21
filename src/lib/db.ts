/**
 * Server-side PostgreSQL connection pool.
 * Uses the `postgres` (Postgres.js) driver — runs ONLY in Node.js (API routes / Server Components).
 * Never import this file from client components.
 */
import postgres from 'postgres';

declare global {
  // Prevent multiple connections in dev (hot-reload)
  // eslint-disable-next-line no-var
  var __pgPool: ReturnType<typeof postgres> | undefined;
}

function createPool() {
  const host = process.env.DB_HOST;
  if (!host) {
    throw new Error(
      'DB_HOST is not set. Make sure the .env file exists in the project root ' +
      'and the app is started with "node server.js" (npm start).'
    );
  }
  return postgres({
    host,
    port:     Number(process.env.DB_PORT ?? 5432),
    database: (process.env.DB_DATABASE ?? process.env.DB_NAME)!,
    username: (process.env.DB_USERNAME ?? process.env.DB_USER)!,
    password: process.env.DB_PASSWORD!,
    ssl:      false,
    max:      10,
    idle_timeout: 30,
    connect_timeout: 10,
    transform: {
      undefined: null,
    },
    // Keep DATE columns (OID 1082) as 'YYYY-MM-DD' strings instead of JS Date objects.
    // Without this, JSON serialization produces '2026-04-14T00:00:00.000Z' which breaks
    // client-side string comparisons in the mobile app.
    types: {
      date: {
        to:        1082,
        from:      [1082],
        serialize: (x: unknown) => x instanceof Date
          ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
          : String(x),
        parse: (x: string) => x,   // 'YYYY-MM-DD' → keep as-is
      },
    },
  });
}

type Pool = ReturnType<typeof postgres>;

// Singleton — survives hot-reloads in dev. Created on first use, not on import,
// so `next build` can load route modules without database credentials.
function pool(): Pool {
  return globalThis.__pgPool ?? (globalThis.__pgPool = createPool());
}

const sql = new Proxy(function lazySql() {} as unknown as Pool, {
  apply: (_target, _this, args) => (pool() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, prop) => {
    const real = pool() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
}) as Pool;

export default sql;

export type Db = ReturnType<typeof postgres> | postgres.TransactionSql;

/**
 * Runs `fn` in a transaction scoped to one tenant.
 *
 * Sets the transaction-local setting `app.company_id`, which the row-level
 * security policies (db/migrations/0002_row_level_security.sql) use to hide
 * and protect every row of other companies. Use the `tx` passed to `fn` for
 * all queries of the request; queries made on the global `sql` pool run
 * outside the scope and are not protected by the policies.
 */
export async function withTenant<T>(
  companyId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (!companyId) throw new Error('withTenant requires a company id');
  return sql.begin(async tx => {
    await tx`SELECT set_config('app.company_id', ${companyId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
