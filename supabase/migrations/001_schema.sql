-- ============================================================
-- Migration 001: Initial Schema
-- Project: Tuhmaz Hausmeister Pro
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fast text search

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.companies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS (profiles — linked to auth.users via id)
-- Replaces: /users/{uid} + /companies/{id}/employees/{id}
--           + /companies/{id}/employeeDirectory/{id}
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id            TEXT NOT NULL REFERENCES public.companies(id),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('ADMIN', 'LEADER', 'WORKER')),
  avatar_url            TEXT,

  -- Payroll fields
  hourly_rate           NUMERIC(10, 2) NOT NULL DEFAULT 15,
  contract_type         TEXT NOT NULL DEFAULT 'VOLLZEIT'
                          CHECK (contract_type IN ('MINIJOB', 'MIDIJOB', 'VOLLZEIT', 'TEILZEIT')),
  tax_class             SMALLINT NOT NULL DEFAULT 1 CHECK (tax_class BETWEEN 1 AND 6),
  kinder                SMALLINT NOT NULL DEFAULT 0,
  has_church_tax        BOOLEAN NOT NULL DEFAULT FALSE,
  bundesland            TEXT NOT NULL DEFAULT 'ST',
  monthly_target_hours  INTEGER,

  -- Auth metadata
  auth_provider         TEXT NOT NULL DEFAULT 'password'
                          CHECK (auth_provider IN ('password', 'anonymous')),
  can_login_with_password BOOLEAN NOT NULL DEFAULT TRUE,
  invite_id             TEXT,

  last_login            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_company_id_idx ON public.users(company_id);
CREATE INDEX IF NOT EXISTS users_role_idx ON public.users(company_id, role);
CREATE INDEX IF NOT EXISTS users_name_trgm_idx ON public.users USING GIN (name gin_trgm_ops);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- ACCOUNT INVITES
-- Replaces: /accountInvites/{id}
-- ============================================================
CREATE TABLE IF NOT EXISTS public.account_invites (
  id         TEXT PRIMARY KEY DEFAULT 'invite-' || gen_random_uuid()::TEXT,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('ADMIN', 'LEADER', 'WORKER')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_invites_email_idx ON public.account_invites(email);
CREATE INDEX IF NOT EXISTS account_invites_company_id_idx ON public.account_invites(company_id);

-- ============================================================
-- JOB SITES
-- Replaces: /companies/{id}/jobSites/{id}
-- ============================================================
CREATE TABLE IF NOT EXISTS public.job_sites (
  id                                  TEXT PRIMARY KEY,
  company_id                          TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name                                TEXT NOT NULL,
  address                             TEXT NOT NULL,
  city                                TEXT NOT NULL,
  postal_code                         TEXT,
  region                              TEXT,
  route_code                          TEXT,
  is_remote                           BOOLEAN NOT NULL DEFAULT FALSE,
  distance_from_hq                    NUMERIC,
  travel_time_from_hq                 INTEGER NOT NULL DEFAULT 0, -- minutes
  estimated_travel_time_minutes_from_hq INTEGER,
  lat                                 NUMERIC,
  lng                                 NUMERIC,
  -- Flexible services map: { "AUSSENREINIGUNG": { isActive, frequency, months } }
  services                            JSONB NOT NULL DEFAULT '{}',
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_sites_company_id_idx ON public.job_sites(company_id);

-- ============================================================
-- JOB ASSIGNMENTS
-- Replaces: /companies/{id}/jobAssignments/{id}
-- ============================================================
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

-- ============================================================
-- TIME ENTRIES
-- Replaces: /companies/{id}/timeEntries/{id}
-- ============================================================
CREATE TABLE IF NOT EXISTS public.time_entries (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_assignment_id   TEXT REFERENCES public.job_assignments(id) ON DELETE SET NULL,
  job_site_id         TEXT REFERENCES public.job_sites(id) ON DELETE SET NULL,
  clock_in_datetime   TIMESTAMPTZ,
  clock_out_datetime  TIMESTAMPTZ,
  actual_work_minutes INTEGER,
  travel_bonus_minutes INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  gps_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  lat                 NUMERIC,
  lng                 NUMERIC,
  is_manual_entry     BOOLEAN NOT NULL DEFAULT FALSE,
  submission_datetime TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_entries_company_employee_idx
  ON public.time_entries(company_id, employee_id);
CREATE INDEX IF NOT EXISTS time_entries_assignment_idx
  ON public.time_entries(job_assignment_id);
CREATE INDEX IF NOT EXISTS time_entries_status_idx
  ON public.time_entries(company_id, status);

-- Prevent duplicate OPEN entries for same assignment+employee
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_unique_open_per_employee_assignment
  ON public.time_entries(employee_id, job_assignment_id)
  WHERE status = 'OPEN';

-- ============================================================
-- WORK LOG ENTRIES (notes on time entries)
-- Replaces: /companies/{id}/timeEntries/{id}/workLogEntries/{id}
-- ============================================================
CREATE TABLE IF NOT EXISTS public.work_log_entries (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  time_entry_id TEXT NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('text', 'voice', 'photo')),
  content       TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  duration      INTEGER, -- seconds, for voice notes
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS work_log_entries_time_entry_idx
  ON public.work_log_entries(time_entry_id);
CREATE INDEX IF NOT EXISTS work_log_entries_employee_idx
  ON public.work_log_entries(employee_id);

-- ============================================================
-- HELPER FUNCTIONS for RLS
-- Called inside policies — SECURITY DEFINER to read users table
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_company_id()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_is_management()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role IN ('ADMIN', 'LEADER') FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role = 'ADMIN' FROM public.users WHERE id = auth.uid()
$$;
