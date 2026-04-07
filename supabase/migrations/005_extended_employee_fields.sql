-- Add extended employee fields for payroll and tax calculations
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS sv_nr TEXT,
ADD COLUMN IF NOT EXISTS steuer_id TEXT,
ADD COLUMN IF NOT EXISTS status_taetigkeit TEXT;