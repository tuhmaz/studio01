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
const ORANGE   = [255, 102, 0]   as [number, number, number]; // Bright orange for highlights

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0'); }

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

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

function getWeekday(iso: string): string {
  return WEEKDAY_SHORT_DE[new Date(iso).getDay()];
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

/** Height of the page header band in mm — used by callers to position content below */
const HEADER_H = 32;

function drawHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  monthLabel: string,
  _periodLabel: string,
  company: CompanySettings,
) {
  fillRect(doc, 0, 0, W, HEADER_H, PRIMARY);

  // ── Thin accent stripe at the bottom of the header ──
  fillRect(doc, 0, HEADER_H - 1.5, W, 1.5, [0, 30, 70]);

  doc.setTextColor(255, 255, 255);

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
    } catch (_e) {
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
    doc.setTextColor(200, 215, 240);
    doc.text(addrLine, textStartX + textOffsetX, ly);
    ly += 5;
  }

  const contactLine = [company.phone, company.email].filter(Boolean).join('  ·  ');
  if (contactLine) {
    doc.setFontSize(7);
    doc.setTextColor(180, 200, 230);
    doc.text(contactLine, textStartX + textOffsetX, ly);
    ly += 5;
  }

  if (company.taxNumber) {
    doc.setFontSize(7);
    doc.setTextColor(160, 185, 220);
    doc.text(`St.-Nr.: ${company.taxNumber}`, textStartX + textOffsetX, ly);
  }

  // ── RIGHT block: document title + month (right-aligned) ─────────────────
  const rx = W - MARGIN;

  // Month label (top-right, large)
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(monthLabel, rx, 10, { align: 'right' });

  // Document title
  doc.setFontSize(11);
  doc.text(title, rx, 18, { align: 'right' });

  // Subtitle (billing period)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(200, 215, 240);
  doc.text(subtitle, rx, 25, { align: 'right' });
}

function drawFooter(doc: jsPDF, company: CompanySettings, workerName: string, periodLabel: string) {
  // Footer band: 14mm tall, starts at y=283 (ends at y=297, within A4 297mm)
  const FY = 283;
  fillRect(doc, 0, FY, W, 14, PRIMARY);

  // Thin separator line between the two footer rows
  doc.setDrawColor(0, 30, 70);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, FY + 7, W - MARGIN, FY + 7);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');

  // ── Row 1: company name + website  |  page number ──
  doc.setFontSize(7.5);
  const leftText = [company.name, company.website].filter(Boolean).join('  ·  ');
  doc.text(leftText, MARGIN, FY + 5);
  doc.text('Seite 1', W - MARGIN, FY + 5, { align: 'right' });

  // ── Row 2: creation date · worker · period (centered, slightly dimmed) ──
  doc.setFontSize(6.5);
  doc.setTextColor(200, 215, 240);
  const centerText = `Erstellt: ${new Date().toLocaleDateString('de-DE')}  ·  ${workerName}  ·  ${periodLabel}`;
  doc.text(centerText, W / 2, FY + 12, { align: 'center' });
}

// ─── 1. ARBEITSZEITNACHWEIS ───────────────────────────────────────────────────
//     Stundennachweis ohne Geldbeträge

