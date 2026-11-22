/**
 * PDF des Leistungsnachweises (im Browser erzeugt, jsPDF).
 * Gemeinsam für die interne Berichtsseite und das Kundenportal.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  itemStatusText,
  fmtReportDate,
  fmtReportTime,
  fmtMonthLabel,
  isYearPeriod,
  type LeistungsnachweisReport,
} from '@/lib/leistungsnachweis-types';

const MAX_PDF_PHOTOS = 80;

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface LeistungsnachweisPdf {
  blob: Blob;
  filename: string;
}

/** Erstellt das PDF (für Vorschau und Download). */
export async function buildLeistungsnachweisPdf(report: LeistungsnachweisReport, monthLabel: string): Promise<LeistungsnachweisPdf> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 14;
  const W = doc.internal.pageSize.getWidth();
  const { company, site, totals, showWorkerNames } = report;
  doc.setProperties({ title: `Leistungsnachweis ${site.name} – ${monthLabel}`, author: company.name, creator: 'Hausmeister Pro' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Leistungsnachweis', M, 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(monthLabel, W - M, 18, { align: 'right' });
  doc.setFontSize(9);
  doc.text(`Objekt: ${site.name} — ${[site.address, [site.postalCode, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`, M, 26);
  doc.text(`Dienstleister: ${[company.name, [company.address, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(' — ')}`, M, 31);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(
    totals.planned
      ? `${totals.done} von ${totals.planned} Leistungen erbracht (${totals.compliancePercent?.toLocaleString('de-DE')} %)`
      : 'Keine geplanten Leistungen im Zeitraum',
    M, 41,
  );
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${totals.visits} Einsätze · ${totals.notPossible} nicht möglich · ${totals.open} ohne Rückmeldung`, M, 46);

  let startY = 52;
  // Jahresbericht: erst die Übersicht je Monat, dann die Einzelnachweise.
  if (isYearPeriod(report.month) && report.byMonth.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Übersicht je Monat', M, startY);
    autoTable(doc, {
      startY: startY + 3,
      head: [['Monat', 'Einsätze', 'Geplant', 'Erledigt', 'Nicht möglich', 'Ohne Rückmeldung', 'Quote']],
      body: [
        ...report.byMonth.map(m => [
          fmtMonthLabel(m.month), m.visits, m.planned, m.done, m.notPossible, m.open,
          m.compliancePercent == null ? '—' : `${m.compliancePercent.toLocaleString('de-DE')} %`,
        ]),
        ['Gesamt', totals.visits, totals.planned, totals.done, totals.notPossible, totals.open,
          totals.compliancePercent == null ? '—' : `${totals.compliancePercent.toLocaleString('de-DE')} %`],
      ],
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, lineColor: [220, 224, 230], lineWidth: 0.15 },
      headStyles: { fillColor: [15, 40, 80], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      didParseCell: data => {
        if (data.section === 'body' && data.row.index === report.byMonth.length) data.cell.styles.fontStyle = 'bold';
      },
    });
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('Einzelnachweise', M, 18);
    startY = 24;
  }

  const head = showWorkerNames
    ? ['Datum', 'Team', 'Leistung', 'Status', 'Erfasst', 'Fotos']
    : ['Datum', 'Leistung', 'Status', 'Erfasst', 'Fotos'];
  const statusColumn = showWorkerNames ? 3 : 2;
  const body = report.visits.flatMap(v => v.items.map((item, i) => {
    const row = [
      i === 0 ? fmtReportDate(v.date) : '',
      item.label,
      itemStatusText(item) + (item.reason ? `: ${item.reason}` : ''),
      item.checkedAt && !item.byOffice ? `${fmtReportTime(item.checkedAt)} ${item.employeeName ?? ''}`.trim() : '',
      [item.beforeUrl ? 'vorher' : '', item.afterUrl ? 'nachher' : ''].filter(Boolean).join(' / '),
    ];
    if (showWorkerNames) row.splice(1, 0, i === 0 ? v.workers.join(', ') || '—' : '');
    return row;
  }));
  autoTable(doc, {
    startY,
    head: [head],
    body,
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', lineColor: [220, 224, 230], lineWidth: 0.15 },
    headStyles: { fillColor: [15, 40, 80], textColor: 255, fontStyle: 'bold' },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === statusColumn) {
        const text = String(data.cell.raw ?? '');
        data.cell.styles.textColor = text.startsWith('erledigt') ? [22, 128, 61] : text.startsWith('nicht') ? [185, 28, 28] : [120, 120, 120];
      }
    },
  });

  // Fotoanhang: Vorher/Nachher je Leistung.
  const photos = report.visits.flatMap(v => v.items
    .filter(i => i.beforeUrl || i.afterUrl)
    .map(i => ({ date: v.date, label: i.label, before: i.beforeUrl, after: i.afterUrl })));
  const shown = photos.slice(0, MAX_PDF_PHOTOS);
  if (shown.length) {
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('Fotodokumentation', M, 18);
    let y = 26;
    const imgW = (W - 2 * M - 6) / 2;
    const imgH = imgW * 0.66;
    for (const p of shown) {
      if (y + imgH + 10 > doc.internal.pageSize.getHeight() - 12) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text(`${fmtReportDate(p.date)} — ${p.label}`, M, y);
      const [before, after] = await Promise.all([p.before ? toDataUrl(p.before) : null, p.after ? toDataUrl(p.after) : null]);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      for (const [i, img] of [before, after].entries()) {
        const x = M + i * (imgW + 6);
        doc.text(i === 0 ? 'vorher' : 'nachher', x, y + 4);
        if (img) {
          try { doc.addImage(img, x, y + 5.5, imgW, imgH, undefined, 'MEDIUM'); } catch { doc.text('(Bild nicht lesbar)', x, y + 12); }
        } else {
          doc.text('—', x, y + 12);
        }
      }
      y += imgH + 12;
    }
    if (photos.length > shown.length) {
      doc.setFontSize(8);
      doc.text(`… ${photos.length - shown.length} weitere Fotos online.`, M, Math.min(y, doc.internal.pageSize.getHeight() - 14));
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setTextColor(120);
    doc.text(`Erstellt am ${new Date().toLocaleDateString('de-DE')} · Seite ${p}/${pages}`, M, doc.internal.pageSize.getHeight() - 7);
    doc.setTextColor(0);
  }
  const safe = site.name.replace(/[^\w-]+/g, '_').slice(0, 40);
  return { blob: doc.output('blob'), filename: `Leistungsnachweis_${safe}_${report.month}.pdf` };
}

/** Datei herunterladen (ohne Vorschau). */
export function downloadPdf({ blob, filename }: LeistungsnachweisPdf) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportLeistungsnachweisPdf(report: LeistungsnachweisReport, monthLabel: string): Promise<void> {
  downloadPdf(await buildLeistungsnachweisPdf(report, monthLabel));
}
