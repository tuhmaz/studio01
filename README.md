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

## New companies

With `ALLOW_SIGNUP=true`, `/register` lets a company create its own account:
company + first ADMIN, signed in right away, then the settings page guides
through setup (profile, headquarters, job sites, team, first plan).
Off by default. Link your terms and privacy policy with `TERMS_URL` and
`PRIVACY_URL`. Without sign-up, create companies and admins with
`scripts/create-admin.mjs`.

Each company sets its own headquarters and remote-site rule
(Einstellungen → Standort & Fahrzeiten); all travel times are computed on
the server from these.

## Winterdienst

Web: **Winterdienst** (managers, leaders) — today's status per site, the
season log per site, corrections, Streuprotokoll as PDF, and per-site setup
(areas, notes). Worker app: **Winter** tab — pick a site, choose the activity
and grit, take a photo; time and GPS are captured on save. Without signal the
entry is stored on the phone and sent later (up to 72 h).

The log (`winter_service_logs`) is evidence for liability cases:
append-only (a database trigger blocks UPDATE/DELETE), every entry is
SHA-256-chained to the previous one of the same company, and
`GET /api/winter/verify` recomputes the chain. Mistakes are fixed by
correction entries with a reason; the original stays. Weather at the time
of work comes from the German Weather Service (DWD) via Bright Sky.

### Automatic Winterdienst tasks

Winterdienst is switched on per site in the Objekte dialog (or on the
Winterdienst page → *Objekte einrichten*). On frost or snow days each such
site gets a task "Winterdienst" in the Tourplan:

- *Einsätze planen* on the Winterdienst page: preview the DWD forecast per
  site and create the tasks (or force them regardless of the weather).
- Automatically: add to the server's crontab (needs `CRON_SECRET`):

  ```
  0 17 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/winter-plan
  30 3 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/cron/winter-plan?day=today"
  ```

Threshold (default: minimum ≤ 1 °C or snow) and on/off are per company.
Workers are taken from the site's previous Winterdienst task; without
them the task stays a draft for the office. Recording the work in the app
marks the task as done.

## Leistungsnachweis

Each site's services (Objekte → *Leistungen & Monate*, with the standard
catalog plus the company's own services such as "Treppenhaus reinigen")
become the checklist of every visit planned in the Einsatzplanung.

- Worker app: *Zeiterfassung* → active shift → **Checkliste**. Per service:
  before photo, ✓ done (an after photo also marks it done), or ✗ not possible
  with a reason. Each tap is saved immediately (`/api/checks`).
- Web: **Leistungsnachweis** — per site and month: planned vs. done, who and
  when, before/after photos, compliance rate ("4 von 6 Leistungen erbracht"),
  and a PDF with a photo appendix for the property manager
  (`/api/reports/leistungsnachweis`).

## Photos and voice notes

Media is stored as files, not in the database. `STORAGE_DRIVER` picks where:

- `local` (default): the app server's disk, under `STORAGE_LOCAL_DIR` (default `./storage`). Include that folder in your backups.
- `s3`: any S3-compatible bucket (Hetzner Object Storage, MinIO, AWS). Set `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and, for most non-AWS providers, `S3_FORCE_PATH_STYLE=true`. Keep the bucket private; the app hands out 5-minute signed links.

Clients still send photos and voice notes as data URLs to `/api/data`. The
API checks the bytes (only JPEG/PNG/WebP/GIF images and common audio
formats, max 15 MB), stores the file, and saves `/api/media/<id>` in
`work_log_entries.content`. Older app versions keep working unchanged.
`GET /api/media/<id>` serves a file only to its own company (workers: only
their own uploads).

Existing Base64 media can be moved with `npm run media:migrate`
(`-- --dry-run` to count first). It is resumable and skips entries it cannot validate.

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
