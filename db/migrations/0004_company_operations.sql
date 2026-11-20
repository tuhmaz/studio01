-- ============================================================
-- 0004_company_operations — per-company HQ and travel-time rules
--
-- Until now the headquarters position (for travel times to job sites) and
-- the "remote site" rule (> 95 km → +60 min) were hard-coded for one
-- company. Each company now sets its own in Einstellungen.
-- ============================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS hq_lat               NUMERIC,
  ADD COLUMN IF NOT EXISTS hq_lng               NUMERIC,
  ADD COLUMN IF NOT EXISTS remote_threshold_km  NUMERIC NOT NULL DEFAULT 95,
  ADD COLUMN IF NOT EXISTS remote_bonus_minutes INTEGER NOT NULL DEFAULT 60;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_hq_lat_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_hq_lat_check CHECK (hq_lat IS NULL OR hq_lat BETWEEN -90 AND 90);
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_hq_lng_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_hq_lng_check CHECK (hq_lng IS NULL OR hq_lng BETWEEN -180 AND 180);
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_remote_threshold_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_remote_threshold_check CHECK (remote_threshold_km BETWEEN 0 AND 2000);
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_remote_bonus_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_remote_bonus_check CHECK (remote_bonus_minutes BETWEEN 0 AND 600);

-- Keep today's behaviour for the original company: its HQ was the hard-coded point.
UPDATE public.companies
   SET hq_lat = 52.0189651, hq_lng = 11.7265854
 WHERE id = 'tuhmaz-pro-2026' AND hq_lat IS NULL;
