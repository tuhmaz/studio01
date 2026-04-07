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
  return postgres({
    host:     process.env.DB_HOST!,
    port:     Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_DATABASE!,
    username: process.env.DB_USERNAME!,
    password: process.env.DB_PASSWORD!,
    ssl:      false,          // set to { rejectUnauthorized: false } if server requires SSL
    max:      10,             // connection pool size
    idle_timeout: 30,
    connect_timeout: 10,
    transform: {
      undefined: null,        // convert JS undefined → SQL NULL
    },
  });
}

// Singleton in dev to survive hot-reloads
const sql: ReturnType<typeof postgres> =
  globalThis.__pgPool ?? (globalThis.__pgPool = createPool());

export default sql;
