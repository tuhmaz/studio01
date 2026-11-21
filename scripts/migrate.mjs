#!/usr/bin/env node
/**
 * Database migration runner.
 *
 * Applies every db/migrations/NNNN_*.sql file that is not yet recorded in
 * public.schema_migrations, in filename order, each inside its own
 * transaction. A failed migration rolls back and stops the run.
 *
 *   npm run db:migrate            # apply pending migrations
 *   npm run db:migrate -- --status  # list applied / pending, change nothing
 *
 * Connection settings come from the same DB_* variables the app uses
 * (.env.production, then .env, then the process environment).
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.production', '.env']) {
  const path = join(root, file);
  if (existsSync(path)) {
    dotenv.config({ path });
    break;
  }
}

const migrationsDir = join(root, 'db', 'migrations');
const statusOnly = process.argv.includes('--status');

function required(name, ...fallbacks) {
  for (const key of [name, ...fallbacks]) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error(`${name} is not set`);
}

const sql = postgres({
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT ?? 5432),
  database: required('DB_DATABASE', 'DB_NAME'),
  username: required('DB_USERNAME', 'DB_USER'),
  password: process.env.DB_PASSWORD ?? '',
  ssl: process.env.DB_SSL === 'true' ? 'require' : false,
  onnotice: () => {},
  max: 1,
});

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version    TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(migrationsDir))
    .filter(name => /^\d{4}_[\w-]+\.sql$/.test(name))
    .sort();
  const applied = new Map(
    (await sql`SELECT version, checksum FROM public.schema_migrations`).map(r => [r.version, r.checksum]),
  );

  let pending = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const body = await readFile(join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(body).digest('hex');

    if (applied.has(version)) {
      if (applied.get(version) !== checksum) {
        console.warn(`! ${version} was changed after it was applied (checksum mismatch). Add a new migration instead of editing an applied one.`);
      } else if (statusOnly) {
        console.log(`  applied  ${version}`);
      }
      continue;
    }

    pending += 1;
    if (statusOnly) {
      console.log(`  pending  ${version}`);
      continue;
    }

    process.stdout.write(`→ ${version} ... `);
    await sql.begin(async tx => {
      await tx.unsafe(body);
      await tx`INSERT INTO public.schema_migrations (version, checksum) VALUES (${version}, ${checksum})`;
    });
    console.log('ok');
  }

  if (!pending) console.log('Database is up to date.');
}

main()
  .catch(error => {
    console.error(`\nMigration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
