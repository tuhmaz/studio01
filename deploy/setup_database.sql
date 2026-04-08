-- ============================================================
--  TUHMAZ HAUSMEISTER PRO — Database Setup
--  Run once on your PostgreSQL server:
--
--  psql -h 152.53.31.61 -U serviedtu -d hausservrr -f setup_database.sql
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── COMPANIES ────────────────────────────────────────────────────
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

-- ── USERS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            TEXT NOT NULL REFERENCES public.companies(id),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'WORKER'
                          CHECK (role IN ('ADMIN', 'LEADER', 'WORKER')),
  avatar_url            TEXT,
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
  last_login            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_company_id_idx ON public.users(company_id);
CREATE INDEX IF NOT EXISTS users_role_idx       ON public.users(company_id, role);
CREATE INDEX IF NOT EXISTS users_email_idx      ON public.users(email);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── JOB SITES ────────────────────────────────────────────────────
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

-- ── JOB ASSIGNMENTS ──────────────────────────────────────────────
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

-- ── TIME ENTRIES ─────────────────────────────────────────────────
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

-- ── WORK LOG ENTRIES ─────────────────────────────────────────────
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

-- ── SEED: Company + Admin ─────────────────────────────────────────
-- Admin password: Admin@2026  (غيّرها بعد أول تسجيل دخول)
INSERT INTO public.companies (id, name)
VALUES ('tuhmaz-pro-2026', 'Tuhmaz Hausmeister')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (
  company_id, name, email, password_hash, role,
  contract_type, hourly_rate, tax_class, kinder, has_church_tax, bundesland
) VALUES (
  'tuhmaz-pro-2026',
  'Admin',
  'j.tuhmaz@gmail.com',
  '$2b$12$FhgT0Oa8Jja6XkztBfawNOAXp9f0wVI/I/K/hJf.nEQWT0.xFXccC',
  'ADMIN', 'VOLLZEIT', 0, 1, 0, false, 'ST'
) ON CONFLICT (email) DO NOTHING;

-- ── تم بنجاح ─────────────────────────────────────────────────────
SELECT 'Database setup complete!' AS status;
