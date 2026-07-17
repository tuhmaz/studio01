/**
 * PDF Export: Arbeitszeitnachweis & Lohnzettel
 * Abrechnungszeitraum: 21. des Vormonats — 20. des aktuellen Monats
 *
 * Zwei separate Dokumente:
 *  - generateArbeitszeitnachweis(): Stundennachweis (keine Geldbeträge)
 *  - generateLohnzettel():          Lohn-/Gehaltsabrechnung (keine Tagesliste)
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { simulatePayroll } from './payroll';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LohnExportEntry {
  date: string;               // ISO date of clock-in
  clockIn: string;            // ISO datetime
  clockOut: string;           // ISO datetime
  workMinutes: number;
  siteName: string;
  siteAddress: string;
  region: string;
  isRemote: boolean;
  distanceKm: number;
  travelBonusMinutes: number; // 60 if remote, else 0
  categories: string[];
}

export interface LohnExportWorker {
  id: string;
  name: string;
  contractType?: string;
  hourlyRate?: number;
  monthlyTargetHours?: number;
  taxClass?: number;
  hasChurchTax?: boolean;
  kinder?: number;
  svNr?: string;
  steuerId?: string;
  statusTaetigkeit?: string;
  kvZusatzRate?: number;
  signatureData?: string; // base64 PNG data-URL (nach SVG→PNG Konvertierung im Browser)
}

export interface CompanySettings {
  name: string;
  siteName?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  taxNumber?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoData?: string; // base64 data-URL
}

export interface LohnExportParams {
  worker: LohnExportWorker;
  entries: LohnExportEntry[];
  month: number;  // 0-based JS month
  year: number;
  /** @deprecated use company.name */
  companyName?: string;
  company?: CompanySettings;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const WEEKDAY_SHORT_DE = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

const CONTRACT_LABELS: Record<string, string> = {
  VOLLZEIT: 'Vollzeit',
  TEILZEIT: 'Teilzeit',
  MINIJOB:  'Minijob',
  MIDIJOB:  'Midijob',
};

const OVERTIME_RATE = 1.25;

const PRIMARY  = [0, 51, 102]    as [number, number, number]; // Dark blue - German official color
const LIGHT_BG = [248, 249, 250] as [number, number, number]; // Light gray background
const BORDER   = [200, 200, 200] as [number, number, number]; // Standard gray border

type PdfChromeTheme = {
  background: [number, number, number];
  accent: [number, number, number];
  primaryText: [number, number, number];
  secondaryText: [number, number, number];
  tertiaryText: [number, number, number];
  separator: [number, number, number];
};

const DEFAULT_CHROME_THEME: PdfChromeTheme = {
  background: PRIMARY,
  accent: [0, 30, 70],
  primaryText: [255, 255, 255],
  secondaryText: [200, 215, 240],
  tertiaryText: [160, 185, 220],
  separator: [0, 30, 70],
};

