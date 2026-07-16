import { calculate, type LohnsteuerInputs } from 'lohnsteuerrechner';

import { User } from './types';

/**
 * German payroll calculation for the app's monthly payslip.
 *
 * Lohnsteuer/Soli are calculated through the official BMF PAP implementation
 * provided by `lohnsteuerrechner`. Social insurance uses 2026 statutory rates
 * and contribution ceilings for regular statutory employees.
 */

const PAP_YEAR = 2026;

// Sozialversicherung 2026
const KV_BASIS_RATE = 14.6;
const KV_DEFAULT_ZUSATZ = 2.9;
const RV_RATE = 18.6;
const AV_RATE = 2.6;
const PV_BASE_RATE = 3.6;
const PV_CHILDLESS_SURCHARGE = 0.6;
const PV_CHILD_DEDUCTION = 0.25;

const KV_PV_BBG_MONTHLY = 5_812.5;
const RV_AV_BBG_MONTHLY = 8_450;
const MINIJOB_LIMIT_2026 = 603;
const MIDIJOB_LIMIT_2026 = 2_000;

const KIRCHENSTEUER_RATES: Record<string, number> = {
  BW: 0.08,
  BY: 0.08,
  DEFAULT: 0.09,
};

const SAXONY = 'SN';

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
  kvZusatzRate: number;
}

function toCents(value: number): number {
  return Math.max(0, Math.round(value * 100));
}

function fromCents(value: number): number {
  return Math.max(0, value / 100);
}

function clampTaxClass(value: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  return value && value >= 1 && value <= 6 ? (value as 1 | 2 | 3 | 4 | 5 | 6) : 1;
}

function normalizeBundesland(value: string | undefined): string {
  return (value || 'ST').trim().toUpperCase();
}

function getPflegeChildDeductions(kinder: number): number {
  return Math.min(4, Math.max(0, Math.floor(kinder) - 1));
}

function getEmployeePvRate(kinder: number, bundesland: string): number {
  const baseEmployeeRate = bundesland === SAXONY ? 2.3 : PV_BASE_RATE / 2;

  if (kinder <= 0) {
    return baseEmployeeRate + PV_CHILDLESS_SURCHARGE;
  }

  return Math.max(0, baseEmployeeRate - getPflegeChildDeductions(kinder) * PV_CHILD_DEDUCTION);
}

function calculateOfficialTaxes(params: {
  bruttoLohn: number;
  steuerklasse: 1 | 2 | 3 | 4 | 5 | 6;
  kinder: number;
  bundesland: string;
  kirchenpflichtig: boolean;
  kvZusatzRate: number;
}): { lohnsteuer: number; soli: number; kirchensteuer: number } {
  const { bruttoLohn, steuerklasse, kinder, bundesland, kirchenpflichtig, kvZusatzRate } = params;
  const churchTaxRate = KIRCHENSTEUER_RATES[bundesland] ?? KIRCHENSTEUER_RATES.DEFAULT;

  const inputs: LohnsteuerInputs = {
    LZZ: 2,
    RE4: toCents(bruttoLohn),
    STKL: steuerklasse,
    KVZ: kvZusatzRate,
    PKV: 0,
    KRV: 0,
    ALV: 0,
    PVS: bundesland === SAXONY ? 1 : 0,
    PVZ: kinder > 0 ? 0 : 1,
    PVA: getPflegeChildDeductions(kinder),
    R: kirchenpflichtig ? 1 : 0,
    ZKF: steuerklasse === 5 || steuerklasse === 6 ? 0 : Math.max(0, kinder),
  };

  const result = calculate(PAP_YEAR, inputs);
  const lohnsteuer = fromCents(result.LSTLZZ);
  const soli = fromCents(result.SOLZLZZ);
  const kirchensteuer = kirchenpflichtig ? fromCents(result.BK) * churchTaxRate : 0;

  return { lohnsteuer, soli, kirchensteuer };
}

export function simulatePayroll(user: User, bruttoLohn: number): PayrollResult {
  const brutto = Math.max(0, Number(bruttoLohn) || 0);

  if (user.contractType === 'MINIJOB' && brutto <= MINIJOB_LIMIT_2026) {
    return {
      brutto,
      lohnsteuer: 0,
      soli: 0,
      kirchensteuer: 0,
      krankenversicherung: 0,
      rentenversicherung: 0,
      arbeitslosenversicherung: 0,
      pflegeversicherung: 0,
      totalAbzuege: 0,
      netto: brutto,
      kvZusatzRate: 0,
    };
  }

  const steuerklasse = clampTaxClass(user.taxClass ?? user.steuerklasse);
  const kinder = Math.max(0, Number(user.kinder ?? 0) || 0);
  const bundesland = normalizeBundesland(user.bundesland);
  const kirchenpflichtig = user.hasChurchTax ?? user.kirchensteuerpflichtig ?? false;
  const kvZusatzRate = Number(user.kvZusatzRate ?? KV_DEFAULT_ZUSATZ) || KV_DEFAULT_ZUSATZ;

  const { lohnsteuer, soli, kirchensteuer } = calculateOfficialTaxes({
    bruttoLohn: brutto,
    steuerklasse,
    kinder,
    bundesland,
    kirchenpflichtig,
    kvZusatzRate,
  });

  let svBrutto = brutto;
  const isMidijob = user.contractType === 'MIDIJOB' || (brutto > MINIJOB_LIMIT_2026 && brutto <= MIDIJOB_LIMIT_2026);
  if (isMidijob) {
    // Transitional area approximation. The exact Midijob formula depends on the
    // full annual social-insurance parameters and should be moved to a dedicated SV module.
    const F = 0.7616;
    svBrutto = Math.max(0, F * brutto - (F - 1) * MINIJOB_LIMIT_2026);
  }

  const kvPvBase = Math.min(svBrutto, KV_PV_BBG_MONTHLY);
  const rvAvBase = Math.min(svBrutto, RV_AV_BBG_MONTHLY);
  const kvGesamt = KV_BASIS_RATE + kvZusatzRate;

  const krankenversicherung = (kvPvBase * kvGesamt) / 100 / 2;
  const rentenversicherung = (rvAvBase * RV_RATE) / 100 / 2;
  const arbeitslosenversicherung = (rvAvBase * AV_RATE) / 100 / 2;
  const pflegeversicherung = (kvPvBase * getEmployeePvRate(kinder, bundesland)) / 100;

  const steuerAbzuege = lohnsteuer + soli + kirchensteuer;
  const svAbzuege = krankenversicherung + rentenversicherung + arbeitslosenversicherung + pflegeversicherung;
  const totalAbzuege = Math.max(0, steuerAbzuege + svAbzuege);
  const netto = Math.max(0, brutto - totalAbzuege);

  return {
    brutto,
    lohnsteuer,
    soli,
    kirchensteuer,
    krankenversicherung: Math.max(0, krankenversicherung),
    rentenversicherung: Math.max(0, rentenversicherung),
    arbeitslosenversicherung: Math.max(0, arbeitslosenversicherung),
    pflegeversicherung: Math.max(0, pflegeversicherung),
    totalAbzuege,
    netto,
    kvZusatzRate,
  };
}
