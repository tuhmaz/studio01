/**
 * Antwort für eine gespeicherte Datei (Foto/Sprachnachricht): S3 → Redirect auf
 * eine kurzlebige signierte URL, lokal → Bytes mit Range-Unterstützung.
 * Die Berechtigungsprüfung macht die aufrufende Route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { parseRange } from '@/lib/http-range';

const SIGNED_URL_TTL_SECONDS = 300;

export const MEDIA_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function safeFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^\w.-]+/g, '_').slice(0, 100);
  return cleaned || undefined;
}

export interface StoredFile {
  storage_key: string;
  content_type: string;
}

export async function serveStoredFile(req: NextRequest, file: StoredFile): Promise<NextResponse> {
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
