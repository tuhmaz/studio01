/**
 * POST /api/geo/route — position and travel time of one address, using the
 * company's headquarters and remote-site rule. Used by the job-site dialog
 * and the Excel import, so every travel time is computed the same way.
 *
 * Body: { address?, city?, postalCode?, lat?, lng? }
 * With lat/lng the geocoding step is skipped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { applyTravelRules, drivingRoute, geocodeAddress, travelRulesFromCompany, type GeoPoint } from '@/lib/geo';
import { hasPermission } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';

const str = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'job_sites.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const [company] = await withTenant(session.companyId, db => db`
    SELECT hq_lat, hq_lng, remote_threshold_km, remote_bonus_minutes
      FROM companies WHERE id = ${session.companyId}
  `);
  const rules = travelRulesFromCompany(company);

  let point: GeoPoint | null = null;
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    point = { lat, lng };
  } else {
    const address = str(body?.address);
    const city = str(body?.city);
    if (!address && !city) return NextResponse.json({ error: 'Adresse oder Stadt fehlt' }, { status: 400 });
    const hit = await geocodeAddress({ address, city, postalCode: str(body?.postalCode) });
    if (!hit) return NextResponse.json({ error: 'Adresse konnte nicht gefunden werden.' }, { status: 422 });
    point = { lat: hit.lat, lng: hit.lng };
  }

  if (!rules.hq) {
    return NextResponse.json({ ...point, hqMissing: true, distanceKm: null, travelMinutes: null, isRemote: false });
  }
  const route = await drivingRoute(rules.hq, point);
  if (!route) return NextResponse.json({ ...point, hqMissing: false, distanceKm: null, travelMinutes: null, isRemote: false });

  return NextResponse.json({ ...point, hqMissing: false, ...applyTravelRules(route, rules) });
}
