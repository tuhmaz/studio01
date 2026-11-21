# Hausmeister Pro

Field-service management for Hausmeister and building-cleaning companies:
job sites, monthly work plans, GPS-verified time tracking, photo/voice
documentation, PDF reports and payroll preparation.

- **Web app** (`src/`): Next.js 15, PostgreSQL via `postgres` (Postgres.js)
- **Worker app** (`mobile/`): Expo / React Native — see `mobile/README.md`

## Getting started

```bash
npm ci
cp .env.example .env        # fill in DB_* and JWT_SECRET
npm run db:migrate          # create or update the schema
node scripts/create-admin.mjs
npm run dev                 # http://localhost:9002
```

Production: `npm run build && npm start` (runs `server.js`, which loads `.env.production` or `.env`).

## Database

`db/migrations/` is the single source of truth for the schema.
`npm run db:migrate` applies every migration not yet recorded in
`public.schema_migrations`, each in its own transaction
(`npm run db:migrate -- --status` lists them without changing anything).

- `0001_baseline` consolidates the historical `deploy/*.sql` and
  `supabase/migrations/*` files. It is idempotent, so it is safe on an
  existing production database. Those older folders are kept for reference only.
- `0002_row_level_security` makes PostgreSQL enforce tenant isolation.

Never edit a migration that has been applied; add a new one.

### Tenant isolation

Every company's data is separated twice:

1. **In the API:** every query is filtered by `session.companyId`
   (`src/app/api/*`).
2. **In PostgreSQL:** tenant-scoped routes run inside `withTenant(companyId, tx => …)`
   from `src/lib/db.ts`. It sets `app.company_id` for the transaction, and the
   row-level security policies hide and protect every row of other companies,
   even if a query forgets its `WHERE company_id = …`.

Use `withTenant` for any new query that touches company data. RLS does not
apply to superusers or `BYPASSRLS` roles, so the app must connect as a normal
application role (see `deploy/fix_database_permissions.sql`).

## Tests

```bash
npm run test:unit           # no database needed
npm run test:integration    # needs PostgreSQL 16
npm test                    # both
```

The integration tests create a throwaway database (`hausmeister_test`), apply
the real migrations and run the app's API route handlers against it as a
non-superuser role. Connection settings (defaults in parentheses):
`TEST_DB_HOST` (`localhost`), `TEST_DB_PORT` (`5432`), `TEST_DB_USER`
(`postgres`), `TEST_DB_PASSWORD` (`postgres`).

They cover tenant isolation (every role of company A against every table of
company B, for every read and write action), row-level security, and
authorization inside a company (workers, admins, payroll, user provisioning).

CI (`.github/workflows/ci.yml`) runs typecheck, lint, all tests and the
production build on every pull request.
