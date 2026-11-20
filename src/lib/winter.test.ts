import { describe, expect, it } from 'vitest';
import { WinterError, canonicalEntry, chainHash, parseWork } from '@/lib/winter';

const now = new Date('2026-12-10T06:00:00Z');

describe('parseWork', () => {
  it('accepts a gritting run with material and rounds the amount', () => {
    const work = parseWork({ activity: 'gritting', gritMaterial: 'salt', gritAmountKg: '12.345', areas: ['Gehweg', ' Eingang '] }, now);
    expect(work).toMatchObject({ activity: 'gritting', gritMaterial: 'salt', gritAmountKg: 12.35, areas: ['Gehweg', 'Eingang'] });
    expect(work.performedAt).toEqual(now);
  });

  it('drops material and amount for activities without gritting', () => {
    expect(parseWork({ activity: 'clearing', gritMaterial: 'salt', gritAmountKg: 5 }, now))
      .toMatchObject({ gritMaterial: null, gritAmountKg: null });
  });

  it.each([
    ['unknown activity', { activity: 'dancing' }],
    ['gritting without material', { activity: 'gritting' }],
    ['unknown material', { activity: 'gritting', gritMaterial: 'sugar' }],
    ['negative amount', { activity: 'gritting', gritMaterial: 'salt', gritAmountKg: -1 }],
    ['future time', { activity: 'clearing', performedAt: '2026-12-10T07:00:00Z' }],
    ['more than 72 h ago', { activity: 'clearing', performedAt: '2026-12-06T05:00:00Z' }],
    ['too many areas', { activity: 'clearing', areas: Array.from({ length: 21 }, (_, i) => `A${i}`) }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseWork(body, now)).toThrow(WinterError);
  });

  it('accepts late entries within 72 h (offline phones)', () => {
    expect(parseWork({ activity: 'clearing', performedAt: '2026-12-08T07:00:00Z' }, now).performedAt.toISOString())
      .toBe('2026-12-08T07:00:00.000Z');
  });
});

describe('hash chain', () => {
  const appRow = {
    id: 'x', company_id: 'c', chain_seq: 3, job_site_id: 's', site_label: 'S', employee_id: 'e', employee_name: 'E',
    entered_by: 'e', entered_by_name: 'E', performed_at: new Date('2026-12-10T05:30:00.123Z'),
    recorded_at: new Date('2026-12-10T05:31:00Z'), activity: 'gritting', grit_material: 'salt', grit_amount_kg: 12.5,
    areas: ['Gehweg'], notes: null, lat: 51.5, lng: 11.9, gps_accuracy_m: 8, photo_media_id: null,
    weather: { temperatureC: -2, condition: 'snow' }, corrects_log_id: null, correction_reason: null, voided: false,
    client_request_id: null,
  };
  // The same entry as PostgreSQL returns it: NUMERIC as strings, jsonb keys reordered.
  const dbRow = {
    ...appRow, chain_seq: '3', grit_amount_kg: '12.50', lat: '51.5', lng: '51.5'.replace('51.5', '11.9'),
    gps_accuracy_m: '8', weather: { condition: 'snow', temperatureC: -2 }, prev_hash: 'ignored', hash: 'ignored',
  };

  it('hashes the app value and the stored value identically', () => {
    expect(canonicalEntry(dbRow)).toBe(canonicalEntry(appRow));
    expect(chainHash('abc', dbRow)).toBe(chainHash('abc', appRow));
  });

  it('changes with any field or with the previous hash', () => {
    const base = chainHash('abc', appRow);
    expect(chainHash('abd', appRow)).not.toBe(base);
    expect(chainHash('abc', { ...appRow, notes: 'x' })).not.toBe(base);
    expect(chainHash('abc', { ...appRow, performed_at: new Date('2026-12-10T05:30:00.124Z') })).not.toBe(base);
  });
});
