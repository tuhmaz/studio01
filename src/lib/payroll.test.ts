import { describe, expect, it } from 'vitest';
import { simulatePayroll } from '@/lib/payroll';
import type { User } from '@/lib/types';

const worker = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  name: 'Test',
  email: 't@example.com',
  role: 'WORKER',
  contractType: 'VOLLZEIT',
  taxClass: 1,
  kinder: 0,
  bundesland: 'ST',
  hasChurchTax: false,
  ...overrides,
} as User);

const sumDeductions = (r: ReturnType<typeof simulatePayroll>) =>
  r.lohnsteuer + r.soli + r.kirchensteuer +
  r.krankenversicherung + r.rentenversicherung + r.arbeitslosenversicherung + r.pflegeversicherung;

describe('simulatePayroll', () => {
  it('pays a Minijob up to the 603 € limit without deductions', () => {
    const r = simulatePayroll(worker({ contractType: 'MINIJOB' }), 603);
    expect(r.totalAbzuege).toBe(0);
    expect(r.netto).toBe(603);
  });

  it('treats negative or invalid gross pay as zero', () => {
    expect(simulatePayroll(worker(), -100).brutto).toBe(0);
    expect(simulatePayroll(worker(), Number.NaN).brutto).toBe(0);
  });

  it.each([1500, 2800, 4500, 9000])('keeps netto + deductions equal to brutto at %i €', brutto => {
    const r = simulatePayroll(worker(), brutto);
    expect(r.totalAbzuege).toBeCloseTo(sumDeductions(r), 6);
    expect(r.netto + r.totalAbzuege).toBeCloseTo(brutto, 6);
    expect(r.netto).toBeGreaterThan(0);
  });

  it('withholds less income tax in class 3 than in class 1', () => {
    const k1 = simulatePayroll(worker({ taxClass: 1 }), 4000);
    const k3 = simulatePayroll(worker({ taxClass: 3 }), 4000);
    expect(k3.lohnsteuer).toBeLessThan(k1.lohnsteuer);
  });

  it('charges church tax only when the employee is liable', () => {
    expect(simulatePayroll(worker({ hasChurchTax: false }), 4000).kirchensteuer).toBe(0);
    expect(simulatePayroll(worker({ hasChurchTax: true }), 4000).kirchensteuer).toBeGreaterThan(0);
  });

  it('caps health and pension contributions at the 2026 ceilings', () => {
    const atCeiling = simulatePayroll(worker(), 8450);
    const above = simulatePayroll(worker(), 20000);
    expect(above.krankenversicherung).toBeCloseTo(atCeiling.krankenversicherung, 6);
    expect(above.rentenversicherung).toBeCloseTo(atCeiling.rentenversicherung, 6);
  });

  it('applies the higher employee care-insurance rate in Saxony', () => {
    const st = simulatePayroll(worker({ bundesland: 'ST', kinder: 1 }), 3000);
    const sn = simulatePayroll(worker({ bundesland: 'SN', kinder: 1 }), 3000);
    expect(sn.pflegeversicherung).toBeGreaterThan(st.pflegeversicherung);
  });

  it('reduces care insurance for parents of several children', () => {
    const one = simulatePayroll(worker({ kinder: 1 }), 3000);
    const three = simulatePayroll(worker({ kinder: 3 }), 3000);
    const none = simulatePayroll(worker({ kinder: 0 }), 3000);
    expect(three.pflegeversicherung).toBeLessThan(one.pflegeversicherung);
    expect(none.pflegeversicherung).toBeGreaterThan(one.pflegeversicherung);
  });
});
