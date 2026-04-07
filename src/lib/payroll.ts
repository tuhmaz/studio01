
import { User } from './types';

// DISCLAIMER: This is a simplified simulation for demonstration purposes.
// It does not replace a certified payroll accountant.
// These rates are based on 2026 estimates and can vary.

// Social Security Contribution Rates for 2026 (Estimated)
const KV_RATE = 14.6; // Krankenversicherung (Health Insurance)
const ZUSATZBEITRAG_RATE = 1.7; // Average additional contribution
const RV_RATE = 18.6; // Rentenversicherung (Pension Insurance)
const AV_RATE = 2.6; // Arbeitslosenversicherung (Unemployment Insurance)
const PV_RATE_CHILD = 3.4; // Pflegeversicherung (Care Insurance) with children
const PV_RATE_CHILDLESS = 4.0; // Care Insurance for childless over 23

// Income tax calculation is extremely complex. This is a VAST simplification.
// A real implementation would use a progressive tax formula or an API.
const LOHNSTEUER_RATES = {
  1: 0.28, // Class 1: High tax rate
  2: 0.24,
  3: 0.12, // Class 3: Low tax rate (as seen in the example)
  4: 0.22,
  5: 0.35, // Class 5: High tax rate
  6: 0.40, // Class 6: Highest tax rate
};

const SOLI_RATE = 0.055; // Solidaritätszuschlag (Solidarity Surcharge)
// Soli is only due when annual Lohnsteuer exceeds €18,130 (2026 threshold for singles)
const SOLI_ANNUAL_LOHNSTEUER_THRESHOLD = 18130 / 12; // monthly equivalent
const KIRCHENSTEUER_RATES = { // Kirchensteuer (Church Tax)
  'BW': 0.08,
  'BY': 0.08,
  // Most other states are 9%
  'DEFAULT': 0.09,
};

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
}

export function simulatePayroll(user: User, bruttoLohn: number): PayrollResult {
  if (user.contractType === 'MINIJOB' && bruttoLohn <= 603) { // Minijob has different rules
    // Simplified: Employer pays flat tax, employee gets full amount
    return { brutto: bruttoLohn, lohnsteuer: 0, soli: 0, kirchensteuer: 0, krankenversicherung: 0, rentenversicherung: 0, arbeitslosenversicherung: 0, pflegeversicherung: 0, totalAbzuege: 0, netto: bruttoLohn };
  }

  const steuerklasse = user.taxClass || user.steuerklasse || 1;
  const kinder = user.kinder || 0;
  const bundesland = user.bundesland || 'DEFAULT';
  const kirchensteuerpflichtig = user.hasChurchTax ?? user.kirchensteuerpflichtig ?? false;

  // --- 1. Lohnsteuer (Income Tax) ---
  const steuerklasseRate = LOHNSTEUER_RATES[steuerklasse as keyof typeof LOHNSTEUER_RATES] || LOHNSTEUER_RATES[1];
  // Reduce taxable income based on number of children (very simplified!)
  const kinderfreibetragEffect = kinder * 2000; // Simplified reduction
  const steuerpflichtigesEinkommen = Math.max(0, bruttoLohn * 12 - kinderfreibetragEffect) / 12;
  const lohnsteuer = steuerpflichtigesEinkommen * steuerklasseRate;

  // --- 2. Soli & Kirchensteuer (based on Lohnsteuer) ---
  const soli = lohnsteuer > SOLI_ANNUAL_LOHNSTEUER_THRESHOLD ? lohnsteuer * SOLI_RATE : 0;
  const kirchensteuerRate = KIRCHENSTEUER_RATES[bundesland as keyof typeof KIRCHENSTEUER_RATES] || KIRCHENSTEUER_RATES.DEFAULT;
  const kirchensteuer = kirchensteuerpflichtig && lohnsteuer > 0 ? lohnsteuer * kirchensteuerRate : 0;

  // --- 3. Sozialversicherung (Social Security) ---
  let svBrutto = bruttoLohn; // For simplicity, we use the full brutto

  if (user.contractType === 'MIDIJOB' || (bruttoLohn > 603 && bruttoLohn <= 2000)) {
    // Midijob transition zone logic
    // For simplicity, we artificially reduce svBrutto to simulate the reduced employee burden.
    svBrutto = bruttoLohn * 0.8; // Reduced rate (simplified)
  }

  const krankenversicherung = (svBrutto * (KV_RATE + ZUSATZBEITRAG_RATE)) / 100 / 2; // Split 50/50
  const rentenversicherung = (svBrutto * RV_RATE) / 100 / 2;
  const arbeitslosenversicherung = (svBrutto * AV_RATE) / 100 / 2;
  const pflegeversicherungRate = kinder > 0 ? PV_RATE_CHILD : PV_RATE_CHILDLESS;
  const pflegeversicherung = (svBrutto * pflegeversicherungRate) / 100 / 2;

  const steuerAbzuege = lohnsteuer + soli + kirchensteuer;
  const svAbzuege = krankenversicherung + rentenversicherung + arbeitslosenversicherung + pflegeversicherung;
  const totalAbzuege = steuerAbzuege + svAbzuege;
  const netto = bruttoLohn - totalAbzuege;

  return {
    brutto: bruttoLohn,
    lohnsteuer: Math.max(0, lohnsteuer), // Ensure no negative tax
    soli,
    kirchensteuer,
    krankenversicherung,
    rentenversicherung,
    arbeitslosenversicherung,
    pflegeversicherung,
    totalAbzuege,
    netto,
  };
}
