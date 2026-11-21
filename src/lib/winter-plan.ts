/**
 * Automatic Winterdienst planning.
 *
 * For a given day, checks the DWD forecast (via Bright Sky) for the night
 * before and the morning (18:00 the evening before until 10:00), and creates
 * one "Winterdienst" task per winter site in the Tourplan when frost or snow
 * is expected:
 *   - risk = minimum temperature <= the company's threshold, or snow / sleet / hail
 *   - task id "winter-<siteId>-<date>": planning twice never duplicates
 *   - workers are taken from the site's previous Winterdienst task; with
 *     workers the task is published right away, without it stays a draft
 *     for the office to assign
 */
import { notifyAssignmentChanges } from '@/lib/notifications';
import { withTenant } from '@/lib/db';
import { travelRulesFromCompany } from '@/lib/geo';
import { WINTER_CATEGORY } from '@/lib/services';

export { WINTER_CATEGORY };

export interface Forecast {
  available: boolean;
  minTempC: number | null;
  snowOrIce: boolean;
  precipitationMm: number;
}

export interface PlannedSite {
  siteId: string;
  name: string;
  forecast: Forecast;
  risk: boolean;
  status: 'created' | 'exists' | 'skipped' | 'no_forecast';
  workerIds: string[];
  published: boolean;
}

