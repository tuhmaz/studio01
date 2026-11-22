-- ============================================================
-- 0011_service_check_source — Herkunft einer abgehakten Leistung
--
--   app    = vom Mitarbeiter vor Ort (Checkliste in App oder Web)
--   office = vom Büro nachgetragen (z. B. Einsätze aus der Zeit vor der
--            Checkliste). Im Leistungsnachweis als „Nachtrag“ gekennzeichnet.
-- ============================================================

ALTER TABLE public.service_checks
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app';

DO $$ BEGIN
  ALTER TABLE public.service_checks
    ADD CONSTRAINT service_checks_source_check CHECK (source IN ('app', 'office'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
