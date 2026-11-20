/**
 * Geocoding (OpenStreetMap Nominatim) and driving routes (OSRM).
 *
 * Both are free public services with fair-use limits: Nominatim allows one
 * request per second and requires an identifying User-Agent. Callers that
 * loop must wait NOMINATIM_DELAY_MS between requests.
 */

export const NOMINATIM_DELAY_MS = 1100;

const USER_AGENT = process.env.GEOCODER_USER_AGENT || 'HausmeisterPro/1.0 (contact@tuhmaz.de)';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CompanyTravelRules {
  hq: GeoPoint | null;
  remoteThresholdKm: number;
  remoteBonusMinutes: number;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Looks up one free-text address. Returns null when nothing is found. */
export async function geocode(query: string): Promise<(GeoPoint & { label: string }) | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=de`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const lat = Number.parseFloat(data[0].lat);
  const lng = Number.parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: String(data[0].display_name ?? query) };
}

/**
 * Tries progressively looser forms of an address (full, without postcode,
 * city without a trailing district letter, city only) until one is found.
 */
export async function geocodeAddress(parts: { address?: string | null; city?: string | null; postalCode?: string | null }) {
  const city = (parts.city ?? '').trim();
  const bareCity = city.replace(/\s+[A-Z]$/i, '').trim();
  const queries = [
    [parts.address, city, parts.postalCode, 'Deutschland'],
    [parts.address, city, 'Deutschland'],
    [parts.address, bareCity, 'Deutschland'],
    [bareCity, 'Deutschland'],
  ]
    .map(q => q.filter(Boolean).join(', '))
    .filter((q, i, all) => q && q !== 'Deutschland' && all.indexOf(q) === i);

  for (const [i, query] of queries.entries()) {
    if (i > 0) await sleep(NOMINATIM_DELAY_MS);
    const hit = await geocode(query);
    if (hit) return hit;
  }
  return null;
}

/** Driving distance (km) and time (min) between two points, or null if no route. */
export async function drivingRoute(from: GeoPoint, to: GeoPoint): Promise<{ km: number; minutes: number } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data?.code !== 'Ok' || !route) return null;
    return { km: Number((route.distance / 1000).toFixed(1)), minutes: Math.round(route.duration / 60) };
  } catch {
    return null;
  }
}

/**
 * Applies a company's travel rules to a route: sites beyond the threshold
 * count as remote and get the configured extra minutes.
 */
export function applyTravelRules(route: { km: number; minutes: number }, rules: CompanyTravelRules) {
  const isRemote = rules.remoteThresholdKm > 0 && route.km > rules.remoteThresholdKm;
  return {
    distanceKm: route.km,
    travelMinutes: route.minutes + (isRemote ? rules.remoteBonusMinutes : 0),
    isRemote,
  };
}

export function travelRulesFromCompany(row: {
  hq_lat?: unknown; hq_lng?: unknown; remote_threshold_km?: unknown; remote_bonus_minutes?: unknown;
} | undefined): CompanyTravelRules {
  const lat = row?.hq_lat == null ? NaN : Number(row.hq_lat);
  const lng = row?.hq_lng == null ? NaN : Number(row.hq_lng);
  return {
    hq: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    remoteThresholdKm: Number(row?.remote_threshold_km ?? 95),
    remoteBonusMinutes: Number(row?.remote_bonus_minutes ?? 60),
  };
}
