import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth-server';
import sql from '@/lib/db';

/**
 * POST /api/geocode
 * Geocodes job sites without lat/lng using Nominatim (OpenStreetMap).
 * Stores results back in the database.
 * Body: { siteIds?: string[] }  — if omitted, processes all sites for the company.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });

  const { siteIds } = await req.json().catch(() => ({}));

  // Fetch sites that need geocoding
  let sites;
  if (siteIds?.length) {
    sites = await sql`
      SELECT id, address, city, postal_code, lat, lng
      FROM public.job_sites
      WHERE company_id = ${session.companyId}
        AND id = ANY(${siteIds}::text[])
        AND (lat IS NULL OR lng IS NULL)
    `;
  } else {
    sites = await sql`
      SELECT id, address, city, postal_code, lat, lng
      FROM public.job_sites
      WHERE company_id = ${session.companyId}
        AND (lat IS NULL OR lng IS NULL)
    `;
  }

  if (!sites.length) {
    return NextResponse.json({ geocoded: 0, message: 'Alle Standorte haben bereits Koordinaten.' });
  }

  let geocoded = 0;
  const results: Array<{ id: string; lat: number; lng: number; address: string }> = [];

  for (const site of sites) {
    try {
      // Try progressively looser queries until one returns a result
      const queries = [
        [site.address, site.city, site.postal_code, 'Deutschland'].filter(Boolean).join(', '),
        [site.address, site.city, 'Deutschland'].filter(Boolean).join(', '),
        // Strip trailing letters/suffixes from city (e.g. "Salzgitter Z" → "Salzgitter")
        [site.address, site.city.replace(/\s+[A-Z]$/i, '').trim(), 'Deutschland'].filter(Boolean).join(', '),
        [site.city.replace(/\s+[A-Z]$/i, '').trim(), 'Deutschland'].filter(Boolean).join(', '),
      ];

      let lat = 0, lng = 0, found = false;

      for (const query of queries) {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=de`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'HausmeisterPro/1.0 (contact@tuhmaz.de)',
            'Accept-Language': 'de',
          },
        });
        if (!res.ok) { await new Promise(r => setTimeout(r, 1100)); continue; }
        const data = await res.json();
        if (data.length) {
          lat = parseFloat(data[0].lat);
          lng = parseFloat(data[0].lon);
          found = true;
          break;
        }
        await new Promise(r => setTimeout(r, 1100));
      }

      if (!found) continue;

      // ─── OSRM Distanz- & Fahrtzeitberechnung ───
      let distanceKm = 0;
      let travelTimeMinutes = 0;
      let isRemote = false;

      try {
        const hqLat = 52.0189651;
        const hqLng = 11.7265854;
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${hqLng},${hqLat};${lng},${lat}?overview=false`;
        const osrmRes = await fetch(osrmUrl);
        const osrmData = await osrmRes.json();

        if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
          const distanceMeters = osrmData.routes[0].distance;
          const durationSeconds = osrmData.routes[0].duration;

          distanceKm = parseFloat((distanceMeters / 1000).toFixed(1));
          travelTimeMinutes = Math.round(durationSeconds / 60);

          if (distanceKm > 95) {
            isRemote = true;
            travelTimeMinutes += 60; // +1 Std. bei > 95km
          }
        }
      } catch (e) {
        console.error(`OSRM route calc failed for site ${site.id}`, e);
      }

      await sql`
        UPDATE public.job_sites
        SET lat = ${lat}, 
            lng = ${lng},
            distance_from_hq = ${distanceKm},
            travel_time_from_hq = ${travelTimeMinutes},
            estimated_travel_time_minutes_from_hq = ${travelTimeMinutes},
            is_remote = ${isRemote}
        WHERE id = ${site.id}
      `;

      results.push({ id: site.id, lat, lng, address: site.address });
      geocoded++;

      // Nominatim rate limit: max 1 req/sec
      await new Promise(r => setTimeout(r, 1100));
    } catch {
      // Skip failed sites, continue with the rest
    }
  }

  return NextResponse.json({ geocoded, results });
}
