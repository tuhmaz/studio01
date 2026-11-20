/**
 * GET /api/cron/winter-plan?day=tomorrow|today — automatic Winterdienst planning
 * for every company that has it switched on. Called by the server's crontab:
 *
 *   0 17 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/winter-plan
 *   30 3 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/cron/winter-plan?day=today"
 *
 * The evening run plans the next morning; the early run catches forecasts that
 * changed overnight. Existing tasks are never duplicated.
 * Disabled (503) unless CRON_SECRET is set.
 */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { addDays, berlinDate, planWinterDay } from '@/lib/winter-plan';

function authorized(req: NextRequest, secret: string) {
  const given = Buffer.from(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: 'CRON_SECRET ist nicht gesetzt' }, { status: 503 });
  }
  if (!authorized(req, secret)) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });

  const today = berlinDate();
  const date = req.nextUrl.searchParams.get('day') === 'today' ? today : addDays(today, 1);

  // Platform-level job: finds the companies first, then works inside each tenant's scope.
  const companies = await sql`
    SELECT DISTINCT c.id FROM companies c
      JOIN job_sites s ON s.company_id = c.id AND s.winter_service_enabled
     WHERE c.winter_auto_plan
  `;

  const results = [];
  for (const { id } of companies) {
    try {
      const result = await planWinterDay({ companyId: id, date });
      results.push({ companyId: id, created: result.created, risky: result.sites.filter(s => s.risk).length });
    } catch (error) {
      console.error(`[cron/winter-plan] ${id}`, error);
      results.push({ companyId: id, error: true });
    }
  }
  return NextResponse.json({ date, companies: results });
}
