-- ============================================================
-- 0010_notifications — Benachrichtigungen (Glocke im Web, Push in der App)
--
--   * notifications: eine Zeile je Empfänger. `kind` + `data` statt fertigem
--     Text, damit App und Web in der Sprache des Lesers anzeigen.
--     dedupe_key verhindert doppelte Erinnerungen (z. B. je Zeiteintrag).
--     pushed_at: wann der Push verschickt wurde (NULL = noch offen oder
--     Empfänger hat kein Gerät).
--   * push_tokens: Expo-Push-Token je Gerät, mit der App-Sprache des Geräts.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 60),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  link        TEXT,
  dedupe_key  TEXT,
  read_at     TIMESTAMPTZ,
  pushed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON public.notifications(company_id, user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON public.notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_unpushed_idx
  ON public.notifications(created_at) WHERE pushed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  token         TEXT PRIMARY KEY CHECK (length(token) BETWEEN 10 AND 300),
  company_id    TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios')),
  lang          TEXT NOT NULL DEFAULT 'de' CHECK (lang IN ('de', 'en', 'ar', 'tr', 'pl', 'ro', 'uk')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens(company_id, user_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notifications;
CREATE POLICY tenant_isolation ON public.notifications
  USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
  WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id());

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.push_tokens;
CREATE POLICY tenant_isolation ON public.push_tokens
  USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
  WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id());
