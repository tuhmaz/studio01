-- Session invalidation support for self-hosted JWT sessions.
-- Any JWT issued before this timestamp is rejected by auth-server.ts.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_password_changed_at_idx
  ON public.users(password_changed_at);
