/**
 * Excel/CSV-Import: Felder je Importart, Spaltenerkennung und Normalisierung
 * der Zellwerte. Gemeinsam für Browser (Vorschau, Zuordnung) und Server
 * (verbindliche Prüfung).
 */
import { GERMAN_MONTHS } from '@/ai/flows/parse-excel-plan-shared';
import { SERVICE_CATALOG, customServiceCode, type SiteService } from '@/lib/services';

export type ImportType = 'sites' | 'users';

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Kleingeschriebene Spaltenüberschriften, die automatisch zugeordnet werden. */
  synonyms: string[];
}

export const IMPORT_FIELDS: Record<ImportType, ImportField[]> = {
  sites: [
    { key: 'name', label: 'Bezeichnung', hint: 'leer = Adresse, Ort', synonyms: ['name', 'bezeichnung', 'objekt', 'objektname', 'liegenschaft', 'objektbezeichnung'] },
    { key: 'address', label: 'Straße und Hausnummer', required: true, synonyms: ['adresse', 'straße', 'strasse', 'str.', 'anschrift', 'straße hausnummer', 'strasse hausnummer', 'straße + hausnr.'] },
    { key: 'postalCode', label: 'PLZ', synonyms: ['plz', 'postleitzahl', 'zip'] },
    { key: 'city', label: 'Ort', required: true, synonyms: ['ort', 'stadt', 'gemeinde', 'city', 'wohnort'] },
    { key: 'region', label: 'Region / Tour', synonyms: ['region', 'tour', 'route', 'gebiet', 'bezirk', 'tourcode'] },
    { key: 'client', label: 'Hausverwaltung', hint: 'wird angelegt, wenn noch nicht vorhanden', synonyms: ['hausverwaltung', 'verwaltung', 'verwalter', 'kunde', 'auftraggeber', 'eigentümer'] },
    { key: 'services', label: 'Leistungen', hint: 'durch Komma getrennt, z. B. „Hofbereich, Rasen Fl. 1, Treppenhaus“', synonyms: ['leistungen', 'leistung', 'leistungsverzeichnis', 'tätigkeiten', 'arbeiten'] },
    { key: 'months', label: 'Monate', hint: 'leer = ganzjährig, z. B. „Apr-Okt“ oder „Mär, Jun, Sep“', synonyms: ['monate', 'monat', 'zeitraum', 'saison'] },
    { key: 'winter', label: 'Winterdienst', hint: 'ja / nein', synonyms: ['winterdienst', 'winter', 'schnee', 'streudienst'] },
  ],
  users: [
    { key: 'name', label: 'Name', hint: 'oder Vorname + Nachname', synonyms: ['name', 'mitarbeiter', 'vollständiger name', 'mitarbeitername'] },
    { key: 'firstName', label: 'Vorname', synonyms: ['vorname', 'first name', 'firstname'] },
    { key: 'lastName', label: 'Nachname', synonyms: ['nachname', 'familienname', 'last name', 'lastname', 'surname'] },
    { key: 'email', label: 'E-Mail', required: true, synonyms: ['e-mail', 'email', 'mail', 'e-mail-adresse', 'emailadresse'] },
    { key: 'role', label: 'Rolle', hint: 'Mitarbeiter, Teamleiter, Manager, Buchhaltung, Admin (leer = Mitarbeiter)', synonyms: ['rolle', 'funktion', 'position', 'role'] },
    { key: 'contractType', label: 'Vertragsart', hint: 'Vollzeit, Teilzeit, Minijob, Midijob', synonyms: ['vertragsart', 'vertrag', 'beschäftigung', 'beschäftigungsart', 'anstellung'] },
    { key: 'hourlyRate', label: 'Stundenlohn (€)', synonyms: ['stundenlohn', 'lohn', 'stundensatz', '€/h', 'euro/stunde'] },
    { key: 'monthlyTargetHours', label: 'Soll-Stunden / Monat', synonyms: ['soll-stunden', 'sollstunden', 'stunden/monat', 'monatsstunden', 'soll'] },
    { key: 'taxClass', label: 'Steuerklasse', synonyms: ['steuerklasse', 'stkl', 'stkl.'] },
    { key: 'svNr', label: 'SV-Nummer', synonyms: ['sv-nr', 'sv-nummer', 'sozialversicherungsnummer', 'rv-nummer', 'svnr'] },
    { key: 'steuerId', label: 'Steuer-ID', synonyms: ['steuer-id', 'steuerid', 'steuer-idnr', 'identifikationsnummer', 'idnr'] },
  ],
};

export const MAX_IMPORT_ROWS: Record<ImportType, number> = { sites: 2000, users: 300 };

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[:*]$/, '');

/** Ordnet Spaltenüberschriften automatisch den Feldern zu: { feld: spaltenindex }. */
export function guessMapping(type: ImportType, headers: string[]): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS[type]) {
    const index = headers.findIndex((h, i) => !used.has(i) && field.synonyms.includes(norm(h)));
    mapping[field.key] = index >= 0 ? index : null;
    if (index >= 0) used.add(index);
  }
  return mapping;
}

export type ImportRow = Record<string, string>;

/** Zeilen der Tabelle über die Zuordnung in Feld-Objekte umwandeln (leere Zeilen weg). */
export function mapRows(rows: unknown[][], mapping: Record<string, number | null>): ImportRow[] {
  return rows
    .map(cells => {
      const out: ImportRow = {};
      for (const [key, index] of Object.entries(mapping)) {
        if (index == null) continue;
        const value = cells[index];
        const text = value == null ? '' : String(value).trim();
        if (text) out[key] = text;
      }
      return out;
    })
    .filter(row => Object.keys(row).length > 0);
}

