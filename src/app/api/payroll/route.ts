/**
 * POST /api/payroll
 * Handles payroll settlement CRUD for Minijob workers.
 */
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getRequestSession, getRequestIp, getUserAgent } from '@/lib/request-context';
import { hasPermission, isAdminLike, hasRole } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function canAccessEmployee(session: any, employeeId?: string | null) {
  if (!employeeId) return false;
  return isAdminLike(session) || hasRole(session, ['MANAGER', 'ACCOUNTANT']) || session.userId === employeeId;
}

async function ensureCompanyEmployee(companyId: string, employeeId: string) {
  const rows = await sql`
    SELECT id FROM users
     WHERE id = ${employeeId}
       AND company_id = ${companyId}
     LIMIT 1
  `;
  return rows.length > 0;
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return err('Nicht authentifiziert', 401);

  const body = await req.json();
  const { action } = body;
  const companyId = session.companyId;

  try {
    switch (action) {
      case 'list': {
        if (!hasPermission(session, 'payroll.view')) return err('Keine Berechtigung', 403);
        const { periodStart } = body;
        if (!periodStart) return err('periodStart required');

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

      case 'get': {
        const { employeeId, periodStart } = body;
        if (!employeeId || !periodStart) return err('employeeId, periodStart required');
        if (!canAccessEmployee(session, employeeId)) return err('Keine Berechtigung', 403);
        if (!await ensureCompanyEmployee(companyId, employeeId)) return err('Mitarbeiter nicht gefunden', 404);

        const rows = await sql`
          SELECT * FROM payroll_settlements
           WHERE company_id   = ${companyId}
             AND employee_id  = ${employeeId}
             AND period_start = ${periodStart}
           LIMIT 1
        `;
        return NextResponse.json({ data: rows[0] ?? null });
      }

      case 'prev_rollover': {
        const { employeeId, beforePeriodStart } = body;
        if (!employeeId || !beforePeriodStart) return err('employeeId, beforePeriodStart required');
        if (!canAccessEmployee(session, employeeId)) return err('Keine Berechtigung', 403);
        if (!await ensureCompanyEmployee(companyId, employeeId)) return err('Mitarbeiter nicht gefunden', 404);

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

      case 'upsert': {
        if (!hasPermission(session, 'payroll.manage')) return err('Keine Berechtigung', 403);
        const {
          employeeId,
          periodStart, periodEnd,
          totalMinutes, prevRolloverMinutes, netMinutes,
          minijobMinutes, cashMinutes, rolloverMinutes,
          hourlyRate, cashHourlyRate, minijobLimitEur,
          minijobAmount, cashAmount,
          notes,
        } = body;

        if (!employeeId || !periodStart) return err('employeeId, periodStart required');
        if (!await ensureCompanyEmployee(companyId, employeeId)) return err('Mitarbeiter nicht gefunden', 404);

        const rows = await sql`
          INSERT INTO payroll_settlements (
            company_id, employee_id,
            period_start, period_end,
            total_minutes, prev_rollover_minutes, net_minutes,
            minijob_minutes, cash_minutes, rollover_minutes,
            hourly_rate, cash_hourly_rate, minijob_limit_eur,
            minijob_amount, cash_amount,
            status, notes
          ) VALUES (
            ${companyId}, ${employeeId},
            ${periodStart}, ${periodEnd},
            ${totalMinutes ?? 0}, ${prevRolloverMinutes ?? 0}, ${netMinutes ?? 0},
            ${minijobMinutes ?? 0}, ${cashMinutes ?? 0}, ${rolloverMinutes ?? 0},
            ${hourlyRate ?? 0}, ${cashHourlyRate ?? hourlyRate ?? 0}, ${minijobLimitEur ?? 603},
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
            cash_hourly_rate       = EXCLUDED.cash_hourly_rate,
            minijob_limit_eur      = EXCLUDED.minijob_limit_eur,
            minijob_amount         = EXCLUDED.minijob_amount,
            cash_amount            = EXCLUDED.cash_amount,
            notes                  = EXCLUDED.notes,
            status                 = 'DRAFT',
            settled_at             = NULL,
            settled_by             = NULL,
            updated_at             = now()
          RETURNING *
        `;
        await writeAuditLog({
          session,
          action: 'payroll.upsert',
          entityType: 'payroll_settlements',
          entityId: rows[0]?.id ?? `${employeeId}:${periodStart}`,
          newValue: rows[0] ?? null,
          ipAddress: getRequestIp(req),
          userAgent: getUserAgent(req),
        });
        return NextResponse.json({ data: rows[0] ?? null });
      }

      case 'settle': {
        if (!hasPermission(session, 'payroll.settle')) return err('Keine Berechtigung', 403);
        const { employeeId, periodStart } = body;
        if (!employeeId || !periodStart) return err('employeeId, periodStart required');
        if (!await ensureCompanyEmployee(companyId, employeeId)) return err('Mitarbeiter nicht gefunden', 404);

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
        await writeAuditLog({
          session,
          action: 'payroll.settle',
          entityType: 'payroll_settlements',
          entityId: rows[0]?.id ?? `${employeeId}:${periodStart}`,
          newValue: rows[0],
          ipAddress: getRequestIp(req),
          userAgent: getUserAgent(req),
        });
        return NextResponse.json({ data: rows[0] });
      }

      case 'delete': {
        if (!hasPermission(session, 'payroll.settle')) return err('Keine Berechtigung', 403);
        const { employeeId, periodStart } = body;
        if (!employeeId || !periodStart) return err('employeeId, periodStart required');
        if (!await ensureCompanyEmployee(companyId, employeeId)) return err('Mitarbeiter nicht gefunden', 404);

        const rows = await sql`
          DELETE FROM payroll_settlements
           WHERE company_id   = ${companyId}
             AND employee_id  = ${employeeId}
             AND period_start = ${periodStart}
             AND status       = 'DRAFT'
           RETURNING *
        `;
        await writeAuditLog({
          session,
          action: 'payroll.delete',
          entityType: 'payroll_settlements',
          entityId: rows[0]?.id ?? `${employeeId}:${periodStart}`,
          oldValue: rows[0] ?? null,
          ipAddress: getRequestIp(req),
          userAgent: getUserAgent(req),
        });
        return NextResponse.json({ data: null });
      }

      default:
        return err(`Unbekannte Aktion: ${action}`);
    }
  } catch (e: any) {
    console.error('[api/payroll]', e.message);
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 });
  }
}
