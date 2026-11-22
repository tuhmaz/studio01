/**
 * Mängelmeldungen der Hausverwaltung.
 *
 * GET  /api/portal/defects[?siteId=…]  — eigene Meldungen mit aktuellem Status
 * POST /api/portal/defects             — { siteId, title, description?, photo? (data URL) }
 *
 * Jede neue Meldung legt im Tourplan einen (noch unveröffentlichten) Auftrag
 * für heute an. Sobald der Dienstleister ihn veröffentlicht, sieht der Kunde
 * "Eingeplant", nach Abschluss "Erledigt".
 */
import { randomUUID } from 'node:crypto';
import { createNotifications, officeUserIds, scheduleDelivery } from '@/lib/notifications';
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { isDataUrl, mediaIdFromUrl, storeDataUrl } from '@/lib/media';
import { writeAuditLog } from '@/lib/audit';
import { getRequestIp, getUserAgent } from '@/lib/request-context';
import { DEFECT_CATEGORY } from '@/lib/services';
import {
  DEFECT_STATUS_LABELS,
  PortalError,
  berlinToday,
  cleanText,
  effectiveDefectStatus,
  portalErrorResponse,
  portalMediaUrl,
  portalSite,
  requirePortalSession,
  type DefectStatus,
} from '@/lib/portal';

function present(row: Record<string, any>) {
  const status = effectiveDefectStatus(row.status as DefectStatus, row.assignment_status == null ? null : {
    status: row.assignment_status,
    is_plan_published: row.assignment_published,
  });
  return {
    id: row.id,
    siteId: row.job_site_id,
    siteName: row.site_name,
    title: row.title,
    description: row.description,
    photoUrl: row.photo_media_id ? portalMediaUrl(row.photo_media_id) : null,
    status,
    statusLabel: DEFECT_STATUS_LABELS[status],
    plannedDate: row.assignment_published ? row.planned_date : null,
    response: row.response,
    reportedByName: row.reported_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const session = await requirePortalSession(req);
  if (session instanceof NextResponse) return session;
  const siteId = req.nextUrl.searchParams.get('siteId');

  try {
    const rows = await withTenant(session.companyId, db => db`
      SELECT d.*, s.name AS site_name,
             a.status AS assignment_status, a.is_plan_published AS assignment_published,
             to_char(a.scheduled_date, 'YYYY-MM-DD') AS planned_date
        FROM defect_reports d
        JOIN job_sites s ON s.id = d.job_site_id
        LEFT JOIN job_assignments a ON a.id = d.job_assignment_id
       WHERE d.company_id = ${session.companyId}
         AND d.client_id = ${session.clientId}
         AND s.client_id = ${session.clientId}
         ${siteId ? db`AND d.job_site_id = ${siteId}` : db``}
       ORDER BY d.created_at DESC
       LIMIT 200
    `);
    return NextResponse.json({ data: rows.map(present) });
  } catch (error) {
    return portalErrorResponse(error, 'portal/defects GET');
  }
}

export async function POST(req: NextRequest) {
  const session = await requirePortalSession(req);
  if (session instanceof NextResponse) return session;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }

  try {
    const title = cleanText(body.title, 200);
    if (!title) throw new PortalError('Bitte kurz beschreiben, was nicht in Ordnung ist.');
    const description = cleanText(body.description, 4000);
    if (body.photo != null && !isDataUrl(body.photo)) throw new PortalError('Ungültiges Foto');

    const created: Record<string, any> = await withTenant(session.companyId, async db => {
      const site = await portalSite(db, session, body.siteId);
      const photoMediaId = body.photo
        ? mediaIdFromUrl(await storeDataUrl(db, {
            companyId: session.companyId,
            userId: session.userId,
            kind: 'photo',
            dataUrl: body.photo as string,
          }))
        : null;

      // Auftrag im Tourplan: heute, unveröffentlicht, noch ohne Team.
      const assignmentId = `mangel-${randomUUID()}`;
      await db`
        INSERT INTO job_assignments (id, company_id, job_site_id, title, scheduled_date, status,
                                     assigned_worker_ids, categories, is_plan_published)
        VALUES (${assignmentId}, ${session.companyId}, ${site.id}, ${`Mängelmeldung: ${title}`.slice(0, 250)},
                ${berlinToday()}, 'PENDING', '{}', ${db.array([DEFECT_CATEGORY])}, false)
      `;
      const [row] = await db`
        INSERT INTO defect_reports (company_id, client_id, job_site_id, title, description, photo_media_id,
                                    job_assignment_id, reported_by, reported_by_name)
        VALUES (${session.companyId}, ${session.clientId}, ${site.id}, ${title}, ${description}, ${photoMediaId},
                ${assignmentId}, ${session.userId}, ${session.name})
        RETURNING *
      `;
      // Büro (Verwaltung) informieren.
      const [client] = await db`SELECT name FROM clients WHERE id = ${session.clientId} AND company_id = ${session.companyId}`;
      const office = await officeUserIds(db, session.companyId);
      await createNotifications(db, session.companyId, office.map(userId => ({
        userId,
        kind: 'defect.new' as const,
        data: { site: site.name, client: client?.name ?? session.name, text: title },
        link: '/kunden',
      })));
      if (office.length) scheduleDelivery();
      return { ...(row as Record<string, any>), site_name: site.name, assignment_status: 'PENDING', assignment_published: false, planned_date: null };
    });

    await writeAuditLog({
      session,
      action: 'defect.reported',
      entityType: 'defect_reports',
      entityId: created.id,
      newValue: { siteId: created.job_site_id, title: created.title },
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return NextResponse.json({ data: present(created) }, { status: 201 });
  } catch (error) {
    return portalErrorResponse(error, 'portal/defects POST');
  }
}
