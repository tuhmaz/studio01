import { describe, expect, it } from 'vitest';
import { companyIdFromName, validateSignup } from '@/lib/signup';

describe('companyIdFromName', () => {
  it('builds a readable slug with a random suffix', () => {
    expect(companyIdFromName('Müller & Söhne Hausmeister GmbH')).toMatch(/^mueller-soehne-hausmeister-gmbh-[0-9a-f]{6}$/);
  });

  it('is unique per call and never empty', () => {
    expect(companyIdFromName('Firma')).not.toBe(companyIdFromName('Firma'));
    expect(companyIdFromName('!!!')).toMatch(/^firma-[0-9a-f]{6}$/);
  });

  it('keeps ids short', () => {
    expect(companyIdFromName('x'.repeat(200)).length).toBeLessThanOrEqual(47);
  });
});

describe('validateSignup', () => {
  const valid = { companyName: 'Muster GmbH', name: 'Max', email: 'max@muster.de', password: 'ein-langes-passwort', acceptTerms: true };

  it('accepts a complete form', () => {
    expect(validateSignup(valid)).toBeNull();
  });

  it.each([
    ['short company name', { companyName: 'X' }],
    ['missing name', { name: '' }],
    ['invalid email', { email: 'max@muster' }],
    ['short password', { password: 'kurz' }],
    ['terms not accepted', { acceptTerms: false }],
  ])('rejects %s', (_label, change) => {
    expect(validateSignup({ ...valid, ...change })).toEqual(expect.any(String));
  });
});
