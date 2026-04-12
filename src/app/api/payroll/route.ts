/**
 * POST /api/payroll
 * Handles payroll settlement CRUD for Minijob workers.
 *
 * Actions:
 *   list    → GET all settlements for company + period
 *   get     → GET one settlement by employee + period_start
 *   upsert  → INSERT or UPDATE a settlement (DRAFT)
 *   settle  → Mark settlement as SETTLED (locked)
 *   delete  → Delete a DRAFT settlement
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, verifyTokenString } from '@/lib/auth-server';
import sql from '@/lib/db';

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = bearerToken ? await verifyTokenString(bearerToken) : await getSession();
  if (!session) return err('Nicht authentifiziert', 401);

  const body = await req.json();
  const { action } = body;

  try {
    switch (action) {

      // ── List settlements for a period ──────────────────────────────────────
      case 'list': {
        const { companyId, periodStart } = body;
        if (!companyId || !periodStart) return err('companyId and periodStart required');

        const rows = await sql`
          SELECT ps.*,
                 u.name   AS employee_name,
                 u.hourly_rate AS employee_hourly_rate,
                 u.contract_type
            FROM payroll_settlements ps
            JOIN users u ON u.id = ps.employee_id
           WHERE ps.company_id  = ${companyId}
             AND ps.period_start = ${periodStart}
           ORDER BY u.name
        `;
        return NextResponse.json({ data: rows });
      }

      // ── Get one settlement ─────────────────────────────────────────────────
      case 'get': {
        const { companyId, employeeId, periodStart } = body;
        if (!companyId || !employeeId || !periodStart) return err('companyId, employeeId, periodStart required');

        const rows = await sql`
          SELECT * FROM payroll_settlements
           WHERE company_id   = ${companyId}
             AND employee_id  = ${employeeId}
             AND period_start = ${periodStart}
           LIMIT 1
        `;
        return NextResponse.json({ data: rows[0] ?? null });
      }

      // ── Get previous rollover for an employee ──────────────────────────────
      case 'prev_rollover': {
        const { companyId, employeeId, beforePeriodStart } = body;
        if (!companyId || !employeeId || !beforePeriodStart) return err('companyId, employeeId, beforePeriodStart required');

        const rows = await sql`
          SELECT rollover_minutes, period_start, period_end
            FROM payroll_settlements
           WHERE company_id   = ${companyId}
             AND employee_id  = ${employeeId}
             AND period_start < ${beforePeriodStart}
             AND status       = 'SETTLED'
           ORDER BY period_start DESC
           LIMIT 1
        `;
        return NextResponse.json({ data: rows[0] ?? null });
      }

      // ── Upsert (save draft) ────────────────────────────────────────────────
      case 'upsert': {
        const {
          companyId, employeeId,
          periodStart, periodEnd,
          totalMinutes, prevRolloverMinutes, netMinutes,
          minijobMinutes, cashMinutes, rolloverMinutes,
          hourlyRate, minijobLimitEur,
          minijobAmount, cashAmount,
          notes,
        } = body;

        if (!companyId || !employeeId || !periodStart) return err('companyId, employeeId, periodStart required');

        const rows = await sql`
          INSERT INTO payroll_settlements (
            company_id, employee_id,
            period_start, period_end,
            total_minutes, prev_rollover_minutes, net_minutes,
            minijob_minutes, cash_minutes, rollover_minutes,
            hourly_rate, minijob_limit_eur,
            minijob_amount, cash_amount,
            status, notes
          ) VALUES (
            ${companyId}, ${employeeId},
            ${periodStart}, ${periodEnd},
            ${totalMinutes ?? 0}, ${prevRolloverMinutes ?? 0}, ${netMinutes ?? 0},
            ${minijobMinutes ?? 0}, ${cashMinutes ?? 0}, ${rolloverMinutes ?? 0},
            ${hourlyRate ?? 0}, ${minijobLimitEur ?? 603},
            ${minijobAmount ?? 0}, ${cashAmount ?? 0},
            'DRAFT', ${notes ?? null}
          )
          ON CONFLICT (company_id, employee_id, period_start)
          DO UPDATE SET
            period_end             = EXCLUDED.period_end,
            total_minutes          = EXCLUDED.total_minutes,
            prev_rollover_minutes  = EXCLUDED.prev_rollover_minutes,
            net_minutes            = EXCLUDED.net_minutes,
            minijob_minutes        = EXCLUDED.minijob_minutes,
            cash_minutes           = EXCLUDED.cash_minutes,
            rollover_minutes       = EXCLUDED.rollover_minutes,
            hourly_rate            = EXCLUDED.hourly_rate,
            minijob_limit_eur      = EXCLUDED.minijob_limit_eur,
            minijob_amount         = EXCLUDED.minijob_amount,
            cash_amount            = EXCLUDED.cash_amount,
            notes                  = EXCLUDED.notes,
            updated_at             = now()
          WHERE payroll_settlements.status = 'DRAFT'
          RETURNING *
        `;
        return NextResponse.json({ data: rows[0] ?? null });
      }

      // ── Settle (lock) ──────────────────────────────────────────────────────
      case 'settle': {
        const { companyId, employeeId, periodStart } = body;
        if (!companyId || !employeeId || !periodStart) return err('companyId, employeeId, periodStart required');

        const rows = await sql`
          UPDATE payroll_settlements
             SET status     = 'SETTLED',
                 settled_at = now(),
                 settled_by = ${session.userId},
                 updated_at = now()
           WHERE company_id   = ${companyId}
             AND employee_id  = ${employeeId}
             AND period_start = ${periodStart}
             AND status       = 'DRAFT'
          RETURNING *
        `;
        if (!rows.length) return err('Settlement not found or already settled', 404);
        return NextResponse.json({ data: rows[0] });
      }

      // ── Delete draft ───────────────────────────────────────────────────────
      case 'delete': {
        const { companyId, employeeId, periodStart } = body;
        if (!companyId || !employeeId || !periodStart) return err('companyId, employeeId, periodStart required');

        await sql`
          DELETE FROM payroll_settlements
           WHERE company_id   = ${companyId}
             AND employee_id  = ${employeeId}
             AND period_start = ${periodStart}
             AND status       = 'DRAFT'
        `;
        return NextResponse.json({ data: null });
      }

      default:
        return err(`Unbekannte Aktion: ${action}`);
    }
  } catch (e: any) {
    console.error('[api/payroll]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
