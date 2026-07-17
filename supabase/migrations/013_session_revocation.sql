-- Explicit session revocation for self-hosted JWT sessions.
-- Logout (web + mobile) sets sessions_revoked_at = now(); auth-server.ts then
-- rejects any JWT whose "issued at" (iat) predates this timestamp. This lets a
-- stolen or shared token be invalidated server-side without waiting for the
-- 7-day expiry, and complements password_changed_at (migration 012).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_sessions_revoked_at_idx
  ON public.users(sessions_revoked_at);
