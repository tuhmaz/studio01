/**
 * GET /api/media/:id — serves one stored photo or voice note.
 *
 * Same authentication as the rest of the API (session cookie or Bearer token).
 * The file must belong to the caller's company; workers may only open files
 * they uploaded themselves, matching what /api/data lets them see.
 *
 * S3 storage answers with a redirect to a short-lived signed URL; local
 * storage streams the bytes. `?download=<name>` asks for an attachment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenant } from '@/lib/db';
import { hasPermission, normalizeRole } from '@/lib/permissions';
import { getRequestSession } from '@/lib/request-context';
import { getStorage } from '@/lib/storage';
import { parseRange } from '@/lib/http-range';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIGNED_URL_TTL_SECONDS = 300;

function safeFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^\w.-]+/g, '_').slice(0, 100);
  return cleaned || undefined;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  if (!hasPermission(session, 'work_logs.view')) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

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

  const downloadName = safeFilename(req.nextUrl.searchParams.get('download'));
  const storage = getStorage();

  const signed = await storage.signedUrl(file.storage_key, SIGNED_URL_TTL_SECONDS, downloadName);
  if (signed) {
    return NextResponse.redirect(signed, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const object = await storage.get(file.storage_key);
  if (!object) return NextResponse.json({ error: 'Datei fehlt im Speicher' }, { status: 404 });

  const headers: Record<string, string> = {
    // Stored type was detected from the file's bytes on upload, not taken from the client.
    'Content-Type': file.content_type,
    'Content-Disposition': downloadName ? `attachment; filename="${downloadName}"` : 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    // Files never change once stored; let the browser keep them for the session.
    'Cache-Control': 'private, max-age=86400, immutable',
  };

  // Audio players (Safari in particular) fetch byte ranges to seek and to start playing.
  const range = parseRange(req.headers.get('range'), object.body.length);
  if (range === 'invalid') {
    return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${object.body.length}` } });
  }
  if (range) {
    const chunk = object.body.subarray(range.start, range.end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${object.body.length}`,
        'Content-Length': String(chunk.length),
      },
    });
  }

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(object.body.length) },
  });
}
