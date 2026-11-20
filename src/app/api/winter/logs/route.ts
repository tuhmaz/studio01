/**
 * Winterdienst log.
 *
 * GET  /api/winter/logs?siteId=&from=&to=  — entries, newest first (workers: own only)
 * POST /api/winter/logs                    — record one clearing/gritting run
 *
 * POST body: { siteId, activity, gritMaterial?, gritAmountKg?, areas?, notes?,
 *              performedAt?, lat?, lng?, gpsAccuracyM?, photo? (data URL),
 *              clientRequestId? (uuid; repeating it returns the stored entry) }
 */
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { mediaIdFromUrl, storeDataUrl } from '@/lib/media';
import { hasPermission, normalizeRole } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { WinterError, appendWinterLog, fetchWeather, parseWork } from '@/lib/winter';
import { errorResponse, optionalCoordinate, optionalUuid, presentLog } from '@/lib/winter-api';
import { completeWinterTask } from '@/lib/winter-plan';

const MAX_LIST = 2000;

function parseDate(value: string | null, label: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new WinterError(`Ungültiges Datum: ${label}`);
  return date;
}

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.view')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  try {
    const params = req.nextUrl.searchParams;
    const siteId = params.get('siteId');
    const from = parseDate(params.get('from'), 'from');
    const to = parseDate(params.get('to'), 'to');
    const ownOnly = normalizeRole(session.role) === 'WORKER';

    const rows = await withTenant(session.companyId, db => db`
      SELECT l.*,
             (SELECT c.id FROM winter_service_logs c
               WHERE c.corrects_log_id = l.id ORDER BY c.chain_seq DESC LIMIT 1) AS superseded_by
        FROM winter_service_logs l
       WHERE l.company_id = ${session.companyId}
         ${siteId ? db`AND l.job_site_id = ${siteId}` : db``}
         ${from ? db`AND l.performed_at >= ${from}` : db``}
         ${to ? db`AND l.performed_at <= ${to}` : db``}
         ${ownOnly ? db`AND l.employee_id = ${session.userId}` : db``}
       ORDER BY l.performed_at DESC, l.chain_seq DESC
       LIMIT ${MAX_LIST}
    `);
    return NextResponse.json({ data: rows.map(presentLog) });
  } catch (error) {
    return errorResponse(error, 'winter/logs GET');
  }
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.create')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });

  try {
    const { companyId } = session;
    const work = parseWork(body);
    const clientRequestId = optionalUuid(body.clientRequestId, 'Anfrage-ID');
    const lat = optionalCoordinate(body.lat, 90);
    const lng = optionalCoordinate(body.lng, 180);
    const gpsAccuracy = body.gpsAccuracyM == null ? null : Math.max(0, Math.round(Number(body.gpsAccuracyM) || 0));
    if ((lat == null) !== (lng == null)) throw new WinterError('Ungültige GPS-Position');
    if (body.photo != null && typeof body.photo !== 'string') throw new WinterError('Ungültiges Foto');
    if (typeof body.siteId !== 'string' || !body.siteId) throw new WinterError('Bitte das Objekt wählen');

    // An app retrying after a lost response gets the entry it already created.
    if (clientRequestId) {
      const [existing] = await withTenant(companyId, db => db`
        SELECT * FROM winter_service_logs WHERE company_id = ${companyId} AND client_request_id = ${clientRequestId}
      `);
      if (existing) return NextResponse.json({ data: presentLog(existing), duplicate: true }, { status: 200 });
    }

    const [site] = await withTenant(companyId, db => db`
      SELECT id, name, address, city, lat, lng, winter_service_enabled
        FROM job_sites WHERE id = ${body.siteId} AND company_id = ${companyId}
    `);
    if (!site) throw new WinterError('Objekt nicht gefunden', 404);
    if (!site.winter_service_enabled) throw new WinterError('Für dieses Objekt ist kein Winterdienst eingerichtet');

    // Weather first (network), outside the transaction.
    const wLat = lat ?? (site.lat == null ? null : Number(site.lat));
    const wLng = lng ?? (site.lng == null ? null : Number(site.lng));
    const weather = wLat != null && wLng != null ? await fetchWeather(wLat, wLng, work.performedAt) : null;

    const row = await withTenant(companyId, async db => {
      const photoMediaId = body.photo
        ? mediaIdFromUrl(await storeDataUrl(db, { companyId, userId: session.userId, kind: 'photo', dataUrl: body.photo }))
        : null;
      const entry = await appendWinterLog(db, {
        id: randomUUID(),
        company_id: companyId,
        job_site_id: site.id,
        site_label: [site.name, [site.address, site.city].filter(Boolean).join(', ')].filter(Boolean).join(' — '),
        employee_id: session.userId,
        employee_name: session.name,
        entered_by: session.userId,
        entered_by_name: session.name,
        performed_at: work.performedAt,
        recorded_at: new Date(),
        activity: work.activity,
        grit_material: work.gritMaterial,
        grit_amount_kg: work.gritAmountKg,
        areas: work.areas,
        notes: work.notes,
        lat,
        lng,
        gps_accuracy_m: gpsAccuracy,
        photo_media_id: photoMediaId,
        weather,
        corrects_log_id: null,
        correction_reason: null,
        voided: false,
        client_request_id: clientRequestId,
      });
      // The day's Winterdienst task in the Tourplan is done.
      await completeWinterTask(db, companyId, site.id, work.performedAt);
      return entry;
    });
    return NextResponse.json({ data: presentLog(row) }, { status: 201 });
  } catch (error) {
    // Two retries racing on the same clientRequestId: return the winner.
    if ((error as { code?: string }).code === '23505' && body.clientRequestId) {
      const [existing] = await withTenant(session.companyId, db => db`
        SELECT * FROM winter_service_logs
         WHERE company_id = ${session.companyId} AND client_request_id = ${String(body.clientRequestId).toLowerCase()}
      `);
      if (existing) return NextResponse.json({ data: presentLog(existing), duplicate: true }, { status: 200 });
    }
    return errorResponse(error, 'winter/logs POST');
  }
}
