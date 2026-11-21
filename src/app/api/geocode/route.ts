import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import {
  NOMINATIM_DELAY_MS,
  applyTravelRules,
  drivingRoute,
  geocodeAddress,
  sleep,
  travelRulesFromCompany,
  type GeoPoint,
} from '@/lib/geo';

const OSRM_DELAY_MS = 400;
const MAX_SITES_PER_REQUEST = 200;

/**
 * POST /api/geocode
 * Body: { siteIds?: string[], recalculate?: boolean }
 *
 * Default: finds coordinates for job sites that have none (Nominatim) and,
 * if the company has set its headquarters, the driving distance and time
 * from there (OSRM), applying the company's remote-site rule.
 *
 * recalculate: true — recomputes distance and travel time for sites that
 * already have coordinates, e.g. after the headquarters or the rule changed.
 */
export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'job_sites.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const recalculate = body?.recalculate === true;
  const requestedSiteIds: string[] = Array.isArray(body?.siteIds)
    ? body.siteIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 50)
    : [];

  const { companyId } = session;
  const [company] = await withTenant(companyId, db => db`
    SELECT hq_lat, hq_lng, remote_threshold_km, remote_bonus_minutes
      FROM companies WHERE id = ${companyId}
  `);
  const rules = travelRulesFromCompany(company);

  if (recalculate && !rules.hq) {
    return NextResponse.json(
      { error: 'Bitte zuerst den Firmensitz in den Einstellungen bestimmen.', hqMissing: true },
      { status: 400 },
    );
  }

  const sites = await withTenant(companyId, db => db`
    SELECT id, address, city, postal_code, lat, lng
      FROM job_sites
     WHERE company_id = ${companyId}
       ${requestedSiteIds.length ? db`AND id = ANY(${requestedSiteIds}::text[])` : db``}
       ${recalculate ? db`AND lat IS NOT NULL AND lng IS NOT NULL` : db`AND (lat IS NULL OR lng IS NULL)`}
     ORDER BY created_at
     LIMIT ${MAX_SITES_PER_REQUEST}
  `);

  if (!sites.length) {
    return NextResponse.json({
      geocoded: 0,
      routed: 0,
      hqMissing: !rules.hq,
      message: recalculate ? 'Keine Standorte mit Koordinaten gefunden.' : 'Alle Standorte haben bereits Koordinaten.',
    });
  }

  let geocoded = 0;
  let routed = 0;
  const results: Array<{ id: string; lat: number; lng: number; address: string; distanceKm?: number; travelMinutes?: number }> = [];

  for (const [index, site] of sites.entries()) {
    try {
      let point: GeoPoint;
      if (recalculate) {
        point = { lat: Number(site.lat), lng: Number(site.lng) };
      } else {
        if (index > 0) await sleep(NOMINATIM_DELAY_MS);
        const hit = await geocodeAddress({ address: site.address, city: site.city, postalCode: site.postal_code });
        if (!hit) continue;
        point = hit;
        geocoded++;
      }

      const route = rules.hq ? await drivingRoute(rules.hq, point) : null;
      const travel = route ? applyTravelRules(route, rules) : null;
      if (travel) routed++;

      // One short transaction per site: never hold a DB transaction open across the HTTP calls above.
      await withTenant(companyId, db => db`
        UPDATE job_sites
           SET lat = ${point.lat},
               lng = ${point.lng}
               ${travel ? db`,
               distance_from_hq = ${travel.distanceKm},
               travel_time_from_hq = ${travel.travelMinutes},
               estimated_travel_time_minutes_from_hq = ${travel.travelMinutes},
               is_remote = ${travel.isRemote}` : db``}
         WHERE id = ${site.id}
           AND company_id = ${companyId}
      `);

      results.push({
        id: site.id,
        lat: point.lat,
        lng: point.lng,
        address: site.address,
        distanceKm: travel?.distanceKm,
        travelMinutes: travel?.travelMinutes,
      });
      if (recalculate) await sleep(OSRM_DELAY_MS);
    } catch (error) {
      console.error(`[geocode] site ${site.id}`, error);
    }
  }

  return NextResponse.json({ geocoded, routed, hqMissing: !rules.hq, results });
}
