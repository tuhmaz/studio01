-- ============================================================
-- 0006_winter_planning — automatic Winterdienst tasks in the Tourplan
--
-- On days with frost or snow in the forecast, every site with Winterdienst
-- gets a "Winterdienst" job assignment (category WINTERDIENST). Each company
-- decides whether this runs automatically and from which forecast minimum
-- temperature.
-- ============================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS winter_auto_plan       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS winter_plan_min_temp_c NUMERIC NOT NULL DEFAULT 1;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_winter_plan_min_temp_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_winter_plan_min_temp_check
  CHECK (winter_plan_min_temp_c BETWEEN -20 AND 10);

-- Finding the last Winterdienst assignment of a site (to reuse its workers).
CREATE INDEX IF NOT EXISTS job_assignments_site_date_idx
  ON public.job_assignments(company_id, job_site_id, scheduled_date DESC);