export interface PlanResult {
  date: string;
  thresholdC: number;
  created: number;
  sites: PlannedSite[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date in Germany ("YYYY-MM-DD"). */
export function berlinDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isPlanDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function winterTaskId(siteId: string, date: string) {
  return `winter-${siteId}-${date}`;
}

const ICY_CONDITIONS = new Set(['snow', 'sleet', 'hail']);

/** Forecast for the clearing window of `date` (evening before 18:00 → 10:00). */
export async function fetchForecast(lat: number, lng: number, date: string): Promise<Forecast> {
  // Europe/Berlin is UTC+1 in winter: 17:00Z the day before … 09:00Z on the day.
  const from = `${addDays(date, -1)}T17:00:00Z`;
  const to = `${date}T09:00:00Z`;
  const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lng}&date=${from}&last_date=${to}&tz=Etc/UTC`;
  try {
    const res = await fetch(url, { signal: globalThis.AbortSignal.timeout(5000) });
    if (!res.ok) return { available: false, minTempC: null, snowOrIce: false, precipitationMm: 0 };
    const records: Array<{ temperature?: number | null; condition?: string | null; precipitation?: number | null }> =
      (await res.json())?.weather ?? [];
    const temps = records.map(r => r.temperature).filter((t): t is number => typeof t === 'number');
    if (!temps.length) return { available: false, minTempC: null, snowOrIce: false, precipitationMm: 0 };
    return {
      available: true,
      minTempC: Math.min(...temps),
      snowOrIce: records.some(r => r.condition != null && ICY_CONDITIONS.has(r.condition)),
      precipitationMm: Math.round(records.reduce((sum, r) => sum + (r.precipitation ?? 0), 0) * 10) / 10,
    };
  } catch {
    return { available: false, minTempC: null, snowOrIce: false, precipitationMm: 0 };
  }
}

export function isWinterRisk(forecast: Forecast, thresholdC: number) {
  return forecast.available && (forecast.snowOrIce || (forecast.minTempC != null && forecast.minTempC <= thresholdC));
}

export interface PlanOptions {
  companyId: string;
  date: string;
  /** Create tasks for every winter site regardless of the forecast. */
  force?: boolean;
  /** Only report what would happen. */
  dryRun?: boolean;
  createdBy?: string | null;
}

export async function planWinterDay({ companyId, date, force = false, dryRun = false, createdBy = null }: PlanOptions): Promise<PlanResult> {
  const { company, sites } = await withTenant(companyId, async db => {
    const [company] = await db`
      SELECT hq_lat, hq_lng, winter_plan_min_temp_c FROM companies WHERE id = ${companyId}
    `;
    const sites = await db`
      SELECT id, name, lat, lng FROM job_sites
       WHERE company_id = ${companyId} AND winter_service_enabled
       ORDER BY name
    `;
    return { company, sites };
  });
  const thresholdC = Number(company?.winter_plan_min_temp_c ?? 1);
  const hq = travelRulesFromCompany(company).hq;

  // Sites close to each other share one forecast (grid of ~0.1°, about 10 km).
  const forecasts = new Map<string, Forecast>();
  const result: PlannedSite[] = [];
  for (const site of sites) {
    const lat = site.lat != null ? Number(site.lat) : hq?.lat;
    const lng = site.lng != null ? Number(site.lng) : hq?.lng;
    let forecast: Forecast = { available: false, minTempC: null, snowOrIce: false, precipitationMm: 0 };
    if (lat != null && lng != null) {
      const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
      if (!forecasts.has(key)) forecasts.set(key, await fetchForecast(lat, lng, date));
      forecast = forecasts.get(key)!;
    }
    const risk = isWinterRisk(forecast, thresholdC);
    result.push({
      siteId: site.id,
      name: site.name,
      forecast,
      risk,
      status: force || risk ? 'created' : forecast.available ? 'skipped' : 'no_forecast',
      workerIds: [],
      published: false,
    });
  }

  let created = 0;
  const toPlan = result.filter(r => r.status === 'created');
  if (toPlan.length) {
    await withTenant(companyId, async db => {
      for (const entry of toPlan) {
        const [previous] = await db`
          SELECT assigned_worker_ids FROM job_assignments
           WHERE company_id = ${companyId}
             AND job_site_id = ${entry.siteId}
             AND ${WINTER_CATEGORY} = ANY(categories)
             AND scheduled_date < ${date}
           ORDER BY scheduled_date DESC
           LIMIT 1
        `;
        entry.workerIds = previous?.assigned_worker_ids ?? [];
        entry.published = entry.workerIds.length > 0;

        const [existing] = await db`SELECT 1 FROM job_assignments WHERE id = ${winterTaskId(entry.siteId, date)}`;
        if (existing) { entry.status = 'exists'; continue; }
        if (dryRun) continue;

        const inserted = await db`
          INSERT INTO job_assignments
            (id, company_id, job_site_id, title, scheduled_date, status, assigned_worker_ids, categories, is_plan_published, created_by)
          VALUES
            (${winterTaskId(entry.siteId, date)}, ${companyId}, ${entry.siteId}, 'Winterdienst', ${date}, 'PENDING',
             ${db.array(entry.workerIds)}, ${db.array([WINTER_CATEGORY])}, ${entry.published}, ${createdBy})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        if (inserted.length) {
          created += 1;
          if (entry.published) await notifyAssignmentChanges(db, companyId, new Map(), [winterTaskId(entry.siteId, date)], createdBy);
        }
        else entry.status = 'exists';
      }
    });
  }

  return { date, thresholdC, created, sites: result };
}

/**
 * Recording Winterdienst work completes the day's Winterdienst task(s) of the
 * site — the auto-planned one as well as tasks created by hand in the
 * Einsatzplanung — as long as the task is only about Winterdienst (a task
 * that also carries other services stays open for its checklist) and nobody
 * is still clocked in on it (their clock-out completes it).
 */
export async function completeWinterTask(
  db: Parameters<Parameters<typeof withTenant>[1]>[0],
  companyId: string,
  siteId: string,
  performedAt: Date,
) {
  await db`
    UPDATE job_assignments a SET status = 'COMPLETED'
     WHERE a.company_id = ${companyId}
       AND a.job_site_id = ${siteId}
       AND a.scheduled_date = ${berlinDate(performedAt)}
       AND a.categories = ARRAY[${WINTER_CATEGORY}]::text[]
       AND a.status <> 'COMPLETED'
       AND NOT EXISTS (
             SELECT 1 FROM time_entries t
              WHERE t.company_id = a.company_id
                AND t.job_assignment_id = a.id
                AND t.clock_out_datetime IS NULL
           )
  `;
}
