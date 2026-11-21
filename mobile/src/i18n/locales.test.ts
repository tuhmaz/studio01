/** Wörterbücher: jede Sprache vollständig, Platzhalter gleich, jeder t('…')-Schlüssel vorhanden. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { de } from './locales/de';
import { en } from './locales/en';
import { ar } from './locales/ar';
import { tr } from './locales/tr';
import { pl } from './locales/pl';
import { ro } from './locales/ro';
import { uk } from './locales/uk';

const dicts = { en, ar, tr, pl, ro, uk } as Record<string, Record<string, string>>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === 'locales' ? [] : sources(p);
    return /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

describe('Übersetzungen', () => {
  for (const [lang, dict] of Object.entries(dicts)) {
    it(`${lang}: gleiche Schlüssel und Platzhalter wie Deutsch, nichts leer`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(de).sort());
      for (const [k, v] of Object.entries(de)) {
        expect(dict[k].trim(), `${lang}.${k}`).not.toBe('');
        expect(placeholders(dict[k]), `${lang}.${k}`).toEqual(placeholders(v));
      }
    });
  }

  it("jeder t('…')-Aufruf im Code hat einen Eintrag", () => {
    const root = join(__dirname, '..', '..');
    const files = [...sources(join(root, 'app')), ...sources(join(root, 'src'))];
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([\w.]+)'/g)) {
        if (!(m[1] in de)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
