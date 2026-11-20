/**
 * POST /api/settings/hq — locates the company headquarters.
 *
 * Body: { lat, lng } to set the point directly (e.g. corrected on a map),
 * or {} to geocode the address saved in the company settings.
 * Requires settings.manage. Returns the stored point.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { geocodeAddress } from '@/lib/geo';
import { hasPermission } from '@/lib/permissions';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { writeAuditLog } from '@/lib/audit';

function isCoordinate(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'settings.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { companyId } = session;

  let point: { lat: number; lng: number; label: string | null };
  if (body && ('lat' in body || 'lng' in body)) {
    if (!isCoordinate(body.lat, 90) || !isCoordinate(body.lng, 180)) {
      return NextResponse.json({ error: 'Ungültige Koordinaten' }, { status: 400 });
    }
    point = { lat: body.lat, lng: body.lng, label: null };
  } else {
    const [company] = await withTenant(companyId, db => db`
      SELECT address, city, postal_code FROM companies WHERE id = ${companyId}
    `);
    if (!company?.city && !company?.address) {
      return NextResponse.json(
        { error: 'Bitte zuerst Straße und Stadt unter „Firmenidentität“ eintragen und speichern.' },
        { status: 400 },
      );
    }
    const hit = await geocodeAddress({ address: company.address, city: company.city, postalCode: company.postal_code });
    if (!hit) {
      return NextResponse.json({ error: 'Adresse wurde nicht gefunden. Bitte Schreibweise prüfen.' }, { status: 422 });
    }
    point = hit;
  }

  const [before] = await withTenant(companyId, db => db`
    SELECT hq_lat, hq_lng FROM companies WHERE id = ${companyId}
  `);
  await withTenant(companyId, db => db`
    UPDATE companies SET hq_lat = ${point.lat}, hq_lng = ${point.lng} WHERE id = ${companyId}
  `);
  await writeAuditLog({
    session,
    action: 'company.hq_updated',
    entityType: 'companies',
    entityId: companyId,
    oldValue: before ?? null,
    newValue: { hq_lat: point.lat, hq_lng: point.lng },
    ipAddress: getRequestIp(req),
    userAgent: getUserAgent(req),
  });

  return NextResponse.json({ lat: point.lat, lng: point.lng, label: point.label });
}
