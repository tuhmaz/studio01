# Production Security Foundation

This update hardens the current MVP without replacing the existing UI flow.

## Added

- Session-aware request context for cookie and mobile Bearer-token APIs.
- Central role/permission system.
- Audit-log writer.
- Hardened `/api/data` with company scoping and protected write fields.
- Hardened `/api/payroll` with role/permission checks.
- Hardened `/api/provision-user` using `session.companyId` only.
- Safe `/api/health` response in production.
- Environment-driven cookie domain and CORS origins.
- New migration: `db/migrations/010_production_security_foundation.sql`.

## Required server action before deployment

1. Rotate all secrets that were included in older ZIP exports:
   - PostgreSQL password
   - JWT secret
   - Together AI key
   - SMTP/API credentials if used
2. Create a real `.env.production` on the server from `.env.example`.
3. Apply `db/migrations/010_production_security_foundation.sql`.
4. Restart the app.
5. Test login, team management, tracking, payroll, and mobile login.

## Important

`/api/data` is now safer but should still be replaced gradually with dedicated APIs:

- `/api/users`
- `/api/job-sites`
- `/api/assignments`
- `/api/time-entries`
- `/api/work-logs`
- `/api/payroll`
