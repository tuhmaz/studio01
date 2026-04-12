-- ─── Add cash_hourly_rate to payroll_settlements ─────────────────────────────
-- Allows a separate hourly rate for Barzahlung (cash payment),
-- independent of the Minijob bank-transfer hourly rate.

ALTER TABLE public.payroll_settlements
  ADD COLUMN IF NOT EXISTS cash_hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Back-fill existing rows: use the stored hourly_rate as default
UPDATE public.payroll_settlements
   SET cash_hourly_rate = hourly_rate
 WHERE cash_hourly_rate = 0;
