-- ============================================================
-- 0001_baseline — Hausmeister Pro canonical schema
--
-- Consolidates deploy/final_database_schema.sql and the historical
-- supabase/migrations 005–013 into one idempotent script, and adds the
-- account_invites table the app uses but the self-hosted schema lacked.
--
-- Safe to run on an existing production database: every statement is
-- IF NOT EXISTS / guarded, so it only fills in what is missing.
-- Applied by scripts/migrate.mjs; recorded in public.schema_migrations.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. COMPANIES
CREATE TABLE IF NOT EXISTS public.companies (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  site_name    TEXT,
  address      TEXT,
  city         TEXT,
  postal_code  TEXT,
  tax_number   TEXT,
  phone        TEXT,
  email        TEXT,
  website      TEXT,
  logo_data    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. USERS
CREATE TABLE IF NOT EXISTS public.users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            TEXT NOT NULL REFERENCES public.companies(id),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'WORKER'
                          CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER')),
  avatar_url            TEXT,

  -- Payroll & HR fields
  hourly_rate           NUMERIC(10, 2) NOT NULL DEFAULT 15,
  contract_type         TEXT NOT NULL DEFAULT 'VOLLZEIT'
                          CHECK (contract_type IN ('MINIJOB', 'MIDIJOB', 'VOLLZEIT', 'TEILZEIT')),
  tax_class             SMALLINT NOT NULL DEFAULT 1 CHECK (tax_class BETWEEN 1 AND 6),
  kinder                SMALLINT NOT NULL DEFAULT 0,
  has_church_tax        BOOLEAN NOT NULL DEFAULT FALSE,
  bundesland            TEXT NOT NULL DEFAULT 'ST',
  monthly_target_hours  INTEGER,
  sv_nr                 TEXT,
  steuer_id             TEXT,
  status_taetigkeit     TEXT,
  auth_provider         TEXT NOT NULL DEFAULT 'password'
                          CHECK (auth_provider IN ('password', 'anonymous')),
  can_login_with_password BOOLEAN NOT NULL DEFAULT TRUE,
  invite_id             TEXT,

  last_login            TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_company_id_idx ON public.users(company_id);
CREATE INDEX IF NOT EXISTS users_role_idx       ON public.users(company_id, role);
CREATE INDEX IF NOT EXISTS users_email_idx      ON public.users(email);

-- Auto-update updated_at for users
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. JOB SITES (Locations)
CREATE TABLE IF NOT EXISTS public.job_sites (
  id                                    TEXT PRIMARY KEY,
  company_id                            TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name                                  TEXT NOT NULL,
  address                               TEXT NOT NULL,
  city                                  TEXT NOT NULL,
  postal_code                           TEXT,
  region                                TEXT,
  route_code                            TEXT,
  is_remote                             BOOLEAN NOT NULL DEFAULT FALSE,
  distance_from_hq                      NUMERIC,
  travel_time_from_hq                   INTEGER NOT NULL DEFAULT 0,
  estimated_travel_time_minutes_from_hq INTEGER,
  lat                                   NUMERIC,
  lng                                   NUMERIC,
  services                              JSONB NOT NULL DEFAULT '{}',
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_sites_company_id_idx ON public.job_sites(company_id);

-- 4. JOB ASSIGNMENTS (Tasks / Shifts)
CREATE TABLE IF NOT EXISTS public.job_assignments (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_site_id         TEXT REFERENCES public.job_sites(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  scheduled_date      DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED')),
  assigned_worker_ids TEXT[] NOT NULL DEFAULT '{}',
  categories          TEXT[] NOT NULL DEFAULT '{}',
  is_plan_published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_assignments_company_date_idx
  ON public.job_assignments(company_id, scheduled_date);
CREATE INDEX IF NOT EXISTS job_assignments_worker_ids_idx
  ON public.job_assignments USING GIN (assigned_worker_ids);

-- 5. TIME ENTRIES (Clock in/out)
CREATE TABLE IF NOT EXISTS public.time_entries (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_assignment_id     TEXT REFERENCES public.job_assignments(id) ON DELETE SET NULL,
  job_site_id           TEXT REFERENCES public.job_sites(id) ON DELETE SET NULL,
  clock_in_datetime     TIMESTAMPTZ,
  clock_out_datetime    TIMESTAMPTZ,
  actual_work_minutes   INTEGER,
  travel_bonus_minutes  INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN', 'PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  gps_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  lat                   NUMERIC,
  lng                   NUMERIC,
  is_manual_entry       BOOLEAN NOT NULL DEFAULT FALSE,
  submission_datetime   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_entries_company_employee_idx
  ON public.time_entries(company_id, employee_id);
CREATE INDEX IF NOT EXISTS time_entries_assignment_idx
  ON public.time_entries(job_assignment_id);
CREATE INDEX IF NOT EXISTS time_entries_status_idx
  ON public.time_entries(company_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_unique_open_per_employee_assignment
  ON public.time_entries(employee_id, job_assignment_id)
  WHERE status = 'OPEN';

-- 6. WORK LOG ENTRIES (Photos, text notes, voice notes)
CREATE TABLE IF NOT EXISTS public.work_log_entries (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  time_entry_id TEXT NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('text', 'voice', 'photo')),
  content       TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  duration      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS work_log_entries_time_entry_idx
  ON public.work_log_entries(time_entry_id);
CREATE INDEX IF NOT EXISTS work_log_entries_employee_idx
  ON public.work_log_entries(employee_id);


-- 7. ACCOUNT INVITES (used by the team page; missing from older self-hosted installs)
CREATE TABLE IF NOT EXISTS public.account_invites (
  id         TEXT PRIMARY KEY DEFAULT 'invite-' || gen_random_uuid()::TEXT,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_invites_email_idx      ON public.account_invites(email);
CREATE INDEX IF NOT EXISTS account_invites_company_id_idx ON public.account_invites(company_id);

-- 8. USERS — columns added over time (005, 007, 010, 011, 012, 013)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sv_nr                   TEXT,
  ADD COLUMN IF NOT EXISTS steuer_id               TEXT,
  ADD COLUMN IF NOT EXISTS status_taetigkeit       TEXT,
  ADD COLUMN IF NOT EXISTS signature_data          TEXT,
  ADD COLUMN IF NOT EXISTS kv_zusatz_rate          NUMERIC(5,2) NOT NULL DEFAULT 1.70,
  ADD COLUMN IF NOT EXISTS auth_provider           TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS can_login_with_password BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS invite_id               TEXT,
  ADD COLUMN IF NOT EXISTS password_changed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sessions_revoked_at     TIMESTAMPTZ;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_auth_provider_check;
ALTER TABLE public.users ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('password', 'anonymous'));

CREATE INDEX IF NOT EXISTS users_password_changed_at_idx ON public.users(password_changed_at);
CREATE INDEX IF NOT EXISTS users_sessions_revoked_at_idx ON public.users(sessions_revoked_at);
CREATE INDEX IF NOT EXISTS users_company_status_idx      ON public.users(company_id, role, created_at DESC);

-- 9. COMPANIES — branding/contact columns (006)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS site_name   TEXT,
  ADD COLUMN IF NOT EXISTS address     TEXT,
  ADD COLUMN IF NOT EXISTS city        TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_number  TEXT,
  ADD COLUMN IF NOT EXISTS phone       TEXT,
  ADD COLUMN IF NOT EXISTS email       TEXT,
  ADD COLUMN IF NOT EXISTS website     TEXT,
  ADD COLUMN IF NOT EXISTS logo_data   TEXT;

-- 10. PAYROLL SETTLEMENTS (008, 009)
DO $$ BEGIN
  CREATE TYPE public.payroll_status AS ENUM ('DRAFT', 'SETTLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.payroll_settlements (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id            TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  total_minutes         INTEGER NOT NULL DEFAULT 0,
  prev_rollover_minutes INTEGER NOT NULL DEFAULT 0,
  net_minutes           INTEGER NOT NULL DEFAULT 0,
  minijob_minutes       INTEGER NOT NULL DEFAULT 0,
  cash_minutes          INTEGER NOT NULL DEFAULT 0,
  rollover_minutes      INTEGER NOT NULL DEFAULT 0,
  hourly_rate           NUMERIC(10,2) NOT NULL DEFAULT 0,
  cash_hourly_rate      NUMERIC(10,2) NOT NULL DEFAULT 0,
  minijob_limit_eur     NUMERIC(10,2) NOT NULL DEFAULT 603.00,
  minijob_amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  cash_amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
  status                public.payroll_status NOT NULL DEFAULT 'DRAFT',
  notes                 TEXT,
  settled_at            TIMESTAMPTZ,
  settled_by            UUID REFERENCES public.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, period_start)
);
ALTER TABLE public.payroll_settlements
  ADD COLUMN IF NOT EXISTS cash_hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.update_payroll_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS payroll_settlements_updated_at ON public.payroll_settlements;
CREATE TRIGGER payroll_settlements_updated_at
  BEFORE UPDATE ON public.payroll_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_payroll_updated_at();

CREATE INDEX IF NOT EXISTS idx_payroll_company  ON public.payroll_settlements(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON public.payroll_settlements(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period   ON public.payroll_settlements(company_id, period_start DESC);

-- 11. AUDIT LOGS (010)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  user_id     UUID,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_company_created_idx ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx    ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx          ON public.audit_logs(action);

CREATE INDEX IF NOT EXISTS job_sites_company_created_idx    ON public.job_sites(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_company_created_idx ON public.time_entries(company_id, created_at DESC);
