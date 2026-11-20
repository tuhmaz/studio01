-- ============================================================
-- 0007_service_checks — Leistungsnachweis
--
-- One row per service of a visit (job_assignments.categories) that a worker
-- ticked off on site: started (before photo taken), done, or not possible
-- with a reason, with optional before/after photos. The monthly report compares these with what was
-- planned.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.service_checks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_assignment_id TEXT NOT NULL REFERENCES public.job_assignments(id) ON DELETE CASCADE,
  job_site_id       TEXT,
  service_code      TEXT NOT NULL,
  service_label     TEXT NOT NULL,              -- name at the time of the check
  -- started: before photo taken, work not finished yet
  status            TEXT NOT NULL CHECK (status IN ('started', 'done', 'not_possible')),
  reason            TEXT,
  CHECK (status <> 'not_possible' OR reason IS NOT NULL),
  before_media_id   UUID,
  after_media_id    UUID,
  employee_id       UUID NOT NULL,
  employee_name     TEXT NOT NULL,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_assignment_id, service_code)
);

CREATE INDEX IF NOT EXISTS service_checks_site_idx
  ON public.service_checks(company_id, job_site_id, checked_at DESC);

ALTER TABLE public.service_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.service_checks;
CREATE POLICY tenant_isolation ON public.service_checks
  USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
  WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id());
