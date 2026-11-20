/**
 * Mängelmeldungen aus dem Kundenportal — interne Bearbeitung (clients.manage).
 *
 * GET   /api/defects[?open=1]  — alle Meldungen mit Objekt, Hausverwaltung, Tourplan-Status
 * PATCH /api/defects           — { id, status?, response? }
 *        status: open | scheduled | done | rejected; response: Antwort an die Hausverwaltung
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { writeAuditLog } from '@/lib/audit';
import {
  DEFECT_STATUS_LABELS,
  PortalError,
  cleanText,
  effectiveDefectStatus,
  portalErrorResponse,
  type DefectStatus,
} from '@/lib/portal';

const STATUSES = new Set<DefectStatus>(['open', 'scheduled', 'done', 'rejected']);

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'clients.manage')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  const onlyOpen = req.nextUrl.searchParams.get('open') === '1';

  try {
    const rows = await withTenant(session.companyId, db => db`
      SELECT d.*, s.name AS site_name, s.address AS site_address, c.name AS client_name,
             a.status AS assignment_status, a.is_plan_published AS assignment_published,
             to_char(a.scheduled_date, 'YYYY-MM-DD') AS planned_date
        FROM defect_reports d
        JOIN job_sites s ON s.id = d.job_site_id
        JOIN clients c ON c.id = d.client_id
        LEFT JOIN job_assignments a ON a.id = d.job_assignment_id
       WHERE d.company_id = ${session.companyId}
       ORDER BY d.created_at DESC
       LIMIT 500
    `);
    const data = rows
      .map(r => {
        const status = effectiveDefectStatus(r.status, r.assignment_status == null ? null : {
          status: r.assignment_status, is_plan_published: r.assignment_published,
        });
        return {
          id: r.id,
          siteId: r.job_site_id,
          siteName: r.site_name,
          siteAddress: r.site_address,
          clientId: r.client_id,
          clientName: r.client_name,
          title: r.title,
          description: r.description,
          photoUrl: r.photo_media_id ? `/api/media/${r.photo_media_id}` : null,
          status,
          statusLabel: DEFECT_STATUS_LABELS[status],
          storedStatus: r.status,
          response: r.response,
          reportedByName: r.reported_by_name,
          jobAssignmentId: r.job_assignment_id,
          assignmentStatus: r.assignment_status,
          assignmentPublished: !!r.assignment_published,
          plannedDate: r.planned_date,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      })
      .filter(d => !onlyOpen || d.status === 'open' || d.status === 'scheduled');
    return NextResponse.json({ data });
  } catch (error) {
    return portalErrorResponse(error, 'defects GET');
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'clients.manage')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });

  try {
    const body = await req.json().catch(() => { throw new PortalError('Ungültige Anfrage'); });
    if (typeof body.id !== 'string') throw new PortalError('id fehlt');
    const status = body.status === undefined ? undefined : String(body.status) as DefectStatus;
    if (status !== undefined && !STATUSES.has(status)) throw new PortalError('Ungültiger Status');
    const hasResponse = Object.prototype.hasOwnProperty.call(body, 'response');
    const response = hasResponse ? cleanText(body.response, 4000) : undefined;
    if (status === 'rejected' && !response) throw new PortalError('Bitte der Hausverwaltung kurz begründen, warum abgelehnt wird.');

    const row = await withTenant(session.companyId, async db => {
      const [updated] = await db`
        UPDATE defect_reports
           SET status = coalesce(${status ?? null}, status),
               response = ${hasResponse ? db`${response ?? null}` : db`response`},
               updated_at = now()
         WHERE id::text = ${body.id} AND company_id = ${session.companyId}
        RETURNING id, status, response
      `;
      return updated ?? null;
    });
    if (!row) throw new PortalError('Meldung nicht gefunden', 404);
    await writeAuditLog({
      session, action: 'defect.updated', entityType: 'defect_reports', entityId: row.id,
      newValue: { status: row.status, response: row.response },
      ipAddress: getRequestIp(req), userAgent: getUserAgent(req),
    });
    return NextResponse.json({ data: row });
  } catch (error) {
    return portalErrorResponse(error, 'defects PATCH');
  }
}
