
import { User } from './types';

/**
 * German payroll simulation — 2025/2026 estimates
 * DISCLAIMER: Vereinfachte Simulation. Keine rechtsgültige Lohnabrechnung.
 * Für die offizielle Abrechnung ist ein zertifizierter Lohnbuchhalter zu beauftragen.
 */

// ─── Sozialversicherungssätze 2025/2026 ───────────────────────────────────────
const KV_BASIS_RATE   = 14.6;  // Krankenversicherung Basisrate % (Arbeitnehmer + Arbeitgeber je 7.3%)
const KV_DEFAULT_ZUSATZ = 1.7; // Durchschnittlicher Zusatzbeitrag % (variiert je Krankenkasse)
const RV_RATE         = 18.6;  // Rentenversicherung %
const AV_RATE         = 2.6;   // Arbeitslosenversicherung %
const PV_RATE_KINDER  = 3.4;   // Pflegeversicherung mit Kindern %
const PV_RATE_KINDERLOS = 4.0; // Pflegeversicherung kinderlos %

// ─── Einkommensteuer 2024/2025 (EStG §32a) ───────────────────────────────────
const GFB             = 11_784; // Grundfreibetrag
const ANP             = 1_230;  // Arbeitnehmer-Pauschbetrag
const SONDERAUSGABEN  = 36;     // Sonderausgaben-Pauschbetrag
const KINDER_FB       = 4_764;  // Kinderfreibetrag je Elternteil je Kind (halber Kinderfreibetrag)
// SK2 Entlastungsbetrag für Alleinerziehende
const SK2_ENTLASTUNG  = 4_260;

// Kirchensteuer nach Bundesland
const KIRCHENSTEUER_RATES: Record<string, number> = {
  BW: 0.08, BY: 0.08,
  DEFAULT: 0.09,
};

// Soli: nur fällig wenn Lohnsteuer > Freigrenze
const SOLI_RATE            = 0.055;
const SOLI_FREIGRENZE_MONTHLY = 18_130 / 12;

// ─── Progressiver Einkommensteuer-Algorithmus ─────────────────────────────────
/**
 * Berechnet die jährliche Einkommensteuer auf ein zu versteuerndes Einkommen (zvE).
 * Basiert auf EStG §32a (Werte für 2024, gültig für Simulation 2025/2026).
 */
function calcAnnualESt(zvE: number): number {
  if (zvE <= 0) return 0;

  // Zone 0: bis Grundfreibetrag → 0%
  if (zvE <= GFB) return 0;

  // Zone 1: GFB+1 bis 17.005 → Progressionszone
  if (zvE <= 17_005) {
    const y = (zvE - GFB) / 10_000;
    return (979.18 * y + 1_400) * y;
  }

  // Zone 2: 17.006 bis 66.760 → Obere Progressionszone
  if (zvE <= 66_760) {
    const z = (zvE - 17_005) / 10_000;
    return (192.59 * z + 2_397) * z + 966.53;
  }

  // Zone 3: 66.761 bis 277.825 → Spitzensteuersatz 42%
  if (zvE <= 277_825) {
    return 0.42 * zvE - 9_336;
  }

  // Zone 4: über 277.826 → Reichensteuersatz 45%
  return 0.45 * zvE - 17_671.2;
}

/**
 * Berechnet das zu versteuernde Einkommen (zvE) basierend auf Steuerklasse und Kinderfreibeträgen.
 */
