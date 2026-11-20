-- ============================================================
-- 0003_media_files — photos and voice notes live in file storage
--
-- Each row describes one stored file (local disk or S3-compatible bucket,
-- see src/lib/storage.ts). work_log_entries.content then holds only the
-- reference "/api/media/<id>" instead of a Base64 data URL.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.media_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('photo', 'voice')),
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256       TEXT NOT NULL,
  storage_key  TEXT NOT NULL UNIQUE,
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_files_company_created_idx
  ON public.media_files(company_id, created_at DESC);

ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.media_files;
CREATE POLICY tenant_isolation ON public.media_files
  USING (app.current_company_id() IS NULL OR company_id = app.current_company_id())
  WITH CHECK (app.current_company_id() IS NULL OR company_id = app.current_company_id());
