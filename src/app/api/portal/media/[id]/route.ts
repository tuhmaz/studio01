/**
 * GET /api/portal/media/:id — Foto für das Kundenportal.
 * Nur Dateien, die an einem Objekt der eigenen Hausverwaltung hängen.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { MEDIA_UUID_RE, serveStoredFile } from '@/lib/media-response';
import { portalMediaAllowed, requirePortalSession } from '@/lib/portal';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePortalSession(req);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!MEDIA_UUID_RE.test(id)) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

  const file = await withTenant(session.companyId, async db => {
    if (!(await portalMediaAllowed(db, session, id))) return null;
    const [row] = await db`
      SELECT storage_key, content_type FROM media_files
       WHERE id = ${id} AND company_id = ${session.companyId} AND kind = 'photo'
    `;
    return row ?? null;
  });
  if (!file) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  return serveStoredFile(req, file as { storage_key: string; content_type: string });
}
