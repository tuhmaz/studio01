-- Backfill auth metadata columns for self-hosted PostgreSQL installs.
-- The Supabase auth schema had these from 001, but 004_self_hosted_schema
-- and older deploy/setup_database.sql installs did not.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS can_login_with_password BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS invite_id TEXT;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_auth_provider_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('password', 'anonymous'));