export function generateArbeitszeitnachweis(params: LohnExportParams) {
  const { worker, month, year } = params;
  const company: CompanySettings = params.company ?? { name: params.companyName ?? 'Meine Firma' };

  const { label: periodLabel } = getBillingPeriod(month, year);
  const entries = params.entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalWorkMin  = entries.reduce((s, e) => s + e.workMinutes, 0);
  const totalBonusMin = entries.reduce((s, e) => s + e.travelBonusMinutes, 0);
  const totalMin      = totalWorkMin + totalBonusMin;

  const doc = makeDoc();
  const monthLabel = `${MONTH_NAMES_DE[month].toUpperCase()} ${year}`;

  // ── Header ──
  drawHeader(
    doc,
    'ARBEITSZEITNACHWEIS',
    `Abrechnungszeitraum: ${periodLabel}`,
    monthLabel,
    '',
    company
  );

  // ── Employee info box (no financial data) ──
  let y = HEADER_H + 4;
  fillRect(doc, MARGIN, y, CW, 20, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, CW, 20);

  // Group entries by date
  const groupedEntriesMap = new Map<string, {
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
        date: e.date, // keep original for display if needed, but wait, fmtDate might expect a valid date string. Let's just use e.date or d
        siteNames: new Set(e.siteName || e.siteAddress ? [e.siteName || e.siteAddress] : []),
        regions: new Set(e.region ? [e.region] : []),
        categories: new Set(e.categories),
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        workMinutes: e.workMinutes,
        travelBonusMinutes: e.travelBonusMinutes,
      });
    } else {
      const g = groupedEntriesMap.get(d)!;
      if (e.siteName || e.siteAddress) g.siteNames.add(e.siteName || e.siteAddress);
      if (e.region) g.regions.add(e.region);
      e.categories.forEach(c => g.categories.add(c));
      
      // Update earliest clockIn and latest clockOut
      if (new Date(e.clockIn) < new Date(g.clockIn)) g.clockIn = e.clockIn;
      if (new Date(e.clockOut) > new Date(g.clockOut)) g.clockOut = e.clockOut;
      
      g.workMinutes += e.workMinutes;
      g.travelBonusMinutes += e.travelBonusMinutes;
    }
  });

  const groupedEntries = Array.from(groupedEntriesMap.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const fields = [
    { label: 'MITARBEITER',  value: worker.name },
    { label: 'VERTRAGSART',  value: CONTRACT_LABELS[worker.contractType ?? ''] ?? '—' },
    { label: 'SOLLSTUNDEN',  value: `${worker.monthlyTargetHours ?? 0} Std./Monat` },
    { label: 'EINTRÄGE',     value: String(groupedEntries.length) },
  ];
  fields.forEach((f, i) => {
    const x = MARGIN + 3 + i * (CW / 4);
    doc.setTextColor(80, 90, 110);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(f.label, x, y + 7);
    doc.setTextColor(...PRIMARY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(f.value, x, y + 15);
  });

  y += 26;

  // ── Table ──
  const tableHead = [[
    { content: 'Nr.',             styles: { halign: 'center' as const } },
    { content: 'Datum',           styles: { halign: 'center' as const } },
    { content: 'Tag',             styles: { halign: 'center' as const } },
    { content: 'Objekt / Adresse', styles: { halign: 'left' as const } },
    { content: 'Tätigkeiten',     styles: { halign: 'left' as const } },
    { content: 'Beginn',          styles: { halign: 'center' as const } },
    { content: 'Ende',            styles: { halign: 'center' as const } },
    { content: 'Std.',            styles: { halign: 'center' as const } },
    { content: 'Fahrtzt.',        styles: { halign: 'center' as const } },
    { content: 'Unterschrift',    styles: { halign: 'center' as const } },
  ]];

  const tableBody: any[] = groupedEntries.map((e, idx) => {
    const siteStr = Array.from(e.siteNames)
      .map(site => site.replace(/Ø=ÜÍ\s*LR-\s*\d+/g, '').replace(/Ø=ÜÍ\s*LR\s*-\s*\d+/g, '').replace(/Ø=ÜÍ/g, '').replace(/LR\s*-\s*\d+/g, '').trim())
      .filter(Boolean)
      .join('\n') || '—';
      const objStr = siteStr;
      // Join categories with a comma and space instead of newline to save vertical space
      const catStr = e.categories.size > 0 ? Array.from(e.categories).join(', ') : '—';

    return [
      { content: String(idx + 1), styles: { halign: 'center' as const, textColor: [110,120,140] as [number,number,number] } },
      { content: fmtDate(e.date), styles: { halign: 'center' as const } },
      { content: getWeekday(e.date), styles: { halign: 'center' as const } },
      {
        content: objStr,
        styles: { fontSize: 7.5, cellPadding: 2 },
      },
      {
        content: catStr,
        styles: { fontSize: 6.5, textColor: [60, 80, 120] as [number,number,number], cellPadding: 2 },
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
  const MIN_ROWS = 14;
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
      fontSize: 8,
      cellPadding: 2,
      lineColor: BORDER,
      lineWidth: 0.15,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: PRIMARY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      cellPadding: 2,
    },
    alternateRowStyles: { fillColor: [250, 251, 255] },
    columnStyles: {
        0: { cellWidth: 7,  halign: 'center' },  // Nr.
        1: { cellWidth: 18, halign: 'center' },  // Datum
        2: { cellWidth: 9,  halign: 'center' },  // Tag
        3: { cellWidth: 46 },                    // Objekt / Adresse
        4: { cellWidth: 27 },                    // Tätigkeiten
        5: { cellWidth: 13, halign: 'center' },  // Beginn
        6: { cellWidth: 13, halign: 'center' },  // Ende
        7: { cellWidth: 13, halign: 'center' },  // Std.
        8: { cellWidth: 16, halign: 'center' },  // Fahrtzt.  ← wider for "-01:00"
        9: { cellWidth: 32, halign: 'center' },  // Unterschrift
      },
    didParseCell: (data) => {
      if (data.row.index >= groupedEntries.length) {
        data.cell.styles.fillColor = [248, 249, 252];
        data.cell.styles.textColor = [210, 215, 225];
      }
    },
  });

  // ── Summary (hours only, no money) ──
  const finalY = (doc as any).lastAutoTable.finalY as number;
  let sy = finalY + 6;
  if (sy + 40 > 283) { doc.addPage(); sy = 20; }

  fillRect(doc, MARGIN, sy, CW, 38, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, sy, CW, 38);

  // Section title line
  doc.setDrawColor(...BORDER);
  doc.line(MARGIN, sy + 10, MARGIN + CW, sy + 10);

  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('STUNDEN-ZUSAMMENFASSUNG', MARGIN + 5, sy + 7);

  // Vertical dividers
  const col2x = MARGIN + CW * 0.38;
  const col3x = MARGIN + CW * 0.66;
  doc.line(col2x, sy + 1, col2x, sy + 38);
  doc.line(col3x, sy + 1, col3x, sy + 38);

  // Left column
  const rowH = 7.5;
  let ry = sy + 17;
  const drawSummaryRow = (label: string, value: string, x: number, colW: number, accent?: [number,number,number]) => {
    doc.setTextColor(80, 95, 115);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(label, x + 4, ry);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...(accent ?? PRIMARY));
    doc.text(value, x + colW - 4, ry, { align: 'right' });
  };

  const colW1 = col2x - MARGIN;
  const colW2 = col3x - col2x;
  const colW3 = MARGIN + CW - col3x;

  drawSummaryRow('Reine Arbeitszeit:', fmtHHMM(totalWorkMin) + ' Std.', MARGIN, colW1);
  ry += rowH;
  drawSummaryRow('Fahrzeit-Zuschlag:', fmtHHMM(Math.abs(totalBonusMin)) + ' Std.', MARGIN, colW1, ORANGE);
  ry += rowH;
  drawSummaryRow('Gesamte vergütete Zeit:', fmtHHMM(totalMin) + ' Std.', MARGIN, colW1);

  // Middle column
  ry = sy + 17;
  drawSummaryRow('Sollstunden / Monat:', `${worker.monthlyTargetHours ?? 0} Std.`, col2x, colW2);
  ry += rowH;
  const overtimeMin = Math.max(0, totalMin - (worker.monthlyTargetHours ?? 0) * 60);
  drawSummaryRow('Reguläre Stunden:', fmtHHMM(totalMin - overtimeMin) + ' Std.', col2x, colW2);
  ry += rowH;
  drawSummaryRow('Überstunden:', fmtHHMM(overtimeMin) + ' Std.', col2x, colW2, [160, 50, 50]);

  // Right column: signature
  ry = sy + 14;
  doc.setTextColor(80, 95, 115);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Ort / Datum:', col3x + 4, ry);
  doc.setDrawColor(...BORDER);
  doc.line(col3x + 4, ry + 6, col3x + colW3 - 6, ry + 6);
  ry += 14;
  doc.text('Unterschrift Mitarbeiter:', col3x + 4, ry);
  doc.line(col3x + 4, ry + 6, col3x + colW3 - 6, ry + 6);

  drawFooter(doc, company, worker.name, periodLabel);

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

  // ── Totals ──
  const totalWorkMin    = entries.reduce((s, e) => s + e.workMinutes, 0);
  const totalBonusMin   = entries.reduce((s, e) => s + e.travelBonusMinutes, 0);
  const totalBillable   = totalWorkMin + totalBonusMin;
  const targetMin       = (worker.monthlyTargetHours ?? 0) * 60;
  const overtimeMin     = targetMin > 0 ? Math.max(0, totalBillable - targetMin) : 0;
  const regularMin      = totalBillable - overtimeMin;
  const hourlyRate      = worker.hourlyRate ?? 15;
  const regularPay      = (regularMin  / 60) * hourlyRate;
  const overtimePay     = (overtimeMin / 60) * hourlyRate * OVERTIME_RATE;
  const bruttoTotal     = regularPay + overtimePay;

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
        travelBonusMinutes: e.travelBonusMinutes,
        isRemote: e.isRemote,
      });
    } else {
      const g = groupedEntriesMap.get(d)!;
      if (e.siteName) g.siteNames.add(e.siteName);
      if (e.siteAddress) g.siteAddresses.add(e.siteAddress);
      g.workMinutes += e.workMinutes;
      g.travelBonusMinutes += e.travelBonusMinutes;
      g.isRemote = g.isRemote || e.isRemote;
    }
  });

  const groupedEntries = Array.from(groupedEntriesMap.values());

  // Per-site aggregation for the site list based on grouped entries
  // To keep it simple, if a grouped entry has multiple sites, we distribute the visit
  // Or we just use the original entries for siteMap but ensure unique visits per day?
  // Let's count unique days per site
  const siteMap = new Map<string, { name: string; address: string; visits: number; minutes: number; travelBonusMinutes: number }>();

  // Track visits per site per day to avoid double counting
  const siteVisitsPerDay = new Set<string>();

  entries.forEach(e => {
    const key = e.siteName || e.siteAddress || '?';
    const dayKey = `${e.date.split('T')[0]}-${key}`;
    const existing = siteMap.get(key);

    if (existing) {
      if (!siteVisitsPerDay.has(dayKey)) {
        existing.visits += 1;
        siteVisitsPerDay.add(dayKey);
      }
      existing.minutes += e.workMinutes;
      existing.travelBonusMinutes += (e.travelBonusMinutes ?? 0);
    } else {
      siteMap.set(key, {
        name: e.siteName, address: e.siteAddress,
        visits: 1, minutes: e.workMinutes,
        travelBonusMinutes: e.travelBonusMinutes ?? 0,
      });
      siteVisitsPerDay.add(dayKey);
    }
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
  let y = HEADER_H + 3;
  fillRect(doc, MARGIN, y, CW, 24, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, CW, 24);

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
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(f.label, x, y + 5);
    doc.setTextColor(...PRIMARY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(f.value, x, y + 10);
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
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(f.label, x, y + 15);
    if (i === 2) { doc.setTextColor(30, 130, 60); } else { doc.setTextColor(...PRIMARY); }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(f.value, x, y + 20);
  });

  y += 28;

  // ── Site list ──
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('EINSATZ-ÜBERSICHT', MARGIN, y + 4);
  y += 8;

  const siteBody: any[] = Array.from(siteMap.values()).map((s, i) => [
    { content: String(i + 1), styles: { halign: 'center' as const, textColor: [110,120,140] as [number,number,number] } },
    { content: s.name || s.address || '—' },
    { content: s.address || '—', styles: { fontSize: 7, textColor: [80,95,115] as [number,number,number] } },
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
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.5, lineColor: BORDER, lineWidth: 0.15 },
    headStyles: { fillColor: PRIMARY, textColor: [255,255,255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 1.5, halign: 'center' },
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
  let sy = finalY + 6;
  if (sy + 110 > 283) { doc.addPage(); sy = 20; }

  fillRect(doc, MARGIN, sy, CW, 100, LIGHT_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, sy, CW, 100);

  // Dividers
  const midX = MARGIN + CW * 0.5;
  doc.line(midX, sy + 1, midX, sy + 100);
  doc.line(MARGIN, sy + 8, MARGIN + CW, sy + 8);

  // Titles
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('STUNDEN-AUFSCHLÜSSELUNG', MARGIN + 5, sy + 6);
  doc.text('LOHN-BERECHNUNG (SACHSEN-ANHALT)', midX + 5, sy + 6);

  const rowH = 6.5;

  // Left: hours
  let ry = sy + 14;
  const drawRow = (label: string, value: string, x: number, colW: number, accent?: [number,number,number], isBoldLabel?: boolean) => {
    doc.setTextColor(80, 95, 115);
    doc.setFont('helvetica', isBoldLabel ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    doc.text(label, x + 3, ry);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...(accent ?? PRIMARY));
    doc.text(value, x + colW - 3, ry, { align: 'right' });
  };

  const halfW = midX - MARGIN;
  const rightW = MARGIN + CW - midX;

  drawRow('Brutto-Arbeitszeit:', fmtHHMM(totalWorkMin) + ' Std.', MARGIN, halfW);
  ry += rowH;
  if (totalBonusMin !== 0) {
    const bonusLabel = totalBonusMin < 0 ? 'Fahrtabzug (Fernstandorte):' : 'Fahrtbonus:';
    const bonusVal   = (totalBonusMin < 0 ? '-' : '+') + fmtHHMM(Math.abs(totalBonusMin)) + ' Std.';
    drawRow(bonusLabel, bonusVal, MARGIN, halfW, totalBonusMin < 0 ? [180, 40, 40] : ORANGE);
    ry += rowH;
  }
  drawRow('Vergütete Netto-Zeit:', fmtHHMM(totalBillable) + ' Std.', MARGIN, halfW);
  ry += rowH;
  drawRow('Sollstunden / Monat:', `${worker.monthlyTargetHours ?? 0} Std.`, MARGIN, halfW);
  ry += rowH;
  drawRow('Reguläre Stunden:', fmtHHMM(regularMin) + ' Std.', MARGIN, halfW);
  ry += rowH;
  drawRow(`Überstunden (×${OVERTIME_RATE}):`, fmtHHMM(overtimeMin) + ' Std.', MARGIN, halfW, [160, 50, 50]);

  // Extra employee details
  ry += rowH * 1.2;
  doc.line(MARGIN, ry - 3, midX, ry - 3);
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
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
  ry = sy + 17;
  drawRow('Stundensatz:', fmtCurrency(hourlyRate) + '/h', midX, rightW);
  ry += rowH;
  drawRow('Reguläre Vergütung:', fmtCurrency(regularPay), midX, rightW);
  ry += rowH;
  drawRow(`Überstunden-Vergütung (×${OVERTIME_RATE}):`, fmtCurrency(overtimePay), midX, rightW, [160, 50, 50]);
  ry += rowH * 1.2;

  // Brutto highlight
  fillRect(doc, midX + 2, ry - 5, rightW - 4, 8, PRIMARY);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('BRUTTO-LOHN:', midX + 5, ry);
  doc.text(fmtCurrency(bruttoTotal), midX + rightW - 5, ry, { align: 'right' });

  ry += rowH * 1.1;

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
  fillRect(doc, midX + 2, ry - 3, rightW - 4, 12, [40, 160, 80]);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('NETTO-VERDIENST:', midX + 5, ry + 4);
  doc.text(fmtCurrency(payroll.netto), midX + rightW - 5, ry + 4, { align: 'right' });

  // ── Signature strip ──
  sy += 110;
  if (sy + 20 > 283) { doc.addPage(); sy = 20; }

  fillRect(doc, MARGIN, sy, CW, 18, [252, 252, 255]);
  doc.setDrawColor(...BORDER);
  doc.rect(MARGIN, sy, CW, 18);

  const sigCols = 3;
  const sigW = CW / sigCols;
  const sigLabels = ['Ort / Datum', 'Unterschrift Mitarbeiter', 'Unterschrift Vorgesetzter'];
  sigLabels.forEach((label, i) => {
    const x = MARGIN + i * sigW;
    if (i > 0) doc.line(x, sy + 1, x, sy + 18);
    doc.setTextColor(80, 95, 115);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(label + ':', x + 3, sy + 5);
    doc.setDrawColor(...BORDER);
    doc.line(x + 3, sy + 14, x + sigW - 5, sy + 14);
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
