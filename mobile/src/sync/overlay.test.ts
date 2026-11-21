/** Anzeige offline: wartende Vorgänge über den gespeicherten Stand legen. */
import { describe, expect, it } from 'vitest';
import { overlayChecklist, overlayNotes, overlayTracking, type TrackingData } from '@/sync/overlay';

const user = { id: 'u1', name: 'Ali', email: 'a@x', role: 'WORKER' as const, companyId: 'c1' };
const op = (kind: string, assignmentId: string, body: Record<string, unknown>) => ({
  id: Math.random().toString(36), kind: kind as any, userId: 'u1', assignmentId,
  createdAt: '2026-11-21T06:00:00Z', label: kind, path: '/x', body,
});

const base: TrackingData = {
  assignments: [
    { id: 'a1', title: 'Lindenhof', status: 'PENDING', scheduled_date: '2026-11-21', job_site_id: 's1', categories: ['Gullis'], assigned_worker_ids: ['u1'] },
    { id: 'a2', title: 'Park', status: 'PENDING', scheduled_date: '2026-11-21', job_site_id: 's2', categories: [], assigned_worker_ids: ['u1'] },
  ],
  sites: {},
  activeEntry: null,
  offline: true,
  savedAt: '2026-11-21T05:30:00Z',
};

describe('Zeiterfassung offline', () => {
  it('offline eingestempelt → aktive Schicht mit Gerätezeit, wartend markiert', () => {
    const out = overlayTracking(base, [op('clock_in', 'a1', { requestId: 'r1', at: '2026-11-21T06:02:00Z' })], user);
    expect(out.activeEntry).toMatchObject({ id: 'te-r1', job_assignment_id: 'a1', clock_in_datetime: '2026-11-21T06:02:00Z', pending: true, job_site_id: 's1' });
    expect(out.assignments.find(a => a.id === 'a1')?.status).toBe('IN_PROGRESS');
  });

  it('danach ausgestempelt → keine aktive Schicht, Einsatz erledigt', () => {
    const out = overlayTracking(base, [
      op('clock_in', 'a1', { requestId: 'r1', at: '2026-11-21T06:02:00Z' }),
      op('clock_out', 'a1', { requestId: 'r2', at: '2026-11-21T08:00:00Z' }),
    ], user);
    expect(out.activeEntry).toBeNull();
    expect(out.assignments.find(a => a.id === 'a1')?.status).toBe('COMPLETED');
    expect(out.assignments.find(a => a.id === 'a2')?.status).toBe('PENDING');
  });
});

describe('Checkliste offline', () => {
  const data = {
    assignment: { id: 'a1', date: '2026-11-21', site: { name: 'Lindenhof' }, title: 'x' },
    items: [{ code: 'Gullis', label: 'Gullis', check: null }, { code: 'Laub', label: 'Laub', check: null }],
  };

  it('zeigt abgehakte Leistungen und Gründe sofort, ein späteres Vorher-Foto setzt "erledigt" nicht zurück', () => {
    const out = overlayChecklist(data, [
      op('check', 'a1', { serviceCode: 'Gullis', status: 'done', afterPhoto: 'data:image/jpeg;base64,AAA' }),
      op('check', 'a1', { serviceCode: 'Gullis', status: 'started', beforePhoto: 'data:image/jpeg;base64,BBB' }),
      op('check', 'a1', { serviceCode: 'Laub', status: 'not_possible', reason: 'Zugeparkt' }),
      op('check', 'a2', { serviceCode: 'Laub', status: 'done' }),
    ]);
    expect(out.items[0].check).toMatchObject({ status: 'done', before_url: 'data:image/jpeg;base64,BBB', after_url: 'data:image/jpeg;base64,AAA', pending: true });
    expect(out.items[1].check).toMatchObject({ status: 'not_possible', reason: 'Zugeparkt' });
  });

  it('"zurücksetzen" entfernt die Rückmeldung', () => {
    const out = overlayChecklist(data, [
      op('check', 'a1', { serviceCode: 'Gullis', status: 'done' }),
      op('check', 'a1', { serviceCode: 'Gullis', status: 'open' }),
    ]);
    expect(out.items[0].check).toBeNull();
  });
});

describe('Notizen offline', () => {
  it('zeigt wartende Notizen oben, ohne bereits gesendete doppelt', () => {
    const sent = [{ id: 'note-1', type: 'text', content: 'alt', author_name: 'Ali', created_at: '2026-11-21T05:00:00Z' }];
    const out = overlayNotes(sent, [
      op('note', 'a1', { id: 'note-1', type: 'text', content: 'alt', at: '2026-11-21T05:00:00Z' }),
      op('note', 'a1', { id: 'note-2', type: 'photo', content: 'data:image/jpeg;base64,X', at: '2026-11-21T06:10:00Z' }),
      op('note', 'a9', { id: 'note-3', type: 'text', content: 'anderer Einsatz', at: '2026-11-21T06:11:00Z' }),
    ], 'a1', user);
    expect(out.map(n => [n.id, !!n.pending])).toEqual([['note-2', true], ['note-1', false]]);
  });
});
