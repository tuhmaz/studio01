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
  });
}

// Singleton — survives hot-reloads in dev
const sql: ReturnType<typeof postgres> =
  globalThis.__pgPool ?? (globalThis.__pgPool = createPool());

export default sql;
