-- Migration 007: Digitale Unterschrift pro Mitarbeiter
-- Speichert die Unterschrift als SVG data-URL (base64-kodiert)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signature_data TEXT DEFAULT NULL;

COMMENT ON COLUMN public.users.signature_data IS
  'Digitale Unterschrift des Mitarbeiters als SVG data-URL (base64). Wird auf Arbeitszeitnachweis gedruckt.';
