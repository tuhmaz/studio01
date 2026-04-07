-- Migration 006: Extend companies table with full branding & contact settings
-- Run this on your PostgreSQL instance.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS site_name    TEXT,          -- custom platform/app name shown in header
  ADD COLUMN IF NOT EXISTS address      TEXT,          -- Straße + Hausnummer
  ADD COLUMN IF NOT EXISTS city         TEXT,          -- Stadt
  ADD COLUMN IF NOT EXISTS postal_code  TEXT,          -- PLZ
  ADD COLUMN IF NOT EXISTS tax_number   TEXT,          -- Steuernummer (e.g. 123/456/78901)
  ADD COLUMN IF NOT EXISTS phone        TEXT,          -- Telefon
  ADD COLUMN IF NOT EXISTS email        TEXT,          -- Kontakt-E-Mail
  ADD COLUMN IF NOT EXISTS website      TEXT,          -- Website (optional)
  ADD COLUMN IF NOT EXISTS logo_data    TEXT;          -- base64 data-URL of company logo

-- Optional: seed defaults for existing companies so the settings page is not blank
-- UPDATE public.companies SET site_name = name WHERE site_name IS NULL;
