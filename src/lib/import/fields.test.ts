import { describe, expect, it } from 'vitest';
import { guessMapping, mapRows, parseBool, parseContract, parseMonths, parseNumber, parseRole, parseServices } from './fields';

describe('Import: Spalten und Werte', () => {
  it('erkennt Spaltenüberschriften unabhängig von Schreibweise', () => {
    const m = guessMapping('sites', ['Objekt', ' Straße ', 'PLZ', 'Ort:', 'Hausverwaltung', 'Leistungen', 'Sonstiges']);
    expect(m).toMatchObject({ name: 0, address: 1, postalCode: 2, city: 3, client: 4, services: 5, months: null, winter: null });
    expect(guessMapping('users', ['Vorname', 'Nachname', 'E-Mail-Adresse', 'Stundenlohn'])).toMatchObject({ firstName: 0, lastName: 1, email: 2, hourlyRate: 3 });
  });

  it('übernimmt nur zugeordnete Spalten und lässt leere Zeilen weg', () => {
    expect(mapRows([[' A ', 'x', 3], [null, '', ''], ['B', '', 39104]], { name: 0, postalCode: 2 }))
      .toEqual([{ name: 'A', postalCode: '3' }, { name: 'B', postalCode: '39104' }]);
  });

  it('Monate', () => {
    expect(parseMonths('')).toHaveLength(12);
    expect(parseMonths('Apr-Okt')).toEqual(['Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.']);
    expect(parseMonths('März bis Mai')).toEqual(['Mär.', 'Apr.', 'Mai']);
    expect(parseMonths('3, 6, 9')).toEqual(['Mär.', 'Jun.', 'Sep.']);
    expect(parseMonths('Nov-Feb')).toEqual(['Jan.', 'Feb. ', 'Nov.', 'Dez.']);
    expect(parseMonths('ganzjährig')).toHaveLength(12);
    expect(parseMonths('Sommer')).toBeNull();
  });

  it('Zahlen, Ja/Nein, Rollen, Vertragsarten', () => {
    expect(parseNumber('13,50 €')).toBe(13.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('14.25')).toBe(14.25);
    expect(parseNumber('abc')).toBeNull();
    expect([parseBool('Ja'), parseBool('x'), parseBool('nein'), parseBool('vielleicht')]).toEqual([true, true, false, null]);
    expect([parseRole(''), parseRole('Vorarbeiter'), parseRole('Buchhaltung'), parseRole('Pilot')]).toEqual(['WORKER', 'LEADER', 'ACCOUNTANT', null]);
    expect([parseContract(''), parseContract('Mini-Job'), parseContract('Teilzeit'), parseContract('?')]).toEqual(['VOLLZEIT', 'MINIJOB', 'TEILZEIT', null]);
  });

  it('Leistungen: Katalog per Name oder Code, sonst eigene Leistung', () => {
    const s = parseServices('Hofbereich; rasen_fl1, Treppenhaus reinigen', ['Mai']);
    expect(Object.keys(s)).toEqual(['AR_Hof', 'Rasen_Fl1', 'custom_treppenhaus_reinigen']);
    expect(s.custom_treppenhaus_reinigen).toMatchObject({ isActive: true, months: ['Mai'], label: 'Treppenhaus reinigen' });
  });
});