function calcZVE(annualBrutto: number, steuerklasse: number, kinder: number): number {
  let freibetrag = 0;

  switch (steuerklasse) {
    case 1: // Ledig / geschieden / verwitwet
    case 4: // Verheiratet, individuelle Aufteilung (= 2× SK1)
      freibetrag = GFB + ANP + SONDERAUSGABEN;
      break;
    case 2: // Alleinerziehend
      freibetrag = GFB + ANP + SONDERAUSGABEN + SK2_ENTLASTUNG;
      break;
    case 3: // Verheiratet, günstige Seite (Partner hat SK5)
      freibetrag = 2 * GFB + ANP + SONDERAUSGABEN;
      break;
    case 5: // Verheiratet, ungünstige Seite (Partner hat SK3) → kein Grundfreibetrag
      freibetrag = ANP + SONDERAUSGABEN;
      break;
    case 6: // Zweitjob / kein Freibetrag
      freibetrag = 0;
      break;
    default:
      freibetrag = GFB + ANP + SONDERAUSGABEN;
  }

  // Kinderfreibetrag (vereinfacht: voller Kinderfreibetrag für SK1/2/3/4)
  if (steuerklasse !== 5 && steuerklasse !== 6) {
    freibetrag += kinder * KINDER_FB;
  }

  return Math.max(0, annualBrutto - freibetrag);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export interface PayrollResult {
  brutto: number;
  lohnsteuer: number;
  soli: number;
  kirchensteuer: number;
  krankenversicherung: number;
  rentenversicherung: number;
  arbeitslosenversicherung: number;
  pflegeversicherung: number;
  totalAbzuege: number;
  netto: number;
  kvZusatzRate: number; // tatsächlich verwendeter Zusatzbeitrag
}

export function simulatePayroll(user: User, bruttoLohn: number): PayrollResult {

  // ── Minijob: pauschal, keine Abzüge für Arbeitnehmer ─────────────────────
  if (user.contractType === 'MINIJOB' && bruttoLohn <= 538) {
    return {
      brutto: bruttoLohn, lohnsteuer: 0, soli: 0, kirchensteuer: 0,
      krankenversicherung: 0, rentenversicherung: 0, arbeitslosenversicherung: 0,
      pflegeversicherung: 0, totalAbzuege: 0, netto: bruttoLohn,
      kvZusatzRate: 0,
    };
  }

  const steuerklasse = user.taxClass ?? user.steuerklasse ?? 1;
  const kinder       = user.kinder ?? 0;
  const bundesland   = user.bundesland ?? 'DEFAULT';
  const kirchenpflichtig = user.hasChurchTax ?? user.kirchensteuerpflichtig ?? false;
  const kvZusatzRate = user.kvZusatzRate ?? KV_DEFAULT_ZUSATZ;

  // ── 1. Lohnsteuer (progressiv nach EStG §32a) ─────────────────────────────
  const annualBrutto = bruttoLohn * 12;
  const zvE          = calcZVE(annualBrutto, steuerklasse, kinder);
  let   annualESt    = calcAnnualESt(zvE);

  // SK6: Mindeststeuer 25% auf gesamtes Brutto (Zweitjob ohne Freibetrag)
  if (steuerklasse === 6) {
    annualESt = Math.max(annualESt, annualBrutto * 0.25);
  }

  const lohnsteuer = annualESt / 12;

  // ── 2. Solidaritätszuschlag ───────────────────────────────────────────────
  const soli = lohnsteuer > SOLI_FREIGRENZE_MONTHLY ? lohnsteuer * SOLI_RATE : 0;

  // ── 3. Kirchensteuer ──────────────────────────────────────────────────────
  const kstRate    = KIRCHENSTEUER_RATES[bundesland] ?? KIRCHENSTEUER_RATES.DEFAULT;
  const kirchensteuer = kirchenpflichtig && lohnsteuer > 0 ? lohnsteuer * kstRate : 0;

  // ── 4. Sozialversicherung ─────────────────────────────────────────────────
  // Midijob-Übergangsbereich: 538,01 – 2.000 € → reduzierter AN-Anteil
  let svBrutto = bruttoLohn;
  const isMidijob = user.contractType === 'MIDIJOB' || (bruttoLohn > 538 && bruttoLohn <= 2_000);
  if (isMidijob) {
    // Vereinfachte Gleitzone: AN-Anteil linear reduziert
    // Formel: F × Brutto - (F - 1) × 538 (F = AG-Gesamtbeitrag / Gesamtbeitragssatz ≈ 0.7616)
    const F = 0.7616;
    svBrutto = Math.max(0, F * bruttoLohn - (F - 1) * 538);
  }

  // Arbeitnehmer-Anteile (je 50% der Gesamtbeiträge, außer PV die ggf. abweicht)
  const kvGesamt       = KV_BASIS_RATE + kvZusatzRate;
  const krankenversicherung     = (svBrutto * kvGesamt) / 100 / 2;
  const rentenversicherung      = (svBrutto * RV_RATE) / 100 / 2;
  const arbeitslosenversicherung = (svBrutto * AV_RATE) / 100 / 2;
  const pvRate         = kinder > 0 ? PV_RATE_KINDER : PV_RATE_KINDERLOS;
  const pflegeversicherung      = (svBrutto * pvRate) / 100 / 2;

  // ── Summen ────────────────────────────────────────────────────────────────
  const steuerAbzuege = Math.max(0, lohnsteuer) + soli + kirchensteuer;
  const svAbzuege     = krankenversicherung + rentenversicherung + arbeitslosenversicherung + pflegeversicherung;
  const totalAbzuege  = steuerAbzuege + svAbzuege;
  const netto         = Math.max(0, bruttoLohn - totalAbzuege);

  return {
    brutto:                 bruttoLohn,
    lohnsteuer:             Math.max(0, lohnsteuer),
    soli:                   Math.max(0, soli),
    kirchensteuer:          Math.max(0, kirchensteuer),
    krankenversicherung:    Math.max(0, krankenversicherung),
    rentenversicherung:     Math.max(0, rentenversicherung),
    arbeitslosenversicherung: Math.max(0, arbeitslosenversicherung),
    pflegeversicherung:     Math.max(0, pflegeversicherung),
    totalAbzuege:           Math.max(0, totalAbzuege),
    netto,
    kvZusatzRate,
  };
}
