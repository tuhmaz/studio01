-- ============================================================
-- 0008_client_portal — Kundenportal für Hausverwaltungen
--
--   * clients: die Hausverwaltung (Auftraggeber) eines Dienstleisters.
--   * job_sites.client_id: welches Objekt zu welcher Hausverwaltung gehört.
--   * users.role = 'CLIENT' + users.client_id: Portal-Logins. Ein CLIENT sieht
--     ausschließlich die Objekte seiner Hausverwaltung, nie interne Daten
--     (Löhne, Zeiten, Team). Die API lehnt CLIENT-Sitzungen außerhalb von
--     /api/portal/* grundsätzlich ab (siehe getRequestSession).
--   * defect_reports: Mängelmeldungen aus dem Portal; jede Meldung erzeugt
--     eine (noch unveröffentlichte) Aufgabe im Tourplan.
--   * companies.portal_show_worker_names: ob das Portal Mitarbeiternamen zeigt.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.clients (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clients_company_idx ON public.clients(company_id, name);

ALTER TABLE public.job_sites
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS job_sites_client_idx ON public.job_sites(company_id, client_id);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'LEADER', 'WORKER', 'CLIENT'));

-- Ein Portal-Login gehört immer zu genau einer Hausverwaltung, Mitarbeiter nie.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_client_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_client_role_check
  CHECK ((role = 'CLIENT') = (client_id IS NOT NULL));

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS portal_show_worker_names BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.defect_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id          TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  job_site_id        TEXT NOT NULL REFERENCES public.job_sites(id) ON DELETE CASCADE,
  title              TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description        TEXT CHECK (description IS NULL OR length(description) <= 4000),
  photo_media_id     UUID REFERENCES public.media_files(id) ON DELETE SET NULL,
  -- open: neu · scheduled: eingeplant · done: erledigt · rejected: abgelehnt
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'scheduled', 'done', 'rejected')),
  response           TEXT CHECK (response IS NULL OR length(response) <= 4000),
  job_assignment_id  TEXT REFERENCES public.job_assignments(id) ON DELETE SET NULL,
  reported_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reported_by_name   TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS defect_reports_company_idx ON public.defect_reports(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS defect_reports_client_idx  ON public.defect_reports(company_id, client_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'defect_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
         WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id())', t);
  END LOOP;
END $$;
