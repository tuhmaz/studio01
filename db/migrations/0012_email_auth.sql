-- ============================================================
-- 0012_email_auth — E-Mail: Bestätigung, Passwort vergessen, Einladungen
--
--   * users.email_verified_at — wann die Adresse bestätigt wurde
--     (Link aus der Bestätigungs-/Einladungs-/Zurücksetzen-Mail).
--     Bestehende Konten gelten als bestätigt: sie wurden vom Büro angelegt
--     und sollen durch das Update nicht eingeschränkt werden.
--   * auth_tokens — Einmal-Links. Gespeichert wird nur der SHA-256-Hash;
--     der Link selbst steht nur in der E-Mail.
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
UPDATE public.users SET email_verified_at = COALESCE(created_at, NOW()) WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS public.auth_tokens (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'invite')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON public.auth_tokens(user_id, purpose) WHERE used_at IS NULL;

ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.auth_tokens;
CREATE POLICY tenant_isolation ON public.auth_tokens
  USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
  WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id());
