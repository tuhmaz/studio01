/**
 * Service catalog (Leistungsverzeichnis), shared by server and browser code.
 *
 * A site's services live in job_sites.services as
 *   { [code]: { isActive, frequency, months, label? } }
 * Standard codes come from SERVICE_CATALOG. A company can add its own per
 * site ("Treppenhaus reinigen") under a code starting with "custom_"; those
 * carry their own label.
 */

export interface CatalogEntry {
  label: string;
  category: string;
}

export const SERVICE_CATALOG: Record<string, CatalogEntry> = {
  AR_Oeffen:      { label: 'Außengehwege',  category: 'Reinigung' },
  AR_Hof:         { label: 'Hofbereich',    category: 'Reinigung' },
  Gullis:         { label: 'Gullis',        category: 'Infrastruktur' },
  Ablaufrinnen:   { label: 'Ablaufrinnen',  category: 'Infrastruktur' },
  AR_Laub:        { label: 'Laub AR',       category: 'Saison' },
  Rasen_Fl1:      { label: 'Rasen Fl. 1',   category: 'Grünpflege' },
  Rasen_Fl2:      { label: 'Rasen Fl. 2',   category: 'Grünpflege' },
  Gittersteine:   { label: 'Gittersteine',  category: 'Grünpflege' },
  Gartenpflege:   { label: 'Gartenpflege',  category: 'Garten' },
  Baeume_Pruefen: { label: 'Bäume Prüfen',  category: 'Sicherheit' },
  VEG_Laub:       { label: 'Laub VEG',      category: 'Saison' },
  // Aufgaben aus Mängelmeldungen des Kundenportals (nicht für Objekte wählbar).
  MAENGEL:        { label: 'Mängelbeseitigung', category: 'Mängel' },
};

/** Kategorie der Tourplan-Aufgaben, die aus einer Mängelmeldung entstehen. */
export const DEFECT_CATEGORY = 'MAENGEL';

/** Kategorie der Winterdienst-Einsätze (dokumentiert im Streuprotokoll, nicht in der Checkliste). */
export const WINTER_CATEGORY = 'WINTERDIENST';

/** Categories that are documented elsewhere and are not part of the checklist. */
export const NON_CHECKLIST_CATEGORIES = new Set([WINTER_CATEGORY]);

export interface SiteService {
  isActive?: boolean;
  frequency?: string | null;
  months?: string[];
  label?: string;
}

export const CUSTOM_PREFIX = 'custom_';

export function isCustomService(code: string) {
  return code.startsWith(CUSTOM_PREFIX);
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Code for a company-defined service: "Treppenhaus reinigen" → "custom_treppenhaus_reinigen". */
export function customServiceCode(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[äöüß]/g, ch => UMLAUTS[ch])
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${CUSTOM_PREFIX}${slug || 'leistung'}`;
}

/** Human-readable name of a service on a given site. */
export function serviceLabel(code: string, siteServices?: Record<string, SiteService> | null): string {
  const own = siteServices?.[code]?.label;
  if (own) return own;
  if (SERVICE_CATALOG[code]) return SERVICE_CATALOG[code].label;
  if (isCustomService(code)) return code.slice(CUSTOM_PREFIX.length).replace(/_/g, ' ');
  return code;
}

/** The checklist items of a visit: its categories minus those documented elsewhere. */
export function checklistCodes(categories: string[] | null | undefined): string[] {
  return (categories ?? []).filter(code => !NON_CHECKLIST_CATEGORIES.has(code));
}
