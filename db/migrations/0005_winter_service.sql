-- ============================================================
-- 0005_winter_service — Winterdienst: per-site setup and a tamper-evident log
--
-- Every clearing / gritting run is one row in winter_service_logs. The log is
-- evidence in liability cases (someone slips, the insurer asks for proof), so:
--   * rows can never be updated or deleted (trigger below); a mistake is fixed
--     by appending a correction entry that points at the original;
--   * each row carries the SHA-256 of its content chained to the previous row
--     of the same company (prev_hash → hash), so any later change to stored
--     rows is detectable (GET /api/winter/verify);
--   * site, address and worker name are copied into the row, so the record
--     stays complete even if the site or the user is renamed or removed.
-- ============================================================

ALTER TABLE public.job_sites
  ADD COLUMN IF NOT EXISTS winter_service_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS winter_areas           TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS winter_notes           TEXT;

CREATE INDEX IF NOT EXISTS job_sites_winter_idx
  ON public.job_sites(company_id) WHERE winter_service_enabled;

CREATE TABLE IF NOT EXISTS public.winter_service_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         TEXT NOT NULL REFERENCES public.companies(id),
  chain_seq          BIGINT NOT NULL,

  job_site_id        TEXT NOT NULL,
  site_label         TEXT NOT NULL,             -- name + address at the time of the entry
  employee_id        UUID NOT NULL,
  employee_name      TEXT NOT NULL,             -- who did the work
  entered_by         UUID NOT NULL,
  entered_by_name    TEXT NOT NULL,             -- who made this entry (differs for corrections)

  performed_at       TIMESTAMPTZ NOT NULL,      -- when the work was done (device clock, may be offline)
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when the server received it

  activity           TEXT NOT NULL CHECK (activity IN ('clearing', 'gritting', 'clearing_gritting', 'inspection')),
  grit_material      TEXT CHECK (grit_material IN ('salt', 'grit', 'sand', 'granulate', 'mixed')),
  grit_amount_kg     NUMERIC(8, 2) CHECK (grit_amount_kg IS NULL OR grit_amount_kg BETWEEN 0 AND 10000),
  areas              TEXT[] NOT NULL DEFAULT '{}',
  notes              TEXT,

  lat                NUMERIC,
  lng                NUMERIC,
  gps_accuracy_m     NUMERIC,
  photo_media_id     UUID,
  weather            JSONB,                     -- observation near the site at performed_at (DWD via Bright Sky)

  corrects_log_id    UUID REFERENCES public.winter_service_logs(id),
  correction_reason  TEXT,
  voided             BOOLEAN NOT NULL DEFAULT FALSE,  -- a correction that cancels the original
  CHECK ((corrects_log_id IS NULL) = (correction_reason IS NULL)),
  CHECK (NOT voided OR corrects_log_id IS NOT NULL),

  client_request_id  UUID,                      -- set by the app; makes offline retries idempotent

  prev_hash          TEXT,
  hash               TEXT NOT NULL,

  UNIQUE (company_id, chain_seq),
  UNIQUE (company_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS winter_logs_site_time_idx
  ON public.winter_service_logs(company_id, job_site_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS winter_logs_company_time_idx
  ON public.winter_service_logs(company_id, performed_at DESC);

CREATE OR REPLACE FUNCTION public.winter_logs_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'winter_service_logs is append-only: add a correction entry instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS winter_logs_no_update ON public.winter_service_logs;
CREATE TRIGGER winter_logs_no_update
  BEFORE UPDATE OR DELETE ON public.winter_service_logs
  FOR EACH ROW EXECUTE FUNCTION public.winter_logs_append_only();

ALTER TABLE public.winter_service_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winter_service_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.winter_service_logs;
CREATE POLICY tenant_isolation ON public.winter_service_logs
  USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
  WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id());