/* ------------------------------------------------------- Normalisierung */

export function parseBool(value: string | undefined): boolean | null {
  const v = norm(value);
  if (!v) return null;
  if (['ja', 'j', 'yes', 'y', 'x', '1', 'true', 'wahr', '✓', '✔'].includes(v)) return true;
  if (['nein', 'n', 'no', '0', 'false', 'falsch', '-', '—'].includes(v)) return false;
  return null;
}

/** Zahl mit deutschem Komma ("13,50 €" → 13.5). */
export function parseNumber(value: string | undefined): number | null {
  const v = String(value ?? '').replace(/[€\s]/g, '').replace(/h$/i, '');
  if (!v) return null;
  const normalized = /,\d{1,2}$/.test(v) ? v.replace(/\./g, '').replace(',', '.') : v.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const MONTH_KEYS = ['jan', 'feb', 'mär', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'];
const MONTH_ALIASES: Record<string, number> = { mar: 2, maer: 2, märz: 2, may: 4, oct: 9, dec: 11, januar: 0, februar: 1, juni: 5, juli: 6 };

function monthIndex(token: string): number | null {
  const t = norm(token).replace(/\.$/, '');
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n - 1 : null;
  }
  if (t in MONTH_ALIASES) return MONTH_ALIASES[t];
  const i = MONTH_KEYS.findIndex(k => t.startsWith(k));
  return i >= 0 ? i : null;
}

/**
 * "Apr-Okt" / "März bis Oktober" / "3, 6, 9" / "ganzjährig" → Monatskennungen
 * des Leistungsverzeichnisses (GERMAN_MONTHS). Leer = ganzjährig.
 * null = nicht lesbar.
 */
export function parseMonths(value: string | undefined): string[] | null {
  const v = norm(value);
  const all = [...GERMAN_MONTHS];
  if (!v || ['ganzjährig', 'ganzjaehrig', 'alle', 'immer', 'jan-dez', 'januar-dezember', '1-12'].includes(v)) return all;
  const result = new Set<number>();
  for (const part of v.split(/[,;/+]|\s+und\s+/).map(p => p.trim()).filter(Boolean)) {
    const range = part.split(/\s*(?:-|–|bis)\s*/);
    if (range.length === 2) {
      const a = monthIndex(range[0]);
      const b = monthIndex(range[1]);
      if (a == null || b == null) return null;
      for (let i = a; ; i = (i + 1) % 12) {
        result.add(i);
        if (i === b) break;
      }
    } else {
      const i = monthIndex(part);
      if (i == null) return null;
      result.add(i);
    }
  }
  return [...result].sort((x, y) => x - y).map(i => GERMAN_MONTHS[i]);
}

/** "Hofbereich, Rasen Fl. 1, Treppenhaus reinigen" → services-Objekt eines Objekts. */
export function parseServices(value: string | undefined, months: string[]): Record<string, SiteService> {
  const services: Record<string, SiteService> = {};
  const byLabel = new Map(
    Object.entries(SERVICE_CATALOG)
      .filter(([code]) => code !== 'MAENGEL')
      .flatMap(([code, entry]) => [[norm(entry.label), code], [norm(code), code], [norm(code.replace(/_/g, ' ')), code]] as const),
  );
  for (const raw of String(value ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)) {
    const code = byLabel.get(norm(raw));
    if (code) services[code] = { isActive: true, frequency: '', months };
    else services[customServiceCode(raw)] = { isActive: true, frequency: '', months, label: raw.slice(0, 80) };
  }
  return services;
}

const ROLE_ALIASES: Record<string, string> = {
  mitarbeiter: 'WORKER', arbeiter: 'WORKER', worker: 'WORKER', hausmeister: 'WORKER', reinigungskraft: 'WORKER', helfer: 'WORKER',
  teamleiter: 'LEADER', vorarbeiter: 'LEADER', leader: 'LEADER', kolonnenführer: 'LEADER', objektleiter: 'LEADER',
  manager: 'MANAGER', disponent: 'MANAGER', bereichsleiter: 'MANAGER', betriebsleiter: 'MANAGER',
  buchhaltung: 'ACCOUNTANT', buchhalter: 'ACCOUNTANT', lohnbuchhaltung: 'ACCOUNTANT', accountant: 'ACCOUNTANT',
  admin: 'ADMIN', administrator: 'ADMIN', geschäftsführer: 'ADMIN', inhaber: 'ADMIN',
};

export function parseRole(value: string | undefined): string | null {
  const v = norm(value);
  if (!v) return 'WORKER';
  if (ROLE_ALIASES[v]) return ROLE_ALIASES[v];
  const upper = v.toUpperCase();
  return ['WORKER', 'LEADER', 'MANAGER', 'ACCOUNTANT', 'ADMIN'].includes(upper) ? upper : null;
}

export function parseContract(value: string | undefined): string | null {
  const v = norm(value).replace(/[-\s]/g, '');
  if (!v) return 'VOLLZEIT';
  if (v.startsWith('voll')) return 'VOLLZEIT';
  if (v.startsWith('teil')) return 'TEILZEIT';
  if (v.startsWith('mini') || v === '520' || v === '538' || v.includes('geringfügig')) return 'MINIJOB';
  if (v.startsWith('midi') || v.includes('übergang')) return 'MIDIJOB';
  return null;
}

export const ROLE_LABELS: Record<string, string> = {
  WORKER: 'Mitarbeiter', LEADER: 'Teamleiter', MANAGER: 'Manager', ACCOUNTANT: 'Buchhaltung', ADMIN: 'Admin',
};
