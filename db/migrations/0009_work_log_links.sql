-- ============================================================
-- 0009_work_log_links — Notizen/Fotos/Sprachnachrichten dem Einsatz zuordnen
--
-- App, Zeiterfassung, Medien-Browser und Objekt-Verlauf lesen und schreiben
-- work_log_entries.job_assignment_id und .job_site_id, die im Schema fehlten
-- (Abfragen und Speichern scheiterten mit "column does not exist").
-- Bestehende Einträge werden über ihren Zeiteintrag nachgetragen.
-- ============================================================

ALTER TABLE public.work_log_entries
  ADD COLUMN IF NOT EXISTS job_assignment_id TEXT REFERENCES public.job_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_site_id       TEXT REFERENCES public.job_sites(id) ON DELETE SET NULL;

UPDATE public.work_log_entries w
   SET job_assignment_id = coalesce(w.job_assignment_id, t.job_assignment_id),
       job_site_id       = coalesce(w.job_site_id, t.job_site_id)
  FROM public.time_entries t
 WHERE t.id = w.time_entry_id
   AND (w.job_assignment_id IS NULL OR w.job_site_id IS NULL);

CREATE INDEX IF NOT EXISTS work_log_entries_assignment_idx ON public.work_log_entries(company_id, job_assignment_id);
CREATE INDEX IF NOT EXISTS work_log_entries_site_idx       ON public.work_log_entries(company_id, job_site_id, created_at);
