/**
 * GET /api/portal/winter?siteId=…&month=YYYY-MM
 *
 * Winterdienst-Protokoll eines Objekts der eigenen Hausverwaltung für einen
 * Monat, inklusive Wetter (DWD) und Fotos, plus Prüfung der Hash-Kette:
 * zeigt, dass seit der Erfassung kein Eintrag verändert wurde.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { monthRange } from '@/lib/leistungsnachweis-types';
import { verifyWinterChain } from '@/lib/winter';
import { ACTIVITIES, MATERIALS } from '@/lib/winter-labels';
import {
  PortalError,
  portalErrorResponse,
  portalMediaUrl,
  portalShowsWorkerNames,
  portalSite,
  requirePortalSession,
} from '@/lib/portal';

export async function GET(req: NextRequest) {
  const session = await requirePortalSession(req);
  if (session instanceof NextResponse) return session;

  const siteId = req.nextUrl.searchParams.get('siteId');
  const month = req.nextUrl.searchParams.get('month') ?? '';

  try {
    const range = monthRange(month);
    if (!range) throw new PortalError('month (YYYY-MM) erforderlich');
    const result = await withTenant(session.companyId, async db => {
      const site = await portalSite(db, session, siteId);
      const showNames = await portalShowsWorkerNames(db, session.companyId);
      const rows = await db`
        SELECT l.id, l.chain_seq, l.performed_at, l.recorded_at, l.activity, l.grit_material, l.grit_amount_kg,
               l.areas, l.notes, l.weather, l.photo_media_id, l.employee_name, l.hash,
               l.corrects_log_id, l.correction_reason, l.voided,
               (SELECT c.id FROM winter_service_logs c
                 WHERE c.company_id = l.company_id AND c.corrects_log_id = l.id
                 ORDER BY c.chain_seq DESC LIMIT 1) AS superseded_by
          FROM winter_service_logs l
         WHERE l.company_id = ${session.companyId}
           AND l.job_site_id = ${site.id}
           AND l.performed_at >= (${range.first}::date AT TIME ZONE 'Europe/Berlin')
           AND l.performed_at <  (${range.next}::date AT TIME ZONE 'Europe/Berlin')
         ORDER BY l.performed_at DESC, l.chain_seq DESC
      `;
      const chain = await verifyWinterChain(db, session.companyId);
      return {
        site: { id: site.id, name: site.name, winterServiceEnabled: site.winter_service_enabled },
        month,
        chainValid: chain.valid,
        entries: rows.map(r => ({
          id: r.id,
          seq: Number(r.chain_seq),
          performedAt: r.performed_at,
          recordedAt: r.recorded_at,
          activity: r.activity,
          activityLabel: ACTIVITIES[r.activity as keyof typeof ACTIVITIES] ?? r.activity,
          material: r.grit_material ? MATERIALS[r.grit_material as keyof typeof MATERIALS] ?? r.grit_material : null,
          amountKg: r.grit_amount_kg == null ? null : Number(r.grit_amount_kg),
          areas: r.areas ?? [],
          notes: r.notes,
          weather: r.weather ?? null,
          photoUrl: r.photo_media_id ? portalMediaUrl(r.photo_media_id) : null,
          employeeName: showNames ? r.employee_name : null,
          hash: r.hash,
          isCorrection: !!r.corrects_log_id,
          correctionReason: r.correction_reason,
          voided: r.voided,
          supersededBy: r.superseded_by,
        })),
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    return portalErrorResponse(error, 'portal/winter');
  }
}
