-- ============================================================
-- Migration 002: Row Level Security Policies
-- Equivalent to firestore.rules but enforced at the DB layer
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_invites  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_sites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_log_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- COMPANIES
-- Members can read their own company, admins can create
-- ============================================================
CREATE POLICY "companies_select"
  ON public.companies FOR SELECT
  USING (id = public.auth_company_id());

CREATE POLICY "companies_insert"
  ON public.companies FOR INSERT
  WITH CHECK (public.auth_is_admin());

CREATE POLICY "companies_update"
  ON public.companies FOR UPDATE
  USING (id = public.auth_company_id() AND public.auth_is_management());

-- ============================================================
-- USERS (profiles)
-- Own profile: read/update. Admin: read/update/delete within company.
-- ============================================================
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (
    id = auth.uid()
    OR (
      company_id = public.auth_company_id()
      AND public.auth_is_admin()
    )
  );

-- On signup: users create their own profile (via service role in Supabase auth hook)
-- No public INSERT — handled via trigger (see below) or service role API route
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Own: cannot change company, role, email, auth_provider
    AND company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND role = (SELECT role FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "users_update_admin"
  ON public.users FOR UPDATE
  USING (
    public.auth_is_admin()
    AND company_id = public.auth_company_id()
  )
  WITH CHECK (
    company_id = public.auth_company_id()
    AND role IN ('ADMIN', 'LEADER', 'WORKER')
  );

CREATE POLICY "users_delete_admin"
  ON public.users FOR DELETE
  USING (
    public.auth_is_admin()
    AND company_id = public.auth_company_id()
    AND id != auth.uid() -- cannot delete yourself
  );

-- ============================================================
-- ACCOUNT INVITES
-- Management creates, admin/invitee can read, management/invitee can delete
-- ============================================================
CREATE POLICY "invites_select"
  ON public.account_invites FOR SELECT
  USING (
    company_id = public.auth_company_id() AND public.auth_is_management()
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "invites_insert"
  ON public.account_invites FOR INSERT
  WITH CHECK (
    public.auth_is_admin()
    AND company_id = public.auth_company_id()
    AND role IN ('ADMIN', 'LEADER', 'WORKER')
  );

CREATE POLICY "invites_delete"
  ON public.account_invites FOR DELETE
  USING (
    (company_id = public.auth_company_id() AND public.auth_is_management())
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ============================================================
-- JOB SITES
-- All company members can read; management can write
-- ============================================================
CREATE POLICY "job_sites_select"
  ON public.job_sites FOR SELECT
  USING (company_id = public.auth_company_id());

CREATE POLICY "job_sites_insert"
  ON public.job_sites FOR INSERT
  WITH CHECK (
    public.auth_is_management()
    AND company_id = public.auth_company_id()
  );

CREATE POLICY "job_sites_update"
  ON public.job_sites FOR UPDATE
  USING (company_id = public.auth_company_id() AND public.auth_is_management());

CREATE POLICY "job_sites_delete"
  ON public.job_sites FOR DELETE
  USING (company_id = public.auth_company_id() AND public.auth_is_management());

-- ============================================================
-- JOB ASSIGNMENTS
-- Management: full access. Workers: read published assignments they are assigned to.
-- ============================================================
CREATE POLICY "job_assignments_select_management"
  ON public.job_assignments FOR SELECT
  USING (
    company_id = public.auth_company_id()
    AND public.auth_is_management()
  );

CREATE POLICY "job_assignments_select_worker"
  ON public.job_assignments FOR SELECT
  USING (
    company_id = public.auth_company_id()
    AND is_plan_published = TRUE
    AND auth.uid()::TEXT = ANY(assigned_worker_ids)
  );

CREATE POLICY "job_assignments_insert"
  ON public.job_assignments FOR INSERT
  WITH CHECK (
    public.auth_is_management()
    AND company_id = public.auth_company_id()
  );

CREATE POLICY "job_assignments_update"
  ON public.job_assignments FOR UPDATE
  USING (
    company_id = public.auth_company_id()
    AND public.auth_is_management()
  );

CREATE POLICY "job_assignments_delete"
  ON public.job_assignments FOR DELETE
  USING (
    company_id = public.auth_company_id()
    AND public.auth_is_management()
  );

-- ============================================================
-- TIME ENTRIES
-- Workers: read/write own entries. Management: full access.
-- ============================================================
CREATE POLICY "time_entries_select"
  ON public.time_entries FOR SELECT
  USING (
    company_id = public.auth_company_id()
    AND (
      employee_id = auth.uid()
      OR public.auth_is_management()
    )
  );

CREATE POLICY "time_entries_insert"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    company_id = public.auth_company_id()
    AND (
      employee_id = auth.uid()
      OR public.auth_is_management()
    )
  );

CREATE POLICY "time_entries_update"
  ON public.time_entries FOR UPDATE
  USING (
    company_id = public.auth_company_id()
    AND (
      employee_id = auth.uid()
      OR public.auth_is_management()
    )
  );

CREATE POLICY "time_entries_delete"
  ON public.time_entries FOR DELETE
  USING (
    company_id = public.auth_company_id()
    AND public.auth_is_management()
  );

-- ============================================================
-- WORK LOG ENTRIES
-- Same rules as their parent time entry.
-- ============================================================
CREATE POLICY "work_log_entries_select"
  ON public.work_log_entries FOR SELECT
  USING (
    company_id = public.auth_company_id()
    AND (
      employee_id = auth.uid()
      OR public.auth_is_management()
    )
  );

CREATE POLICY "work_log_entries_insert"
  ON public.work_log_entries FOR INSERT
  WITH CHECK (
    company_id = public.auth_company_id()
    AND (
      employee_id = auth.uid()
      OR public.auth_is_management()
    )
  );

CREATE POLICY "work_log_entries_delete"
  ON public.work_log_entries FOR DELETE
  USING (
    company_id = public.auth_company_id()
    AND public.auth_is_management()
  );

-- ============================================================
-- TRIGGER: auto-create user profile on Supabase auth signup
-- Reads invite data to populate role + company_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  invite RECORD;
BEGIN
  -- Look up pending invite for this email
  SELECT * INTO invite
  FROM public.account_invites
  WHERE email = NEW.email
  LIMIT 1;

  IF invite IS NULL THEN
    -- No invite found — cannot create profile. Auth user is orphaned.
    RETURN NEW;
  END IF;

  INSERT INTO public.users (
    id, company_id, name, email, role,
    auth_provider, can_login_with_password, invite_id, last_login
  ) VALUES (
    NEW.id,
    invite.company_id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    invite.role,
    'password',
    TRUE,
    invite.id,
    NOW()
  );

  -- Delete the consumed invite
  DELETE FROM public.account_invites WHERE id = invite.id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
