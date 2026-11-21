import { describe, expect, it } from 'vitest';
import { addDays, berlinDate, isPlanDate, isWinterRisk, winterTaskId } from '@/lib/winter-plan';

describe('dates', () => {
  it('uses the German calendar day', () => {
    // 23:30 UTC on 9 Dec is already 10 Dec in Berlin.
    expect(berlinDate(new Date('2026-12-09T23:30:00Z'))).toBe('2026-12-10');
    expect(berlinDate(new Date('2026-12-09T22:30:00Z'))).toBe('2026-12-09');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('validates plan dates', () => {
    expect(isPlanDate('2026-12-10')).toBe(true);
    expect(isPlanDate('10.12.2026')).toBe(false);
    expect(isPlanDate(undefined)).toBe(false);
  });

  it('gives one task id per site and day', () => {
    expect(winterTaskId('site-1', '2026-12-10')).toBe('winter-site-1-2026-12-10');
  });
});

describe('isWinterRisk', () => {
  const f = (minTempC: number | null, snowOrIce = false, available = true) => ({ available, minTempC, snowOrIce, precipitationMm: 0 });

  it('flags frost at or below the threshold and any snow', () => {
    expect(isWinterRisk(f(1), 1)).toBe(true);
    expect(isWinterRisk(f(1.1), 1)).toBe(false);
    expect(isWinterRisk(f(4, true), 1)).toBe(true);
  });

  it('never flags without a forecast', () => {
    expect(isWinterRisk(f(-5, true, false), 1)).toBe(false);
  });
});
