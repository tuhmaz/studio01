/**
 * POST /api/winter/logs/:id/correct — appends a correction to an entry.
 *
 * The original stays in the log unchanged. The correction carries the
 * corrected values, who corrected it and why; `voided: true` cancels the
 * original entirely (e.g. booked on the wrong site).
 *
 * Body: { reason, voided?, activity?, gritMaterial?, gritAmountKg?, areas?, notes?, performedAt? }
 * Requires winter.manage.
 */
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';
import { hasPermission } from '@/lib/permissions';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { WinterError, appendWinterLog, parseWork } from '@/lib/winter';
import { errorResponse, isUuid, presentLog } from '@/lib/winter-api';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'winter.manage')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });

  try {
    if (!isUuid(id)) throw new WinterError('Eintrag nicht gefunden', 404);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5 || reason.length > 500) throw new WinterError('Bitte einen Grund angeben (5–500 Zeichen)');
    const voided = body.voided === true;

    const { companyId } = session;
    const row = await withTenant(companyId, async db => {
      const [original] = await db`
        SELECT * FROM winter_service_logs WHERE id = ${id} AND company_id = ${companyId}
      `;
      if (!original) throw new WinterError('Eintrag nicht gefunden', 404);

      const pick = (key: string, fallback: unknown) => (key in body ? body[key] : fallback);
      const work = parseWork(
        {
          activity: pick('activity', original.activity),
          gritMaterial: pick('gritMaterial', original.grit_material),
          gritAmountKg: pick('gritAmountKg', original.grit_amount_kg),
          areas: pick('areas', original.areas),
          notes: pick('notes', original.notes),
          performedAt: pick('performedAt', new Date(original.performed_at).toISOString()),
        },
        new Date(),
        // A correction may fix an entry from any earlier date.
        { maxBackdateMs: Number.POSITIVE_INFINITY },
      );

      return appendWinterLog(db, {
        id: randomUUID(),
        company_id: companyId,
        job_site_id: original.job_site_id,
        site_label: original.site_label,
        employee_id: original.employee_id,
        employee_name: original.employee_name,
        entered_by: session.userId,
        entered_by_name: session.name,
        performed_at: work.performedAt,
        recorded_at: new Date(),
        activity: work.activity,
        grit_material: work.gritMaterial,
        grit_amount_kg: work.gritAmountKg,
        areas: work.areas,
        notes: work.notes,
        lat: original.lat == null ? null : Number(original.lat),
        lng: original.lng == null ? null : Number(original.lng),
        gps_accuracy_m: original.gps_accuracy_m == null ? null : Number(original.gps_accuracy_m),
        photo_media_id: original.photo_media_id,
        weather: original.weather,
        corrects_log_id: original.id,
        correction_reason: reason,
        voided,
        client_request_id: null,
      });
    });

    await writeAuditLog({
      session,
      action: voided ? 'winter.entry_voided' : 'winter.entry_corrected',
      entityType: 'winter_service_logs',
      entityId: id,
      newValue: { correctionId: row.id, reason },
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
    });
    return NextResponse.json({ data: presentLog(row) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'winter/correct');
  }
}
