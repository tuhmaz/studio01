/**
 * Photos and voice notes: stored as files, served only to the right people.
 */
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as data } from '@/app/api/data/route';
import { GET as media } from '@/app/api/media/[id]/route';
import { appRole, testDb } from './db-config';
import { call, seed, sql, tokenFor, type CompanyFixture, type Fixtures } from './helpers';

let fx: Fixtures;

beforeEach(async () => {
  fx = await seed();
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake image body for tests')]);
const M4A = Buffer.concat([Buffer.from('\0\0\0\x20ftypM4A ', 'latin1'), Buffer.from('fake audio body for tests')]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

async function addNote(company: CompanyFixture, type: 'photo' | 'voice' | 'text', content: string, id = `note-${type}`) {
  return call(data, '/api/data', await tokenFor(company, 'WORKER'), {
    action: 'insert',
    table: 'work_log_entries',
    data: {
      id,
      time_entry_id: company.timeEntryId,
      type,
      content,
      author_name: 'Worker',
    },
  });
}

async function getMedia(url: string, token: string | null, headers: Record<string, string> = {}) {
  const id = url.split('/').pop()!;
  const req = new NextRequest(`http://localhost${url}`, {
    headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return media(req, { params: Promise.resolve({ id }) });
}

describe('uploading', () => {
  it('stores a photo as a file and keeps only a reference in the database', async () => {
    const res = await addNote(fx.a, 'photo', dataUrl('image/jpeg', JPEG));
    expect(res.status).toBe(200);
    const content = res.json.data[0].content as string;
    expect(content).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);

    const [file] = await sql`SELECT company_id, kind, content_type, size_bytes FROM media_files`;
    expect(file).toEqual({ company_id: fx.a.id, kind: 'photo', content_type: 'image/jpeg', size_bytes: JPEG.length });
  });

  it('stores voice notes and detects the real format', async () => {
    const res = await addNote(fx.a, 'voice', dataUrl('application/octet-stream', M4A));
    expect(res.status).toBe(200);
    const [file] = await sql`SELECT content_type FROM media_files`;
    expect(file.content_type).toBe('audio/mp4');
  });

  it.each([
    ['HTML disguised as a JPEG', 'photo', dataUrl('image/jpeg', Buffer.from('<html><script>alert(1)</script></html>'))],
    ['an SVG image', 'photo', dataUrl('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))],
    ['an image sent as a voice note', 'voice', dataUrl('audio/webm', JPEG)],
  ] as const)('rejects %s', async (_name, type, content) => {
    const res = await addNote(fx.a, type, content);
    expect(res.status).toBe(400);
    expect(await sql`SELECT 1 FROM media_files`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM work_log_entries WHERE id = ${`note-${type}`}`).toHaveLength(0);
  });

  it('leaves text notes untouched, even if they look like a data URL', async () => {
    const res = await addNote(fx.a, 'text', 'data:das ist nur Text');
    expect(res.status).toBe(200);
    expect(res.json.data[0].content).toBe('data:das ist nur Text');
  });
});

describe('serving', () => {
  let url: string;
  beforeEach(async () => {
    url = (await addNote(fx.a, 'photo', dataUrl('image/jpeg', JPEG))).json.data[0].content;
  });

  it('serves the file to its uploader with safe headers', async () => {
    const res = await getMedia(url, await tokenFor(fx.a, 'WORKER'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
  });

  it('serves the file to managers of the same company', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'LEADER'] as const) {
      const res = await getMedia(url, await tokenFor(fx.a, role));
      expect(res.status, role).toBe(200);
    }
  });

  it('hides the file from every other company, as if it did not exist', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEADER', 'WORKER'] as const) {
      const res = await getMedia(url, await tokenFor(fx.b, role));
      expect(res.status, role).toBe(404);
    }
  });

  it('hides the file from other workers of the same company', async () => {
    const res = await getMedia(url, await tokenFor(fx.a, 'WORKER2'));
    expect(res.status).toBe(404);
  });

  it('requires authentication and the work_logs.view permission', async () => {
    expect((await getMedia(url, null)).status).toBe(401);
    expect((await getMedia(url, await tokenFor(fx.a, 'ACCOUNTANT'))).status).toBe(200);
  });

  it('answers byte-range requests for audio players', async () => {
    const res = await getMedia(url, await tokenFor(fx.a, 'ADMIN'), { range: 'bytes=0-3' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-3/${JPEG.length}`);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG.subarray(0, 4));
  });

  it('rejects ids that are not UUIDs', async () => {
    const res = await getMedia('/api/media/..%2F..%2Fetc%2Fpasswd', await tokenFor(fx.a, 'ADMIN'));
    expect(res.status).toBe(404);
  });
});

describe('backfill script', () => {
  it('moves existing Base64 media into storage and skips invalid ones', async () => {
    await sql`
      INSERT INTO work_log_entries (id, company_id, time_entry_id, employee_id, type, content, author_name)
      VALUES
        ('legacy-photo', ${fx.a.id}, ${fx.a.timeEntryId}, ${fx.a.users.WORKER.id}, 'photo', ${dataUrl('image/jpeg', JPEG)}, 'W'),
        ('legacy-voice', ${fx.b.id}, ${fx.b.timeEntryId}, ${fx.b.users.WORKER.id}, 'voice', ${dataUrl('audio/m4a', M4A)}, 'W'),
        ('legacy-broken', ${fx.a.id}, ${fx.a.timeEntryId}, ${fx.a.users.WORKER.id}, 'photo', 'data:image/jpeg;base64,PGh0bWw+', 'W')
    `;

    const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate-media.ts'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_HOST: testDb.host,
        DB_PORT: String(testDb.port),
        DB_DATABASE: testDb.database,
        DB_USERNAME: appRole.username,
        DB_PASSWORD: appRole.password,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/2 migrated, 1 skipped/);

    const rows = await sql`SELECT id, content FROM work_log_entries WHERE id LIKE 'legacy-%' ORDER BY id`;
    const byId = Object.fromEntries(rows.map(r => [r.id, r.content]));
    expect(byId['legacy-photo']).toMatch(/^\/api\/media\//);
    expect(byId['legacy-voice']).toMatch(/^\/api\/media\//);
    expect(byId['legacy-broken']).toBe('data:image/jpeg;base64,PGh0bWw+');

    const files = await sql`SELECT company_id, kind FROM media_files ORDER BY company_id`;
    expect(files).toEqual([{ company_id: fx.a.id, kind: 'photo' }, { company_id: fx.b.id, kind: 'voice' }]);

    // The migrated photo is served like a new upload.
    const res = await getMedia(byId['legacy-photo'], await tokenFor(fx.a, 'ADMIN'));
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
  });
});
