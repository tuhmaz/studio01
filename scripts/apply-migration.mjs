import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

const sql = postgres({
  host:     process.env.DB_HOST || 'localhost',
  port:     Number(process.env.DB_PORT || 5432),
  database: process.env.DB_DATABASE || 'postgres',
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl:      false,
});

async function run() {
  console.log('Applying database migration to local database...');
  try {
    // Migration 013: session revocation column (required by auth-server.ts).
    await sql`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS users_sessions_revoked_at_idx
        ON public.users(sessions_revoked_at);
    `;
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Error applying migration:', err);
  } finally {
    await sql.end();
  }
}

run();