const PRINT_LIGHT_CHROME_THEME: PdfChromeTheme = {
  background: [241, 243, 245],
  accent: [154, 164, 178],
  primaryText: [31, 41, 51],
  secondaryText: [79, 91, 107],
  tertiaryText: [104, 116, 132],
  separator: [190, 196, 204],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0'); }

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtHHMM(minutes: number): string {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function fmtCurrency(val: number): string {
  return Number(val).toFixed(2).replace('.', ',') + ' €';
}

function getBillingPeriod(month: number, year: number) {
  let startMonth = month - 1;
  let startYear = year;
  if (startMonth < 0) { startMonth = 11; startYear = year - 1; }
  const start = new Date(startYear, startMonth, 21);
  const end   = new Date(year, month, 20);
  const label = `21. ${MONTH_NAMES_DE[startMonth]} ${startYear} – 20. ${MONTH_NAMES_DE[month]} ${year}`;
  return { start, end, label };
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function isInBillingPeriod(entry: LohnExportEntry, start: Date, end: Date): boolean {
  const value = entry.date.split('T')[0];
  return value >= dateKey(start) && value <= dateKey(end);
}

function fmtPeriodRange(start: Date, end: Date): string {
  return `${pad2(start.getDate())}.${pad2(start.getMonth() + 1)}.${start.getFullYear()} - ${pad2(end.getDate())}.${pad2(end.getMonth() + 1)}.${end.getFullYear()}`;
}

function fmtDateKey(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function getWeekdayFromDateKey(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return WEEKDAY_SHORT_DE[new Date(year, month - 1, day).getDay()];
}



// ─── Shared PDF utilities ─────────────────────────────────────────────────────

function makeDoc() {
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
}

const W      = 210;
const MARGIN = 8; // Reduced margin for better space utilization
const CW     = W - MARGIN * 2; // content width

function fillRect(doc: jsPDF, x: number, y: number, w: number, h: number, rgb: [number,number,number]) {
  doc.setFillColor(...rgb);
  doc.rect(x, y, w, h, 'F');
}

/**
 * Zeichnet ein Unterschrift-Bild in eine Bounding-Box, unter Beibehaltung des
 * Originalseitenverhältnisses (SignaturPad: 340 × 160 px → Ratio 2.125 : 1).
 */
function addSignatureImage(
  doc: jsPDF, dataUrl: string,
  boxX: number, boxY: number, boxW: number, boxH: number,
) {
  const RATIO = 340 / 160; // PAD_W / PAD_H — Breite ist 2.125× die Höhe
  // Berechne größtmögliche Größe, die in die Box passt
  let imgH = Math.min(boxH, boxW / RATIO);
  let imgW = imgH * RATIO;
  // Zentriert in der Box
  const ox = (boxW - imgW) / 2;
  const oy = (boxH - imgH) / 2;
  try {
    doc.addImage(dataUrl, 'PNG', boxX + ox, boxY + oy, imgW, imgH);
  } catch { /* Bild nicht verfügbar */ }
}

/** Height of the page header band in mm — used by callers to position content below */
const HEADER_H = 32;
const ARBEITSZEIT_HEADER_H = 22;

function drawHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  monthLabel: string,
  _periodLabel: string,
  company: CompanySettings,
  theme: PdfChromeTheme = DEFAULT_CHROME_THEME,
) {
  fillRect(doc, 0, 0, W, HEADER_H, theme.background);

  // ── Thin accent stripe at the bottom of the header ──
  fillRect(doc, 0, HEADER_H - 1.5, W, 1.5, theme.accent);

  doc.setTextColor(...theme.primaryText);

  // ── LOGO (top-left, if provided) ─────────────────────────────────────────
  const LOGO_W = 20;
  const LOGO_H = 20;
  const textStartX = MARGIN;
  let textOffsetX = 0;

  if (company.logoData) {
    try {
      // Determine format from data URL prefix; default to JPEG
      const fmt = company.logoData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(company.logoData, fmt, MARGIN, 5, LOGO_W, LOGO_H);
      textOffsetX = LOGO_W + 3;
    } catch {
      // Logo failed to render — continue without it
    }
  }

  // ── LEFT block: company identity ─────────────────────────────────────────
  let ly = 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(company.name.toUpperCase(), textStartX + textOffsetX, ly);
  ly += 6.5;

  const addrLine = [
    company.address,
    [company.postalCode, company.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(' · ');
  if (addrLine) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...theme.secondaryText);
    doc.text(addrLine, textStartX + textOffsetX, ly);
    ly += 5;
  }

  const contactLine = [company.phone, company.email].filter(Boolean).join('  ·  ');
  if (contactLine) {
    doc.setFontSize(7);
    doc.setTextColor(...theme.secondaryText);
    doc.text(contactLine, textStartX + textOffsetX, ly);
    ly += 5;
  }

  if (company.taxNumber) {
    doc.setFontSize(7);
    doc.setTextColor(...theme.tertiaryText);
    doc.text(`St.-Nr.: ${company.taxNumber}`, textStartX + textOffsetX, ly);
  }

  // ── RIGHT block: document title + month (right-aligned) ─────────────────
  const rx = W - MARGIN;

  // Month label (top-right, large)
  doc.setTextColor(...theme.primaryText);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(monthLabel, rx, 10, { align: 'right' });

  // Document title
  doc.setFontSize(11);
  doc.text(title, rx, 18, { align: 'right' });

  // Subtitle (billing period)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...theme.secondaryText);
  doc.text(subtitle, rx, 25, { align: 'right' });
}

function drawFooter(
  doc: jsPDF,
  company: CompanySettings,
  workerName: string,
  periodLabel: string,
  theme: PdfChromeTheme = DEFAULT_CHROME_THEME,
) {
  // Footer band: 14mm tall, starts at y=283 (ends at y=297, within A4 297mm)
  const FY = 283;
  fillRect(doc, 0, FY, W, 14, theme.background);

  // Thin separator line between the two footer rows
  doc.setDrawColor(...theme.separator);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, FY + 7, W - MARGIN, FY + 7);

  doc.setTextColor(...theme.primaryText);
  doc.setFont('helvetica', 'normal');

  // ── Row 1: company name + website  |  page number ──
  doc.setFontSize(7.5);
  const leftText = [company.name, company.website].filter(Boolean).join('  ·  ');
  doc.text(leftText, MARGIN, FY + 5);
  doc.text('Seite 1', W - MARGIN, FY + 5, { align: 'right' });

  // ── Row 2: creation date · worker · period (centered, slightly dimmed) ──
  doc.setFontSize(6.5);
  doc.setTextColor(...theme.secondaryText);
  const centerText = `Erstellt: ${new Date().toLocaleDateString('de-DE')}  ·  ${workerName}  ·  ${periodLabel}`;
  doc.text(centerText, W / 2, FY + 12, { align: 'center' });
}

function drawArbeitszeitHeader(
  doc: jsPDF,
  monthLabel: string,
  periodRange: string,
  company: CompanySettings,
) {
  fillRect(doc, 0, 0, W, ARBEITSZEIT_HEADER_H, PRINT_LIGHT_CHROME_THEME.background);
  fillRect(doc, 0, ARBEITSZEIT_HEADER_H - 1.1, W, 1.1, PRINT_LIGHT_CHROME_THEME.accent);

  const logoSize = 13;
  let textOffsetX = 0;
  if (company.logoData) {
    try {
      const fmt = company.logoData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(company.logoData, fmt, MARGIN, 4, logoSize, logoSize);
      textOffsetX = logoSize + 3;
    } catch {
      textOffsetX = 0;
    }
  }

  const leftX = MARGIN + textOffsetX;
  doc.setTextColor(...PRINT_LIGHT_CHROME_THEME.primaryText);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.6);
  doc.text((company.name || '').toUpperCase(), leftX, 7.5);

  const companyLine = [
    company.address,
    [company.postalCode, company.city].filter(Boolean).join(' '),
    company.email,
  ].filter(Boolean).join('  |  ');
  if (companyLine) {
    doc.setTextColor(...PRINT_LIGHT_CHROME_THEME.secondaryText);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    doc.text(companyLine, leftX, 12.5, { maxWidth: 108 });
  }

  const rightX = W - MARGIN;
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('ARBEITSZEITNACHWEIS', rightX, 7.5, { align: 'right' });

  doc.setTextColor(75, 88, 104);
  doc.setFontSize(7);
  doc.text(monthLabel, rightX, 12.5, { align: 'right' });

  doc.setTextColor(92, 104, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(`Zeitraum: ${periodRange}`, rightX, 17, { align: 'right' });
}

// ─── 1. ARBEITSZEITNACHWEIS ───────────────────────────────────────────────────
//     Stundennachweis ohne Geldbeträge

export function generateArbeitszeitnachweis(params: LohnExportParams) {
  const { worker, month, year } = params;
  const company: CompanySettings = params.company ?? { name: params.companyName ?? 'Meine Firma' };

  const { start: periodStart, end: periodEnd, label: periodLabel } = getBillingPeriod(month, year);
  const periodRange = fmtPeriodRange(periodStart, periodEnd);
  const entries = params.entries
    .filter(entry => isInBillingPeriod(entry, periodStart, periodEnd))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const doc = makeDoc();
  const monthLabel = `${MONTH_NAMES_DE[month].toUpperCase()} ${year}`;

  // ── Header ──
  drawArbeitszeitHeader(doc, monthLabel, periodRange, company);

  // ── Employee info box (no financial data) ──
  let y = ARBEITSZEIT_HEADER_H + 3;
  fillRect(doc, MARGIN, y, CW, 10, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, CW, 10);

  // Group entries by date
  const groupedEntriesMap = new Map<string, {
    dateKey: string;
    date: string;
    siteNames: Set<string>;
    regions: Set<string>;
    categories: Set<string>;
    clockIn: string;
    clockOut: string;
    workMinutes: number;
    travelBonusMinutes: number;
  }>();

  entries.forEach(e => {
    const d = e.date.split('T')[0];
    if (!groupedEntriesMap.has(d)) {
      groupedEntriesMap.set(d, {
        dateKey: d,
        date: e.date, // keep original for display if needed, but wait, fmtDate might expect a valid date string. Let's just use e.date or d
        siteNames: new Set(e.siteName || e.siteAddress
          ? [e.siteAddress ? `${e.siteName} - ${e.siteAddress}` : e.siteName]
          : []),
        regions: new Set(e.region ? [e.region] : []),
        categories: new Set(e.categories),
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        workMinutes: e.workMinutes,
        travelBonusMinutes: Math.max(-60, e.travelBonusMinutes),
      });
    } else {
      const g = groupedEntriesMap.get(d)!;
      if (e.siteName || e.siteAddress) g.siteNames.add(e.siteAddress ? `${e.siteName} - ${e.siteAddress}` : e.siteName);
      if (e.region) g.regions.add(e.region);
      e.categories.forEach(c => g.categories.add(c));

      // Update earliest clockIn and latest clockOut
      if (new Date(e.clockIn) < new Date(g.clockIn)) g.clockIn = e.clockIn;
      if (new Date(e.clockOut) > new Date(g.clockOut)) g.clockOut = e.clockOut;

      g.workMinutes += e.workMinutes;
      // Maximal -60 Minuten Fahrtabzug pro Tag (unabhaengig von Anzahl der Standorte)
      g.travelBonusMinutes = Math.max(-60, g.travelBonusMinutes + e.travelBonusMinutes);
    }
  });

  const groupedEntries = Array.from(groupedEntriesMap.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const MIN_ROWS = 14;
  const rowCount = Math.max(groupedEntries.length, MIN_ROWS);
  const compactLayout = rowCount >= 24;
  const balancedLayout = rowCount >= 18;
  const rowHeight = balancedLayout
    ? Math.max(6.6, Math.min(8.2, (194 / rowCount)))
    : 0;
  const bodyFontSize = compactLayout ? 6.7 : balancedLayout ? 7.2 : 8;
  const bodyPadding = compactLayout ? 0.85 : balancedLayout ? 1.15 : 2;
  const objectFontSize = compactLayout ? 6.3 : balancedLayout ? 6.9 : 7.5;
  const categoryFontSize = compactLayout ? 6.1 : balancedLayout ? 6.6 : 6.5;

  // Summen aus gruppierten Einträgen — korrekt auf max -60 Min/Tag begrenzt
  const totalWorkMin  = groupedEntries.reduce((s, e) => s + e.workMinutes, 0);
  const totalBonusMin = groupedEntries.reduce((s, e) => s + e.travelBonusMinutes, 0);
  const totalMin      = totalWorkMin + totalBonusMin;

  const fields: Array<{ label: string; value: string }> = [
    { label: 'MITARBEITER', value: worker.name },
    { label: 'ZEITRAUM', value: periodRange },
    { label: 'ARBEITSTAGE', value: String(groupedEntries.length) },
    { label: 'GESAMT ARBEIT', value: `${fmtHHMM(totalWorkMin)} Std.` },
  ];
  fields.forEach((f, i) => {
    const x = MARGIN + 3 + i * (CW / 4);
    doc.setTextColor(80, 90, 110);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(`${f.label}:`, x, y + 6.5);
    const labelW = doc.getTextWidth(`${f.label}: `);
    doc.setTextColor(...PRIMARY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text(f.value, x + labelW, y + 6.5, {
      maxWidth: (CW / 4) - labelW - 4,
    });
  });

  y += balancedLayout ? 12 : 14;

  // ── Table ──
  const tableHead = [[
    { content: 'Nr.',             styles: { halign: 'center' as const } },
    { content: 'Datum',           styles: { halign: 'center' as const } },
    { content: 'Tag',             styles: { halign: 'center' as const } },
    { content: 'Objekt / Adresse', styles: { halign: 'left' as const } },
    { content: 'Tätigkeiten',     styles: { halign: 'left' as const } },
    { content: compactLayout ? 'Von' : 'Beginn', styles: { halign: 'center' as const } },
    { content: compactLayout ? 'Bis' : 'Ende', styles: { halign: 'center' as const } },
    { content: compactLayout ? 'Arb.' : 'Std.', styles: { halign: 'center' as const } },
    { content: compactLayout ? 'Fahrt' : 'Fahrtzt.', styles: { halign: 'center' as const } },
    { content: compactLayout ? 'Signatur' : 'Unterschrift', styles: { halign: 'center' as const } },
  ]];

  const tableBody: any[] = groupedEntries.map((e, idx) => {
    const siteStr = Array.from(e.siteNames)
      .map(site => site.replace(/Ø=ÜÍ\s*LR-\s*\d+/g, '').replace(/Ø=ÜÍ\s*LR\s*-\s*\d+/g, '').replace(/Ø=ÜÍ/g, '').replace(/LR\s*-\s*\d+/g, '').trim())
      .filter(Boolean)
      .join(compactLayout ? ', ' : '\n') || '—';
      const objStr = siteStr;
      // Join categories with a comma and space instead of newline to save vertical space
      const catStr = e.categories.size > 0 ? Array.from(e.categories).join(', ') : '—';

    return [
      { content: String(idx + 1), styles: { halign: 'center' as const, textColor: [110,120,140] as [number,number,number] } },
      { content: fmtDateKey(e.dateKey), styles: { halign: 'center' as const } },
      { content: getWeekdayFromDateKey(e.dateKey), styles: { halign: 'center' as const } },
      {
        content: objStr,
        styles: {
          fontSize: objectFontSize,
          cellPadding: bodyPadding,
          overflow: compactLayout ? 'ellipsize' as const : 'linebreak' as const,
        },
      },
      {
        content: catStr,
        styles: {
          fontSize: categoryFontSize,
          textColor: [60, 80, 120] as [number,number,number],
          cellPadding: bodyPadding,
          overflow: compactLayout ? 'ellipsize' as const : 'linebreak' as const,
        },
      },
      { content: fmtTime(e.clockIn),  styles: { halign: 'center' as const, fontStyle: 'bold' as const } },
      { content: fmtTime(e.clockOut), styles: { halign: 'center' as const, fontStyle: 'bold' as const } },
      {
        content: fmtHHMM(e.workMinutes),
        styles: { halign: 'center' as const, fontStyle: 'bold' as const, textColor: PRIMARY },
      },
      {
        content: (e.travelBonusMinutes ?? 0) !== 0 ? `-${fmtHHMM(Math.abs(e.travelBonusMinutes))}` : '—',
        styles: {
          halign: 'center' as const,
          textColor: (e.travelBonusMinutes ?? 0) !== 0 ? ([180, 40, 40] as [number,number,number]) : ([160,165,175] as [number,number,number]),
          fontStyle: (e.travelBonusMinutes ?? 0) !== 0 ? 'bold' as const : 'normal' as const,
        },
      },
      { content: '', styles: { halign: 'center' as const } }, // Unterschrift
    ];
  });

  // Filler rows up to MIN_ROWS
  while (tableBody.length < MIN_ROWS) {
    tableBody.push(
      Array(10).fill(null).map((_, i) =>
        ({ content: '', styles: { halign: (i === 0 || i >= 5) ? 'center' as const : 'left' as const } })
      )
    );
  }

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: CW,
    styles: {
      font: 'helvetica',
      fontSize: bodyFontSize,
      cellPadding: bodyPadding,
      lineColor: BORDER,
      lineWidth: 0.15,
      overflow: compactLayout ? 'ellipsize' : 'linebreak',
      minCellHeight: balancedLayout ? rowHeight : 0,
    },
    headStyles: {
      fillColor: PRIMARY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: compactLayout ? 6.7 : balancedLayout ? 7.2 : 8,
      halign: 'center',
      cellPadding: compactLayout ? 1 : balancedLayout ? 1.25 : 2,
    },
    alternateRowStyles: { fillColor: [250, 251, 255] },
    columnStyles: {
        0: { cellWidth: 7,  halign: 'center' },  // Nr.
        1: { cellWidth: 18, halign: 'center' },  // Datum
        2: { cellWidth: 9,  halign: 'center' },  // Tag
        3: { cellWidth: 46 },                    // Objekt / Adresse
        4: { cellWidth: 39 },                    // Tätigkeiten
        5: { cellWidth: 13, halign: 'center' },  // Beginn
        6: { cellWidth: 13, halign: 'center' },  // Ende
        7: { cellWidth: 13, halign: 'center' },  // Std.
        8: { cellWidth: 12, halign: 'center' },  // Fahrtzt.
        9: { cellWidth: 24, halign: 'center' },  // Unterschrift
      },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index >= groupedEntries.length) {
        data.cell.styles.fillColor = [248, 249, 252];
        data.cell.styles.textColor = [210, 215, 225];
      }
    },
    didDrawCell: (data) => {
      // Unterschrift-Spalte (Index 9) — Signatur in jede Zeile einzeichnen
      if (
        data.section === 'body' &&
        data.column.index === 9 &&
        data.row.index < groupedEntries.length &&
        worker.signatureData
      ) {
        const { x, y, width, height } = data.cell;
        addSignatureImage(doc, worker.signatureData, x + 1, y + 0.5, width - 2, height - 1);
      }
    },
  });

  // ── Summary (hours only, no money) ──
  const finalY = (doc as any).lastAutoTable.finalY as number;
  const summaryH = compactLayout ? 28 : 34;
  let sy = finalY + (compactLayout ? 2 : 6);
  if (sy + summaryH > 283) { doc.addPage(); sy = 20; }

  fillRect(doc, MARGIN, sy, CW, summaryH, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, sy, CW, summaryH);

  // Section title line
  doc.setDrawColor(...BORDER);
  doc.line(MARGIN, sy + 8, MARGIN + CW, sy + 8);

  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compactLayout ? 7.2 : 8);
  doc.text('STUNDEN-ZUSAMMENFASSUNG', MARGIN + 5, sy + 5.8);

  // Vertical dividers
  const col2x = MARGIN + CW * 0.38;
  const col3x = MARGIN + CW * 0.66;
  doc.line(col2x, sy + 1, col2x, sy + summaryH);
  doc.line(col3x, sy + 1, col3x, sy + summaryH);

  // Left column
  const rowH = compactLayout ? 4.7 : 5.8;
  let ry = sy + (compactLayout ? 12 : 14);
  const drawSummaryRow = (label: string, value: string, x: number, colW: number, accent?: [number,number,number]) => {
    doc.setTextColor(80, 95, 115);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(compactLayout ? 6.3 : 7.2);
    doc.text(label, x + 4, ry);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compactLayout ? 7.2 : 8.2);
    doc.setTextColor(...(accent ?? PRIMARY));
    doc.text(value, x + colW - 4, ry, { align: 'right' });
  };

  const colW1 = col2x - MARGIN;
  const colW2 = col3x - col2x;
  const colW3 = MARGIN + CW - col3x;

  drawSummaryRow('Reine Arbeitszeit:', fmtHHMM(totalWorkMin) + ' Std.', MARGIN, colW1);
  ry += rowH;
  if (totalBonusMin !== 0) {
    drawSummaryRow('Fahrtabzug (Fernstandorte):', `-${fmtHHMM(Math.abs(totalBonusMin))} Std.`, MARGIN, colW1, [180, 40, 40]);
    ry += rowH;
  }
  drawSummaryRow('Vergütete Zeit (netto):', fmtHHMM(totalMin) + ' Std.', MARGIN, colW1);

  // Middle column
  ry = sy + (compactLayout ? 12 : 14);
  drawSummaryRow('Sollstunden / Monat:', `${worker.monthlyTargetHours ?? 0} Std.`, col2x, colW2);
  ry += rowH;
  const overtimeMin = Math.max(0, totalMin - (worker.monthlyTargetHours ?? 0) * 60);
  drawSummaryRow('Reguläre Stunden:', fmtHHMM(totalMin - overtimeMin) + ' Std.', col2x, colW2);
  ry += rowH;
  drawSummaryRow('Überstunden:', fmtHHMM(overtimeMin) + ' Std.', col2x, colW2, [160, 50, 50]);

  // Right column: signature
  ry = sy + (compactLayout ? 10 : 11.5);
  doc.setTextColor(80, 95, 115);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(compactLayout ? 5.8 : 6.5);
  doc.text('Ort / Datum:', col3x + 4, ry);
  doc.setDrawColor(...BORDER);
  doc.line(col3x + 4, ry + (compactLayout ? 4 : 4.8), col3x + colW3 - 6, ry + (compactLayout ? 4 : 4.8));
  ry += compactLayout ? 8.4 : 10.5;
  doc.text('Unterschrift Mitarbeiter:', col3x + 4, ry);
  // Digitale Unterschrift — Seitenverhältnis beibehalten
  if (worker.signatureData) {
    addSignatureImage(doc, worker.signatureData, col3x + 4, ry + 0.5, colW3 - 10, compactLayout ? 6.5 : 8);
  }
  doc.line(col3x + 4, ry + (compactLayout ? 8 : 10), col3x + colW3 - 6, ry + (compactLayout ? 8 : 10));

  drawFooter(doc, company, worker.name, periodLabel, PRINT_LIGHT_CHROME_THEME);

  const safeName = worker.name.replace(/\s+/g, '_');
  const monthName = new Date(year, month).toLocaleString('de-DE', { month: 'long' });
  const fileName = `${safeName}_${monthName}_${year}_ARBEITSZEIT.pdf`;
  
  doc.setProperties({
    title: fileName,
    subject: 'Arbeitszeitnachweis',
    author: company.name,
  });

  const blobUrl = URL.createObjectURL(doc.output('blob'));
  return `${blobUrl}#filename=${encodeURIComponent(fileName)}`;
}

