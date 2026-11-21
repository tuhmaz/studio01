/**
 * GET /api/media/:id — serves one stored photo or voice note.
 *
 * Same authentication as the rest of the API (session cookie or Bearer token).
 * The file must belong to the caller's company; workers may only open files
 * they uploaded themselves, matching what /api/data lets them see.
 * Portal logins (Hausverwaltung) use /api/portal/media/:id instead.
 *
 * S3 storage answers with a redirect to a short-lived signed URL; local
 * storage streams the bytes. `?download=<name>` asks for an attachment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission, normalizeRole } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { MEDIA_UUID_RE, serveStoredFile } from '@/lib/media-response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.view')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const { id } = await params;
  if (!MEDIA_UUID_RE.test(id)) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

  const isWorker = normalizeRole(session.role) === 'WORKER';
  const [file] = await withTenant(session.companyId, db => db`
    SELECT storage_key, content_type, size_bytes
      FROM media_files
     WHERE id = ${id}
       AND company_id = ${session.companyId}
       ${isWorker ? db`AND created_by = ${session.userId}` : db``}
     LIMIT 1
  `);
  // Same answer for "missing" and "not yours": never confirm another tenant's ids.
  if (!file) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

  return serveStoredFile(req, file as { storage_key: string; content_type: string });
}
