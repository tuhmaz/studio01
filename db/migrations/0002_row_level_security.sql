-- ============================================================
-- 0002_row_level_security — second line of defense for tenant isolation
--
-- The API already filters every query by the session's company. These
-- policies make PostgreSQL enforce the same rule on its own: inside a
-- request scoped with withTenant() (src/lib/db.ts), which sets the
-- transaction-local setting app.company_id, a query can only see and write
-- rows of that company — even if application code forgets a WHERE clause.
--
-- Rollout mode: when app.company_id is NOT set (login, session checks,
-- scripts), rows stay visible as before. This keeps every existing code path
-- working while the tenant-scoped routes gain enforcement. A later migration
-- can switch to strict mode once every path runs inside withTenant().
--
-- Note: superusers and roles with BYPASSRLS skip RLS entirely. Production
-- should connect as a dedicated non-superuser application role.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS app;

-- The company the current transaction is scoped to, or NULL when unscoped.
-- current_setting() returns '' (not NULL) once the setting was used earlier
-- on the same connection, so both count as "unscoped".
CREATE OR REPLACE FUNCTION app.current_company_id()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')
$$;

GRANT USAGE ON SCHEMA app TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_company_id() TO PUBLIC;

DO $$
DECLARE
  t TEXT;
  scoped_tables TEXT[] := ARRAY[
    'users', 'job_sites', 'job_assignments', 'time_entries',
    'work_log_entries', 'account_invites', 'payroll_settlements', 'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY scoped_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
         WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id())',
      t
    );
  END LOOP;
END $$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.companies;
CREATE POLICY tenant_isolation ON public.companies
  USING (app.current_company_id() IS NULL OR id = app.current_company_id())
  WITH CHECK (app.current_company_id() IS NULL OR id = app.current_company_id());
