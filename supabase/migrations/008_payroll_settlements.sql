-- ─── Payroll Settlements ─────────────────────────────────────────────────────
-- Stores monthly payroll settlements per employee.
-- Supports split payments: Minijob (bank transfer) + Cash + Rollover to next period.

CREATE TYPE payroll_status AS ENUM ('DRAFT', 'SETTLED');

CREATE TABLE IF NOT EXISTS public.payroll_settlements (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id            TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Abrechnungszeitraum: 21. Vormonat – 20. aktueller Monat
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,

  -- Stunden
  total_minutes         INTEGER NOT NULL DEFAULT 0,   -- Gesamte Arbeitsminuten der Periode
  prev_rollover_minutes INTEGER NOT NULL DEFAULT 0,   -- Übertrag aus Vormonat
  net_minutes           INTEGER NOT NULL DEFAULT 0,   -- total + prev_rollover (berechnet, zur Anzeige)

  -- Aufteilung der Zahlung
  minijob_minutes       INTEGER NOT NULL DEFAULT 0,   -- Minuten via Minijob (Banküberweisung)
  cash_minutes          INTEGER NOT NULL DEFAULT 0,   -- Minuten als Barzahlung
  rollover_minutes      INTEGER NOT NULL DEFAULT 0,   -- Minuten → Übertrag nächster Monat

  -- Geldbeträge (berechnet aus hourly_rate des Mitarbeiters)
  hourly_rate           NUMERIC(10,2) NOT NULL DEFAULT 0,
  minijob_limit_eur     NUMERIC(10,2) NOT NULL DEFAULT 603.00,  -- Minijob-Grenze ab 01.01.2026: 603 €
  minijob_amount        NUMERIC(10,2) NOT NULL DEFAULT 0,       -- Betrag Banküberweisung
  cash_amount           NUMERIC(10,2) NOT NULL DEFAULT 0,       -- Betrag Barzahlung

  -- Status & Metadaten
  status                payroll_status NOT NULL DEFAULT 'DRAFT',
  notes                 TEXT,
  settled_at            TIMESTAMPTZ,
  settled_by            UUID REFERENCES public.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ein Settlement pro Mitarbeiter pro Periode
  UNIQUE (company_id, employee_id, period_start)
);

-- Trigger: updated_at automatisch aktualisieren
CREATE OR REPLACE FUNCTION update_payroll_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_settlements_updated_at
  BEFORE UPDATE ON public.payroll_settlements
  FOR EACH ROW EXECUTE FUNCTION update_payroll_updated_at();

-- Indizes
CREATE INDEX IF NOT EXISTS idx_payroll_company ON public.payroll_settlements(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON public.payroll_settlements(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period ON public.payroll_settlements(company_id, period_start DESC);
