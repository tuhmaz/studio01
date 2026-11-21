import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { appRole, testDb } from './db-config';

/**
 * Recreates the test database from scratch and applies db/migrations with the
 * same runner production uses, so the tests always run against the real schema.
 */
export default async function setup() {
  const admin = postgres({ ...testDb, database: 'postgres', max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${testDb.database} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${testDb.database}`);
  } finally {
    await admin.end();
  }

  const result = spawnSync(process.execPath, ['scripts/migrate.mjs'], {
    env: {
      ...process.env,
      DB_HOST: testDb.host,
      DB_PORT: String(testDb.port),
      DB_USERNAME: testDb.username,
      DB_PASSWORD: testDb.password,
      DB_DATABASE: testDb.database,
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Migrations failed:\n${result.stdout}\n${result.stderr}`);
  }

  // The app connects as a non-superuser role, like production should:
  // superusers skip row-level security, so testing as one would hide RLS bugs.
  const owner = postgres({ ...testDb, max: 1, onnotice: () => {} });
  try {
    await owner.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole.username}') THEN
          CREATE ROLE ${appRole.username} LOGIN PASSWORD '${appRole.password}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public, app TO ${appRole.username};
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO ${appRole.username};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole.username};
    `);
  } finally {
    await owner.end();
  }
}
