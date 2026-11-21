/**
 * Postausgang der App: Reihenfolge, Netzverlust, Ablehnung, Benutzertrennung.
 * Dateisystem und Server werden im Speicher nachgebildet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, string>();
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'mem://',
  getInfoAsync: async (path: string) => ({
    exists: files.has(path) || [...files.keys()].some(k => k.startsWith(path)),
  }),
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: async (path: string, data: string) => { files.set(path, data); },
  readAsStringAsync: async (path: string) => {
    const v = files.get(path);
    if (v == null) throw new Error('missing');
    return v;
  },
  readDirectoryAsync: async (dir: string) =>
    [...files.keys()].filter(k => k.startsWith(dir) && !k.slice(dir.length).includes('/')).map(k => k.slice(dir.length)),
  deleteAsync: async (path: string) => { files.delete(path); },
}));

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const server = {
  online: true,
  received: [] as Array<{ path: string; body: any }>,
  reject: new Set<string>(),
};
vi.mock('@/api/client', () => ({
  ApiError,
  apiFetch: async (path: string, options: { body: any }) => {
    if (!server.online) throw new Error('Keine Internetverbindung');
    if (server.reject.has(options.body.marker)) throw new ApiError('Älter als 72 Stunden', 400);
    server.received.push({ path, body: options.body });
    return { data: null };
  },
}));

const { submit, flush, pendingOps, failedOps, retryFailed, newOpId } = await import('@/sync/outbox');
type Op = Parameters<typeof submit>[0];

let t = Date.parse('2026-11-21T06:00:00Z');
function op(marker: string, userId = 'u1'): Op {
  t += 60_000;
  return {
    id: newOpId(), kind: 'check', userId, assignmentId: 'a1', createdAt: new Date(t).toISOString(),
    label: marker, path: '/api/checks', body: { marker },
  };
}

beforeEach(() => {
  files.clear();
  server.online = true;
  server.received = [];
  server.reject.clear();
});

describe('Postausgang', () => {
  it('sendet sofort, wenn Netz da ist', async () => {
    expect(await submit(op('a'))).toBe('sent');
    expect(server.received.map(r => r.body.marker)).toEqual(['a']);
    expect(await pendingOps('u1')).toHaveLength(0);
  });

  it('speichert ohne Netz und sendet später in der richtigen Reihenfolge', async () => {
    server.online = false;
    expect(await submit(op('einstempeln'))).toBe('queued');
    expect(await submit(op('abhaken'))).toBe('queued');
    server.online = true;
    // Neuer Vorgang, während noch etwas wartet: hinten anstellen, nicht vordrängeln.
    expect(await submit(op('ausstempeln'))).toBe('queued');
    await flush('u1');
    expect(server.received.map(r => r.body.marker)).toEqual(['einstempeln', 'abhaken', 'ausstempeln']);
    expect(await pendingOps('u1')).toHaveLength(0);
  });

  it('hält bei Netzverlust an und macht später an derselben Stelle weiter', async () => {
    server.online = false;
    await submit(op('1'));
    await submit(op('2'));
    const result = await flush('u1');
    expect(result).toMatchObject({ sent: 0, remaining: 2 });
    server.online = true;
    expect(await flush('u1')).toMatchObject({ sent: 2, remaining: 0 });
  });

  it('abgelehnte Vorgänge gehen nicht verloren und blockieren die anderen nicht', async () => {
    server.online = false;
    await submit(op('alt'));
    await submit(op('neu'));
    server.online = true;
    server.reject.add('alt');
    expect(await flush('u1')).toMatchObject({ sent: 1, newlyFailed: 1, remaining: 0 });
    const failed = await failedOps('u1');
    expect(failed.map(f => [f.label, f.error])).toEqual([['alt', 'Älter als 72 Stunden']]);
    // Nach Klärung erneut versuchen.
    server.reject.clear();
    await retryFailed(failed[0]);
    await flush('u1');
    expect(server.received.map(r => r.body.marker)).toEqual(['neu', 'alt']);
    expect(await failedOps('u1')).toHaveLength(0);
  });

  it('inhaltliche Ablehnung beim direkten Senden wird sofort gemeldet', async () => {
    server.reject.add('x');
    await expect(submit(op('x'))).rejects.toThrow('Älter als 72 Stunden');
    expect(await pendingOps('u1')).toHaveLength(0);
  });

  it('sendet nur Vorgänge des angemeldeten Benutzers', async () => {
    server.online = false;
    await submit(op('von-ali', 'ali'));
    await submit(op('von-bea', 'bea'));
    server.online = true;
    await flush('bea');
    expect(server.received.map(r => r.body.marker)).toEqual(['von-bea']);
    expect((await pendingOps('ali')).map(o => o.label)).toEqual(['von-ali']);
  });
});