// ─── 2. LOHNZETTEL ───────────────────────────────────────────────────────────
//     Gehaltsabrechnung ohne Tagesliste

export function generateLohnzettel(params: LohnExportParams) {
  const { worker, month, year } = params;
  const company: CompanySettings = params.company ?? { name: params.companyName ?? 'Meine Firma' };

  const { label: periodLabel } = getBillingPeriod(month, year);
  const entries = params.entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Group entries by date first
  const groupedEntriesMap = new Map<string, {
    date: string;
    siteNames: Set<string>;
    siteAddresses: Set<string>;
    workMinutes: number;
    travelBonusMinutes: number;
    isRemote: boolean;
  }>();

  entries.forEach(e => {
    const d = e.date.split('T')[0];
    if (!groupedEntriesMap.has(d)) {
      groupedEntriesMap.set(d, {
        date: e.date,
        siteNames: new Set(e.siteName ? [e.siteName] : []),
        siteAddresses: new Set(e.siteAddress ? [e.siteAddress] : []),
        workMinutes: e.workMinutes,
        travelBonusMinutes: Math.max(-60, e.travelBonusMinutes),
        isRemote: e.isRemote,
      });
    } else {
      const g = groupedEntriesMap.get(d)!;
      if (e.siteName) g.siteNames.add(e.siteName);
      if (e.siteAddress) g.siteAddresses.add(e.siteAddress);
      g.workMinutes += e.workMinutes;
      // Maximal -60 Minuten Fahrtabzug pro Tag
      g.travelBonusMinutes = Math.max(-60, g.travelBonusMinutes + e.travelBonusMinutes);
      g.isRemote = g.isRemote || e.isRemote;
    }
  });

  const groupedEntries = Array.from(groupedEntriesMap.values());

  // ── Totals — aus gruppierten Einträgen (max -60 Min/Tag bereits angewendet) ──
  const totalWorkMin    = groupedEntries.reduce((s, e) => s + e.workMinutes, 0);
  const totalBonusMin   = groupedEntries.reduce((s, e) => s + e.travelBonusMinutes, 0);
  const totalBillable   = totalWorkMin + totalBonusMin;
  const targetMin       = (worker.monthlyTargetHours ?? 0) * 60;
  const overtimeMin     = targetMin > 0 ? Math.max(0, totalBillable - targetMin) : 0;
  const regularMin      = totalBillable - overtimeMin;
  const hourlyRate      = worker.hourlyRate ?? 15;
  const regularPay      = (regularMin  / 60) * hourlyRate;
  const overtimePay     = (overtimeMin / 60) * hourlyRate * OVERTIME_RATE;
  const bruttoTotal     = regularPay + overtimePay;

  // Per-site aggregation with the same daily cap used by Arbeitszeitnachweis.
  const siteMap = new Map<string, { name: string; address: string; visits: number; minutes: number; travelBonusMinutes: number }>();
  const remoteMinutesBySiteAndDay = new Map<string, number>();

  const siteVisitsPerDay = new Set<string>();

  entries.forEach(e => {
    const day    = e.date.split('T')[0];
    const key    = e.siteName || e.siteAddress || '?';
    const dayKey = `${day}-${key}`;
    const existing = siteMap.get(key);

    if (existing) {
      if (!siteVisitsPerDay.has(dayKey)) {
        existing.visits += 1;
        siteVisitsPerDay.add(dayKey);
      }
      existing.minutes += e.workMinutes;
    } else {
      siteMap.set(key, {
        name: e.siteName, address: e.siteAddress,
        visits: 1, minutes: e.workMinutes,
        travelBonusMinutes: 0,
      });
      siteVisitsPerDay.add(dayKey);
    }

    if (e.travelBonusMinutes !== 0) {
      const shareKey = `${day}__${key}`;
      remoteMinutesBySiteAndDay.set(shareKey, (remoteMinutesBySiteAndDay.get(shareKey) ?? 0) + e.workMinutes);
    }
  });

  groupedEntries.forEach(dayEntry => {
    if (dayEntry.travelBonusMinutes === 0) return;
    const day = dayEntry.date.split('T')[0];
    const siteShares = Array.from(siteMap.entries())
      .map(([key, site]) => ({
        key,
        minutes: remoteMinutesBySiteAndDay.get(`${day}__${key}`) ?? 0,
        site,
      }))
      .filter(item => item.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);

    if (!siteShares.length) return;
    const totalRemoteMinutes = siteShares.reduce((sum, item) => sum + item.minutes, 0);
    let distributed = 0;
    siteShares.forEach((item, idx) => {
      const part = idx === siteShares.length - 1
        ? dayEntry.travelBonusMinutes - distributed
        : Math.round((dayEntry.travelBonusMinutes * item.minutes) / totalRemoteMinutes);
      distributed += part;
      item.site.travelBonusMinutes += part;
    });
  });

  const doc = makeDoc();
  const monthLabel = `${MONTH_NAMES_DE[month].toUpperCase()} ${year}`;

  // ── Header ──
  drawHeader(
    doc,
    'LOHN- UND GEHALTSABRECHNUNG',
    `Abrechnungszeitraum: ${periodLabel}`,
    monthLabel,
    '',
    company,
  );

  // ── Employee info box ──
  let y = HEADER_H + 2;
  fillRect(doc, MARGIN, y, CW, 14, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, CW, 14);

  // Row 1
  const infoFields1 = [
    { label: 'MITARBEITER',  value: worker.name },
    { label: 'VERTRAGSART',  value: CONTRACT_LABELS[worker.contractType ?? ''] ?? '—' },
    { label: 'STUNDENSATZ',  value: fmtCurrency(hourlyRate) + '/h' },
    { label: 'SOLLSTUNDEN',  value: `${worker.monthlyTargetHours ?? 0} Std./Mon.` },
  ];
  infoFields1.forEach((f, i) => {
    const x = MARGIN + 3 + i * (CW / 4);
    doc.setTextColor(80, 90, 110);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text(`${f.label}:`, x, y + 5);
    const labelW = doc.getTextWidth(`${f.label}: `);
    doc.setTextColor(...PRIMARY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(f.value, x + labelW, y + 5, { maxWidth: (CW / 4) - labelW - 4 });
  });

  // Row 2
  const infoFields2 = [
    { label: 'STEUERKLASSE', value: `Klasse ${worker.taxClass ?? 1}` },
    { label: 'EINSÄTZE',     value: String(groupedEntries.length) },
    { label: 'BRUTTO-LOHN',  value: fmtCurrency(bruttoTotal) },
    { label: 'MONAT',        value: `${MONTH_NAMES_DE[month]} ${year}` },
  ];
  infoFields2.forEach((f, i) => {
    const x = MARGIN + 3 + i * (CW / 4);
    doc.setTextColor(80, 90, 110);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text(`${f.label}:`, x, y + 11);
    const labelW = doc.getTextWidth(`${f.label}: `);
    if (i === 2) { doc.setTextColor(30, 130, 60); } else { doc.setTextColor(...PRIMARY); }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(f.value, x + labelW, y + 11, { maxWidth: (CW / 4) - labelW - 4 });
  });

  y += 17;

  // ── Site list ──
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('EINSATZ-ÜBERSICHT', MARGIN, y + 4);
  y += 6;

  const siteRows = Array.from(siteMap.values()).sort((a, b) => (b.minutes + b.travelBonusMinutes) - (a.minutes + a.travelBonusMinutes));
  const compactLohnLayout = siteRows.length > 6;
  const siteBody: any[] = siteRows.map((s, i) => [
    { content: String(i + 1), styles: { halign: 'center' as const, textColor: [110,120,140] as [number,number,number] } },
    { content: s.name || s.address || '—', styles: { overflow: 'ellipsize' as const } },
    { content: s.address || '—', styles: { fontSize: compactLohnLayout ? 5.5 : 6.5, textColor: [80,95,115] as [number,number,number], overflow: 'ellipsize' as const } },
    { content: String(s.visits), styles: { halign: 'center' as const, fontStyle: 'bold' as const } },
    { content: fmtHHMM(s.minutes) + ' h', styles: { halign: 'center' as const, fontStyle: 'bold' as const, textColor: PRIMARY } },
    {
      content: s.travelBonusMinutes !== 0 ? `-${fmtHHMM(Math.abs(s.travelBonusMinutes))} h` : '-',
      styles: {
        halign: 'center' as const,
        textColor: s.travelBonusMinutes !== 0 ? ([180, 40, 40] as [number,number,number]) : ([160,165,175] as [number,number,number]),
        fontStyle: s.travelBonusMinutes !== 0 ? 'bold' as const : 'normal' as const,
      },
    },
  ]);

  autoTable(doc, {
    startY: y,
    head: [[
      { content: 'Nr.',     styles: { halign: 'center' as const } },
      { content: 'Objekt' },
      { content: 'Adresse' },
      { content: 'Einsätze', styles: { halign: 'center' as const } },
      { content: 'Stunden',  styles: { halign: 'center' as const } },
      { content: 'Fahrtzt.', styles: { halign: 'center' as const } },
    ]],
    body: siteBody,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: CW,
    styles: {
      font: 'helvetica',
      fontSize: compactLohnLayout ? 5.8 : 6.8,
      cellPadding: compactLohnLayout ? 0.7 : 1.1,
      lineColor: BORDER,
      lineWidth: 0.15,
      overflow: 'ellipsize',
      minCellHeight: compactLohnLayout ? 4.6 : 5.4,
    },
    headStyles: {
      fillColor: PRIMARY,
      textColor: [255,255,255],
      fontStyle: 'bold',
      fontSize: compactLohnLayout ? 5.8 : 6.8,
      cellPadding: compactLohnLayout ? 0.8 : 1.1,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: [250, 251, 255] },
    columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 63 },
        2: { cellWidth: 63 },
        3: { cellWidth: 16, halign: 'center' },
        4: { cellWidth: 22, halign: 'center' },
        5: { cellWidth: 22, halign: 'center' },
      },
  });

  // ── Pay calculation box ──
  const finalY = (doc as any).lastAutoTable.finalY as number;
  const signatureH = 16;
  let sy = finalY + 4;
  const availablePayBoxH = 283 - sy - signatureH - 2;
  const payBoxH = Math.max(68, Math.min(82, availablePayBoxH));
  const tightPayLayout = payBoxH < 78;

  fillRect(doc, MARGIN, sy, CW, payBoxH, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, sy, CW, payBoxH);

  // Dividers
  const midX = MARGIN + CW * 0.5;
  doc.line(midX, sy + 1, midX, sy + payBoxH);
  doc.line(MARGIN, sy + 7, MARGIN + CW, sy + 7);

  // Titles
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text('STUNDEN-AUFSCHLÜSSELUNG', MARGIN + 5, sy + 5.2);
  doc.text('LOHN-BERECHNUNG (SACHSEN-ANHALT)', midX + 5, sy + 5.2);

  const rowH = tightPayLayout ? 4.6 : 5.1;
  const highlightH = tightPayLayout ? 5.8 : 7;
  const nettoH = tightPayLayout ? 7.5 : 9;
  const highlightGap = tightPayLayout ? 1.2 : 1.7;

  // Left: hours
  let ry = sy + 12;
  const drawRow = (label: string, value: string, x: number, colW: number, accent?: [number,number,number], isBoldLabel?: boolean) => {
    doc.setTextColor(80, 95, 115);
    doc.setFont('helvetica', isBoldLabel ? 'bold' : 'normal');
    doc.setFontSize(tightPayLayout ? 6 : 6.4);
    doc.text(label, x + 3, ry);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(tightPayLayout ? 6.8 : 7.2);
    doc.setTextColor(...(accent ?? PRIMARY));
    doc.text(value, x + colW - 3, ry, { align: 'right' });
  };

  const halfW = midX - MARGIN;
  const rightW = MARGIN + CW - midX;

  drawRow('Reine Arbeitszeit:', fmtHHMM(totalWorkMin) + ' Std.', MARGIN, halfW);
  ry += rowH;
  if (totalBonusMin !== 0) {
    drawRow('Fahrtabzug (Fernstandorte):', `-${fmtHHMM(Math.abs(totalBonusMin))} Std.`, MARGIN, halfW, [180, 40, 40]);
    ry += rowH;
  }
  drawRow('Vergütete Zeit (netto):', fmtHHMM(totalBillable) + ' Std.', MARGIN, halfW);
  ry += rowH;
  drawRow('Sollstunden / Monat:', `${worker.monthlyTargetHours ?? 0} Std.`, MARGIN, halfW);
  ry += rowH;
  drawRow('Reguläre Stunden:', fmtHHMM(regularMin) + ' Std.', MARGIN, halfW);
  ry += rowH;
  drawRow(`Überstunden (×${OVERTIME_RATE}):`, fmtHHMM(overtimeMin) + ' Std.', MARGIN, halfW, [160, 50, 50]);

  // Extra employee details
  ry += rowH * 0.8;
  doc.line(MARGIN, ry - 2.4, midX, ry - 2.4);
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.text('MITARBEITER-DETAILS', MARGIN + 4, ry);
  ry += rowH;
  drawRow('SV-Nr.:', worker.svNr || '—', MARGIN, halfW);
  ry += rowH;
  drawRow('Steuer-ID:', worker.steuerId || '—', MARGIN, halfW);
  ry += rowH;
  drawRow('Status / Tätigkeit:', worker.statusTaetigkeit || '—', MARGIN, halfW);
  ry += rowH;
  drawRow('Kinderfreibeträge:', String(worker.kinder ?? 0), MARGIN, halfW);

  // Right: money and deductions
  ry = sy + 12;
  drawRow('Stundensatz:', fmtCurrency(hourlyRate) + '/h', midX, rightW);
  ry += rowH;
  drawRow('Reguläre Vergütung:', fmtCurrency(regularPay), midX, rightW);
  ry += rowH;
  drawRow(`Überstunden-Vergütung (×${OVERTIME_RATE}):`, fmtCurrency(overtimePay), midX, rightW, [160, 50, 50]);
  ry += rowH * highlightGap;

  // Brutto highlight
  fillRect(doc, midX + 2, ry - 4.2, rightW - 4, highlightH, PRIMARY);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text('BRUTTO-LOHN:', midX + 5, ry);
  doc.text(fmtCurrency(bruttoTotal), midX + rightW - 5, ry, { align: 'right' });

  ry += rowH * highlightGap;

  // ── Payroll via simulatePayroll (EStG §32a + korrekte SV-Sätze 2025/2026) ──
  const payroll = simulatePayroll({
    id: '', name: worker.name, email: '', role: 'WORKER' as const,
    contractType: worker.contractType as any,
    hourlyRate:          hourlyRate,
    monthlyTargetHours:  worker.monthlyTargetHours,
    taxClass:            worker.taxClass as any,
    kinder:              worker.kinder,
    hasChurchTax:        worker.hasChurchTax,
    kvZusatzRate:        worker.kvZusatzRate,
    svNr:                worker.svNr,
    steuerId:            worker.steuerId,
  }, bruttoTotal);

  const RED = [160, 50, 50] as [number, number, number];
  const kvPct   = (14.6 + (worker.kvZusatzRate ?? 1.7)).toFixed(2);
  const pvPct   = (worker.kinder ?? 0) > 0 ? '3,4' : '4,0';

  drawRow(`Lohnsteuer (SK ${worker.taxClass ?? 1}):`,   '-' + fmtCurrency(payroll.lohnsteuer),              midX, rightW, RED);
  ry += rowH;
  if (payroll.soli > 0) {
    drawRow('Solidaritätszuschlag:',                    '-' + fmtCurrency(payroll.soli),                    midX, rightW, RED);
    ry += rowH;
  }
  if (payroll.kirchensteuer > 0) {
    drawRow('Kirchensteuer:',                           '-' + fmtCurrency(payroll.kirchensteuer),           midX, rightW, RED);
    ry += rowH;
  }
  drawRow(`KV (${kvPct}%/2 AN):`,                      '-' + fmtCurrency(payroll.krankenversicherung),     midX, rightW, RED);
  ry += rowH;
  drawRow(`PV (${pvPct}%/2 AN):`,                      '-' + fmtCurrency(payroll.pflegeversicherung),      midX, rightW, RED);
  ry += rowH;
  drawRow('RV (18,6%/2 AN):',                          '-' + fmtCurrency(payroll.rentenversicherung),      midX, rightW, RED);
  ry += rowH;
  drawRow('AV (2,6%/2 AN):',                           '-' + fmtCurrency(payroll.arbeitslosenversicherung), midX, rightW, RED);
  ry += rowH;

  // Netto highlight
  fillRect(doc, midX + 2, ry - 2.4, rightW - 4, nettoH, [40, 160, 80]);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.text('NETTO-VERDIENST:', midX + 5, ry + 3.2);
  doc.text(fmtCurrency(payroll.netto), midX + rightW - 5, ry + 3.2, { align: 'right' });

  // ── Signature strip ──
  sy += payBoxH + 2;

  fillRect(doc, MARGIN, sy, CW, signatureH, [252, 252, 255]);
  doc.setDrawColor(...BORDER);
  doc.rect(MARGIN, sy, CW, signatureH);

  const sigCols = 3;
  const sigW = CW / sigCols;
  const sigLabels = ['Ort / Datum', 'Unterschrift Mitarbeiter', 'Unterschrift Vorgesetzter'];
  sigLabels.forEach((label, i) => {
    const x = MARGIN + i * sigW;
    if (i > 0) doc.line(x, sy + 1, x, sy + signatureH);
    doc.setTextColor(80, 95, 115);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    doc.text(label + ':', x + 3, sy + 4.2);
    // Digitale Unterschrift Mitarbeiter (i === 1) — Seitenverhältnis beibehalten, transparent
    if (i === 1 && worker.signatureData) {
      addSignatureImage(doc, worker.signatureData, x + 3, sy + 4.5, sigW - 8, 7.5);
    }
    doc.setDrawColor(...BORDER);
    doc.line(x + 3, sy + 12.5, x + sigW - 5, sy + 12.5);
  });

  drawFooter(doc, company, worker.name, periodLabel);

  const safeName = worker.name.replace(/\s+/g, '_');
  const monthName = new Date(year, month).toLocaleString('de-DE', { month: 'long' });
  const fileName = `${safeName}_${monthName}_${year}_LOHNZETTEL.pdf`;
  
  doc.setProperties({
    title: fileName,
    subject: 'Lohnzettel',
    author: company.name,
  });

  const blobUrl = URL.createObjectURL(doc.output('blob'));
  return `${blobUrl}#filename=${encodeURIComponent(fileName)}`;
}

export function save(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
