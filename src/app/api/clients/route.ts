/**
 * Hausverwaltungen (Kunden) verwalten — für ADMIN/MANAGER (clients.manage).
 *
 * GET    /api/clients            — Liste mit Objekten, Portal-Zugängen, offenen Mängeln
 *                                   + alle Objekte der Firma (für die Zuordnung)
 * POST   /api/clients            — { name, contactName?, email?, phone?, address?, notes?, siteIds? }
 * PATCH  /api/clients            — { id, …Felder, siteIds? } (siteIds ersetzt die Zuordnung)
 * DELETE /api/clients?id=…       — löscht Hausverwaltung, ihre Zugänge und Meldungen;
 *                                   Objekte bleiben, nur ohne Zuordnung
 */
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenant, type Db } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { getRequestIp, getRequestSession, getUserAgent } from '@/lib/request-context';
import { writeAuditLog } from '@/lib/audit';
import { PortalError, portalErrorResponse } from '@/lib/portal';
import { parseClientInput, parseSiteIds } from '@/lib/clients';
import type { SessionPayload } from '@/lib/auth-server';

async function authorize(req: NextRequest): Promise<SessionPayload | NextResponse> {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'clients.manage')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  return session;
}

async function assignSites(db: Db, companyId: string, clientId: string, siteIds: string[]) {
  await db`
    UPDATE job_sites SET client_id = NULL
     WHERE company_id = ${companyId} AND client_id = ${clientId}
       AND NOT (id = ANY(${db.array(siteIds)}::text[]))
  `;
  if (siteIds.length) {
    await db`
      UPDATE job_sites SET client_id = ${clientId}
       WHERE company_id = ${companyId} AND id = ANY(${db.array(siteIds)}::text[])
    `;
  }
}

export async function GET(req: NextRequest) {
  const session = await authorize(req);
  if (session instanceof NextResponse) return session;
  const { companyId } = session;

  try {
    const result = await withTenant(companyId, async db => {
      const clients = await db`
        SELECT c.*,
               coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'city', s.city) ORDER BY s.name)
                           FROM job_sites s WHERE s.company_id = c.company_id AND s.client_id = c.id), '[]') AS sites,
               coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'lastLogin', u.last_login)
                                         ORDER BY u.name)
                           FROM users u WHERE u.company_id = c.company_id AND u.client_id = c.id AND u.role = 'CLIENT'), '[]') AS logins,
               (SELECT count(*)::int FROM defect_reports d
                  LEFT JOIN job_assignments a ON a.id = d.job_assignment_id
                 WHERE d.company_id = c.company_id AND d.client_id = c.id
                   AND d.status NOT IN ('done', 'rejected') AND coalesce(a.status, '') <> 'COMPLETED') AS open_defects
          FROM clients c
         WHERE c.company_id = ${companyId}
         ORDER BY c.name
      `;
      const sites = await db`
        SELECT id, name, city, client_id FROM job_sites WHERE company_id = ${companyId} ORDER BY name
      `;
      const [company] = await db`SELECT portal_show_worker_names FROM companies WHERE id = ${companyId}`;
      return {
        clients: clients.map(c => ({
          id: c.id,
          name: c.name,
          contactName: c.contact_name,
          email: c.email,
          phone: c.phone,
          address: c.address,
          notes: c.notes,
          sites: c.sites,
          logins: c.logins,
          openDefects: c.open_defects,
          createdAt: c.created_at,
        })),
        sites: sites.map(s => ({ id: s.id, name: s.name, city: s.city, clientId: s.client_id })),
        portalShowWorkerNames: !!company?.portal_show_worker_names,
        canManageLogins: hasPermission(session, 'users.create'),
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    return portalErrorResponse(error, 'clients GET');
  }
}

export async function POST(req: NextRequest) {
  const session = await authorize(req);
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json().catch(() => { throw new PortalError('Ungültige Anfrage'); });
    const input = parseClientInput(body);
    const siteIds = parseSiteIds(body.siteIds) ?? [];
    const id = `client-${randomUUID()}`;
    await withTenant(session.companyId, async db => {
      await db`
        INSERT INTO clients (id, company_id, name, contact_name, email, phone, address, notes)
        VALUES (${id}, ${session.companyId}, ${input.name}, ${input.contactName}, ${input.email},
                ${input.phone}, ${input.address}, ${input.notes})
      `;
      await assignSites(db, session.companyId, id, siteIds);
    });
    await writeAuditLog({
      session, action: 'client.created', entityType: 'clients', entityId: id,
      newValue: { name: input.name, sites: siteIds.length },
      ipAddress: getRequestIp(req), userAgent: getUserAgent(req),
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return portalErrorResponse(error, 'clients POST');
  }
}

export async function PATCH(req: NextRequest) {
  const session = await authorize(req);
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json().catch(() => { throw new PortalError('Ungültige Anfrage'); });
    if (typeof body.id !== 'string') throw new PortalError('id fehlt');
    const input = parseClientInput(body);
    const siteIds = parseSiteIds(body.siteIds);
    const updated = await withTenant(session.companyId, async db => {
      const rows = await db`
        UPDATE clients
           SET name = ${input.name}, contact_name = ${input.contactName}, email = ${input.email},
               phone = ${input.phone}, address = ${input.address}, notes = ${input.notes}
         WHERE id = ${body.id} AND company_id = ${session.companyId}
        RETURNING id
      `;
      if (!rows.length) return false;
      if (siteIds) await assignSites(db, session.companyId, body.id, siteIds);
      return true;
    });
    if (!updated) throw new PortalError('Hausverwaltung nicht gefunden', 404);
    await writeAuditLog({
      session, action: 'client.updated', entityType: 'clients', entityId: body.id,
      newValue: { name: input.name, sites: siteIds?.length },
      ipAddress: getRequestIp(req), userAgent: getUserAgent(req),
    });
    return NextResponse.json({ id: body.id });
  } catch (error) {
    return portalErrorResponse(error, 'clients PATCH');
  }
}

export async function DELETE(req: NextRequest) {
  const session = await authorize(req);
  if (session instanceof NextResponse) return session;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id fehlt' }, { status: 400 });

  try {
    const deleted = await withTenant(session.companyId, async db => {
      const rows = await db`DELETE FROM clients WHERE id = ${id} AND company_id = ${session.companyId} RETURNING name`;
      return rows[0] ?? null;
    });
    if (!deleted) throw new PortalError('Hausverwaltung nicht gefunden', 404);
    await writeAuditLog({
      session, action: 'client.deleted', entityType: 'clients', entityId: id,
      oldValue: { name: deleted.name },
      ipAddress: getRequestIp(req), userAgent: getUserAgent(req),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return portalErrorResponse(error, 'clients DELETE');
  }
}
