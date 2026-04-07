/**
 * @fileOverview Gemeinsame Konstanten, Schemas und Hilfsfunktionen für die Tourplan-Analyse.
 * Optimiert für die Erkennung von Häufigkeiten (z.B. 4xJ, 1xW) und Monats-Markierungen.
 */

import { z } from 'zod';

export const GERMAN_MONTHS = [
  'Jan.', 'Feb. ', 'Mär.', 'Apr.', 'Mai', 'Jun.',
  'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'
] as const;
export type GermanMonth = typeof GERMAN_MONTHS[number];

export const SERVICE_CODES = [
  'AR_Oeffen',        // Außengehwege (Blau)
  'AR_Hof',           // Hofbereich (Blau)
  'Gullis',           // Gullis (Schwarz)
  'Ablaufrinnen',     // Ablaufrinnen (Schwarz)
  'AR_Laub',          // Laub (Gelb)
  'Rasen_Fl1',        // Rasen 01 (Grün)
  'Rasen_Fl2',        // Rasen 02 (Grün)
  'Gittersteine',     // Gitterst. (Grün)
  'Gartenpflege',     // VEG Pflege (Rot)
  'Baeume_Pruefen',   // Bäumeprüf. (Braun)
  'VEG_Laub'          // Laub (Gelb)
] as const;
export type ServiceCode = typeof SERVICE_CODES[number];

export const ServiceDetailSchema = z.object({
  isActive: z.boolean().describe('True, wenn eine Markierung oder Frequenz vorhanden ist.'),
  frequency: z.string().describe('Die Frequenz-Angabe (z.B. 4 X Jähr., 1 X Wöch.).').nullable(),
  annualCount: z.number().describe('Anzahl der Einsätze pro Jahr basierend auf der Frequenz.').nullable(),
  months: z.array(z.string()).describe('Liste der Monatsnamen, in denen die Leistung erbracht wird.'),
});

export const JobSiteSchema = z.object({
  id: z.string().describe('Objektnummer.'),
  region: z.enum(['LR-39', 'LR-38']).describe('Region basierend auf dem Standort.'),
  city: z.string().describe('Stadtname.'),
  postalCode: z.string().optional(),
  address: z.string().describe('Straße und Hausnummer.'),
  name: z.string().describe('Objektname.'),
  isRemote: z.boolean().describe('True, wenn >95km entfernt.'),
  services: z.record(ServiceDetailSchema).describe('Mapping von Dienstleistungscodes auf Details.'),
});

export type JobSiteFromPlan = z.infer<typeof JobSiteSchema>;

export const ParseExcelPlanOutputSchema = z.object({
  sites: z.array(JobSiteSchema),
});
export type ParseExcelPlanOutput = z.infer<typeof ParseExcelPlanOutputSchema>;

export const ParseExcelPlanInputSchema = z.object({
  sheetName: z.string().describe('Name des Excel-Blatts.'),
  rawRows: z.string().describe('JSON-String der Zeilendaten.'),
});
export type ParseExcelPlanInput = z.infer<typeof ParseExcelPlanInputSchema>;

export function normalizeMonth(m: string): GermanMonth | null {
  if (!m) return null;
  const cleaned = m.trim().toLowerCase();
  for (const month of GERMAN_MONTHS) {
    if (month.toLowerCase().startsWith(cleaned.substring(0, 3))) {
      return month;
    }
  }
  return null;
}

export function calculateAnnualCount(freq: string | null): number | null {
  if (!freq) return null;
  const normalized = freq.toLowerCase().replace(/\s/g, '').replace(',', '.');
  
  const matchNum = normalized.match(/(\d+(\.\d+)?)/);
  const num = matchNum ? parseFloat(matchNum[1]) : 1;

  // J = Jährlich, M = Monatlich, W = Wöchentlich
  if (normalized.includes('j')) return num;
  if (normalized.includes('m')) return num * 12;
  if (normalized.includes('w')) return num * 52;
  
  return num;
}
