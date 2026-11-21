/**
 * Photos and voice notes: validation and storage.
 *
 * Clients (web and every installed mobile app version) still send media as
 * data URLs inside work_log_entries.content. The API turns each one into a
 * stored file plus a media_files row and keeps only a short reference in the
 * database: "/api/media/<uuid>". Web pages can use that URL directly in
 * <img>/<audio>; the mobile app adds its Bearer token.
 *
 * The file type is decided from the bytes themselves (magic numbers), never
 * from what the client declares, so nothing but real images and audio can be
 * stored and later served from the app's own origin.
 */
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '@/lib/db';
import { getStorage } from '@/lib/storage';

export type MediaKind = 'photo' | 'voice';

export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

export const MEDIA_URL_PREFIX = '/api/media/';
const MEDIA_URL_RE = /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

interface Detected {
  contentType: string;
  ext: string;
  kind: MediaKind;
}

function startsWith(buf: Buffer, bytes: number[], offset = 0) {
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Buffer, start: number, end: number) {
  return buf.subarray(start, end).toString('latin1');
}

/** Identifies the allowed image and audio formats by their leading bytes. */
export function detectMedia(buf: Buffer): Detected | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', ext: 'jpg', kind: 'photo' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: 'image/png', ext: 'png', kind: 'photo' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { contentType: 'image/webp', ext: 'webp', kind: 'photo' };
  if (ascii(buf, 0, 4) === 'GIF8') return { contentType: 'image/gif', ext: 'gif', kind: 'photo' };

  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { contentType: 'audio/webm', ext: 'webm', kind: 'voice' };
  if (ascii(buf, 0, 4) === 'OggS') return { contentType: 'audio/ogg', ext: 'ogg', kind: 'voice' };
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12);
    // 3GPP recordings (older Android) vs. MP4/M4A (iOS, newer Android, Safari).
    if (brand.startsWith('3g')) return { contentType: 'audio/3gpp', ext: '3gp', kind: 'voice' };
    return { contentType: 'audio/mp4', ext: 'm4a', kind: 'voice' };
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WAVE') return { contentType: 'audio/wav', ext: 'wav', kind: 'voice' };
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { contentType: 'audio/mpeg', ext: 'mp3', kind: 'voice' };
  if (ascii(buf, 0, 4) === '#!AM') return { contentType: 'audio/amr', ext: 'amr', kind: 'voice' };
  return null;
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

export function mediaIdFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return MEDIA_URL_RE.exec(value)?.[1] ?? null;
}

/** Decodes a base64 data URL. Throws MediaError for anything else. */
export function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) {
    throw new MediaError('Ungültige Mediendaten');
  }
  const base64 = dataUrl.slice(comma + 1);
  // Reject before decoding: base64 is 4/3 the size of the bytes it carries.
  if (base64.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 4) {
    throw new MediaError('Datei zu groß (max. 15 MB)');
  }
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new MediaError('Ungültige Mediendaten');
  if (buf.length > MAX_MEDIA_BYTES) throw new MediaError('Datei zu groß (max. 15 MB)');
  return buf;
}

export interface StoreMediaInput {
  companyId: string;
  userId: string | null;
  /** The kind the caller expects; the bytes must match it. */
  kind: MediaKind;
  dataUrl: string;
}

/** Validates and stores one data URL. Returns the "/api/media/<id>" reference. */
export async function storeDataUrl(db: Db, input: StoreMediaInput): Promise<string> {
  const buf = decodeDataUrl(input.dataUrl);
  const detected = detectMedia(buf);
  if (!detected || detected.kind !== input.kind) {
    throw new MediaError(input.kind === 'photo' ? 'Nur JPEG-, PNG-, WebP- oder GIF-Bilder erlaubt' : 'Ungültiges Audioformat');
  }

  const id = randomUUID();
  const now = new Date();
  const key = `${input.companyId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${detected.ext}`;
  const sha256 = createHash('sha256').update(buf).digest('hex');

  await getStorage().put(key, buf, detected.contentType);
  await db`
    INSERT INTO media_files (id, company_id, kind, content_type, size_bytes, sha256, storage_key, created_by)
    VALUES (${id}, ${input.companyId}, ${detected.kind}, ${detected.contentType}, ${buf.length}, ${sha256}, ${key}, ${input.userId})
  `;
  return `${MEDIA_URL_PREFIX}${id}`;
}

/**
 * For work_log_entries writes: replaces photo/voice data URLs in `content`
 * with stored-file references. Text notes and existing references pass through.
 */
export async function externalizeWorkLogMedia(
  db: Db,
  rows: Record<string, unknown>[],
  session: { companyId: string; userId: string },
): Promise<void> {
  for (const row of rows) {
    if (!isDataUrl(row.content)) continue;
    const declared = row.type;
    if (declared === 'text') continue;
    // An update may omit `type`; then the data URL's own media type decides.
    const kind: MediaKind | null =
      declared === 'photo' || declared === 'voice'
        ? declared
        : row.content.startsWith('data:image/') ? 'photo'
        : row.content.startsWith('data:audio/') ? 'voice'
        : null;
    if (!kind) throw new MediaError('Ungültige Mediendaten');
    row.content = await storeDataUrl(db, {
      companyId: session.companyId,
      userId: session.userId,
      kind,
      dataUrl: row.content,
    });
  }
}
