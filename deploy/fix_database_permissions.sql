-- ============================================================
--  Fix application database permissions
--
--  Run this as the table owner or a PostgreSQL superuser.
--  It grants the application role permission to use the public
--  schema and read/write the application tables.
-- ============================================================

DO $$
DECLARE
  app_role TEXT;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['hausmeister', 'serviedtu', 'hausmeister_app']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
      EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);

      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
        app_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
        app_role
      );

      RAISE NOTICE 'Granted application permissions to role %', app_role;
    END IF;
  END LOOP;
END $$;

