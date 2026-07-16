-- Production Security Foundation
-- Apply once on the production PostgreSQL database before deploying the hardened API.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Broaden role constraint for the new permission layer.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER'));

-- Optional columns already used by the UI/mobile profile in some builds.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS signature_data TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS kv_zusatz_rate NUMERIC(5,2) NOT NULL DEFAULT 1.70;

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

CREATE INDEX IF NOT EXISTS audit_logs_company_created_idx
  ON public.audit_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx
  ON public.audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_action_idx
  ON public.audit_logs(action);

-- Helpful production indexes.
CREATE INDEX IF NOT EXISTS users_company_status_idx
  ON public.users(company_id, role, created_at DESC);

CREATE INDEX IF NOT EXISTS job_sites_company_created_idx
  ON public.job_sites(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS time_entries_company_created_idx
  ON public.time_entries(company_id, created_at DESC);
