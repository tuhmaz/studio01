import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { MAX_MEDIA_BYTES, MediaError, decodeDataUrl, detectMedia, mediaIdFromUrl } from '@/lib/media';
import { parseRange } from '@/lib/http-range';

const pad = (head: number[] | string) =>
  Buffer.concat([typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head), Buffer.alloc(16)]);

describe('detectMedia', () => {
  it.each([
    ['jpeg', pad([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', 'photo'],
    ['png', pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'photo'],
    ['webp', pad('RIFF\0\0\0\0WEBP'), 'image/webp', 'photo'],
    ['webm', pad([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm', 'voice'],
    ['m4a', pad('\0\0\0\x20ftypM4A '), 'audio/mp4', 'voice'],
    ['3gp', pad('\0\0\0\x18ftyp3gp4'), 'audio/3gpp', 'voice'],
    ['ogg', pad('OggS'), 'audio/ogg', 'voice'],
    ['wav', pad('RIFF\0\0\0\0WAVE'), 'audio/wav', 'voice'],
  ])('recognises %s', (_name, bytes, contentType, kind) => {
    expect(detectMedia(bytes)).toMatchObject({ contentType, kind });
  });

  it.each([
    ['html', pad('<html><script>alert(1)</script>')],
    ['svg', pad('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['pdf', pad('%PDF-1.7')],
    ['too short', Buffer.from([0xff, 0xd8, 0xff])],
  ])('rejects %s', (_name, bytes) => {
    expect(detectMedia(bytes)).toBeNull();
  });
});

describe('decodeDataUrl', () => {
  it('decodes base64 data URLs', () => {
    expect(decodeDataUrl('data:image/jpeg;base64,AQID')).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects non-base64 and malformed data URLs', () => {
    expect(() => decodeDataUrl('data:text/plain,hello')).toThrow(MediaError);
    expect(() => decodeDataUrl('data:image/jpeg;base64,')).toThrow(MediaError);
    expect(() => decodeDataUrl('not a data url')).toThrow(MediaError);
  });

  it('rejects files above the size limit before decoding them', () => {
    const big = 'A'.repeat(Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 8);
    expect(() => decodeDataUrl(`data:image/jpeg;base64,${big}`)).toThrow(/zu groß/);
  });
});

describe('mediaIdFromUrl', () => {
  it('extracts the id of a media reference', () => {
    expect(mediaIdFromUrl('/api/media/123e4567-e89b-42d3-a456-426614174000')).toBe('123e4567-e89b-42d3-a456-426614174000');
  });

  it('ignores anything else', () => {
    expect(mediaIdFromUrl('/api/media/../etc/passwd')).toBeNull();
    expect(mediaIdFromUrl('data:image/jpeg;base64,AA')).toBeNull();
    expect(mediaIdFromUrl(42)).toBeNull();
  });
});

describe('parseRange', () => {
  it('handles open, closed and suffix ranges', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('flags unsatisfiable ranges and ignores unsupported ones', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=20-10', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange(null, 100)).toBeNull();
  });
});
