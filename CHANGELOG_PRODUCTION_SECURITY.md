# Production Security Foundation — Change Log

## Security changes

- Removed committed environment files from the deliverable copy.
- Added `.env.example` with safe placeholders only.
- Removed generated/mobile build artifacts from the deliverable copy.
- Removed default admin password comments and default admin seed from SQL exports.
- Added `scripts/create-admin.mjs` for secure server-side admin creation/rotation.
- Replaced hard-coded cookie domain with `COOKIE_DOMAIN`.
- Replaced hard-coded CORS origin list with `ALLOWED_ORIGINS` / `NEXT_PUBLIC_APP_URL`.
- Hardened `/api/health` to return only `{ status: "ok" }` unless `x-health-secret` is supplied.
- Added login rate limiting and audit logging for login success/failure/rate-limit.

## API hardening

- Added `src/lib/request-context.ts` to resolve cookie and Bearer-token sessions consistently.
- Added `src/lib/permissions.ts` for central role/permission checks.
- Added `src/lib/audit.ts` for safe audit logging.
- Added `src/lib/security.ts` for safe identifiers/selects and protected write-field filtering.
- Hardened `/api/data`:
  - All company-scoped tables are forced to `session.companyId`.
  - `companies` access is forced to the authenticated user's company.
  - Generic user writes are permission-gated.
  - Protected fields such as `company_id`, `password_hash`, timestamps, and admin-only payroll fields are filtered.
  - Write operations are recorded in `audit_logs`.
- Hardened `/api/payroll`:
  - Uses `session.companyId` only.
  - Adds role/permission checks for list/get/upsert/settle/delete.
  - Writes audit events for payroll mutations.
- Hardened `/api/provision-user`:
  - Uses `session.companyId` only.
  - Enforces minimum password length of 12 characters.
  - Adds audit logging.

## Database changes

- Added `db/migrations/010_production_security_foundation.sql`:
  - Adds/updates role constraint for `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `LEADER`, `WORKER`.
  - Adds `audit_logs` table and indexes.
  - Adds `signature_data` and `kv_zusatz_rate` columns used by UI/mobile profile flows.
  - Adds helpful production indexes.

## Build/test status in this environment

- `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: started compilation but did not complete within the sandbox timeout. No TypeScript or ESLint errors were reported before the timeout.

## Required server steps

1. Rotate all secrets exposed in older archives.
2. Create the real production `.env` from `.env.example` on the server only.
3. Apply `db/migrations/010_production_security_foundation.sql`.
4. Create/rotate the admin user using `node scripts/create-admin.mjs`.
5. Run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm run build` on the real server.
6. Test web login, team management, tracking, payroll, and mobile login before replacing production.
