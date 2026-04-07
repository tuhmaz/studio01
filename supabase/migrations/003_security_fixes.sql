-- ============================================================
-- Migration 003: Security Advisor Fixes
-- Fixes "Function Search Path Mutable" warnings by adding
-- SET search_path = '' to all helper functions.
-- Moves pg_trgm extension from public to extensions schema.
-- ============================================================

-- ── 1. Fix search_path on all helper functions ────────────────────────────────
-- Adding SET search_path = '' prevents search_path injection attacks.
-- All object references inside the functions are already schema-qualified
-- (public.users, auth.uid(), etc.) so no other changes needed.

CREATE OR REPLACE FUNCTION public.auth_company_id()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_is_management()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role IN ('ADMIN', 'LEADER') FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role = 'ADMIN' FROM public.users WHERE id = auth.uid()
$$;

-- touch_updated_at is a plpgsql trigger — NOW() must be qualified
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

-- handle_new_auth_user is the auth trigger (defined in 002_rls.sql)
-- Recreate with SET search_path = '' and fully-qualified refs
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite  public.account_invites%ROWTYPE;
BEGIN
  -- Look up a matching invite to get company_id and role
  SELECT * INTO v_invite
  FROM public.account_invites
  WHERE email = NEW.email
  LIMIT 1;

  IF v_invite.id IS NOT NULL THEN
    INSERT INTO public.users (
      id, company_id, name, email, role,
      auth_provider, can_login_with_password, invite_id
    ) VALUES (
      NEW.id,
      v_invite.company_id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email,
      v_invite.role,
      'password',
      TRUE,
      v_invite.id
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Move pg_trgm from public to extensions schema ─────────────────────────
-- "Extension in Public" warning: extensions should live in the extensions schema.
-- We must drop the GIN index first (it uses gin_trgm_ops from pg_trgm),
-- then move the extension, then recreate the index with the new schema prefix.

DROP INDEX IF EXISTS public.users_name_trgm_idx;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- Recreate the GIN index referencing the operator class in its new schema
CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON public.users USING GIN (name extensions.gin_trgm_ops);
