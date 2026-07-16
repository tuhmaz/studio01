import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ path: process.env.ENV_FILE || '.env.local' });
dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function identifier(value, label) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a valid PostgreSQL identifier`);
  }
  return value;
}

const appRole = identifier(
  process.env.APP_DB_USERNAME ||
    process.env.DB_APP_USERNAME ||
    process.env.DB_USERNAME ||
    process.env.DB_USER ||
    'hausmeister',
  'application role'
);

const adminUser = process.env.DB_ADMIN_USERNAME || process.env.DB_OWNER_USERNAME;
const adminPassword = process.env.DB_ADMIN_PASSWORD || process.env.DB_OWNER_PASSWORD;

if (!adminUser || !adminPassword) {
  throw new Error(
    [
      'Database owner credentials are required.',
      '',
      'Set DB_ADMIN_USERNAME and DB_ADMIN_PASSWORD to the PostgreSQL table owner or a superuser, then run again.',
      'PowerShell example:',
      '  $env:DB_ADMIN_USERNAME="postgres"',
      '  $env:DB_ADMIN_PASSWORD="<postgres password>"',
      '  npm run db:fix-permissions',
      '',
      `Application role that will receive permissions: ${appRole}`,
    ].join('\n')
  );
}

const sql = postgres({
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_DATABASE || process.env.DB_NAME || 'postgres',
  username: adminUser,
  password: adminPassword,
  ssl: false,
  max: 1,
});

try {
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`);
  await sql.unsafe(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${appRole}"`);

  const checks = await sql`
    SELECT c.relname AS table_name,
      has_table_privilege(${appRole}, c.oid, 'select') AS can_select,
      has_table_privilege(${appRole}, c.oid, 'insert') AS can_insert,
      has_table_privilege(${appRole}, c.oid, 'update') AS can_update,
      has_table_privilege(${appRole}, c.oid, 'delete') AS can_delete
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `;

  console.log(`Permissions granted to ${appRole}.`);
  console.table(checks);
} catch (err) {
  console.error('Failed to grant permissions.');
  console.error('Run this script with DB_ADMIN_USERNAME and DB_ADMIN_PASSWORD for the table owner or a PostgreSQL superuser.');
  throw err;
} finally {
  await sql.end();
}
