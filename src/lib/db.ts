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
    database: process.env.DB_DATABASE!,
    username: process.env.DB_USERNAME!,
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

// Singleton — survives hot-reloads in dev
const sql: ReturnType<typeof postgres> =
  globalThis.__pgPool ?? (globalThis.__pgPool = createPool());

export default sql;
