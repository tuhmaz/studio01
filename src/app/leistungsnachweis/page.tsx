"use client";

/**
 * Leistungsnachweis — monthly proof of service per site: what was planned,
 * what was done, when and by whom, with before/after photos, as a PDF for
 * the property manager (Hausverwaltung).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CheckCircle2, CircleDashed, ClipboardCheck, Download, Image as ImageIcon, Loader2, XCircle } from 'lucide-react';
import { Shell } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';
import { UserRole } from '@/lib/types';

type ItemStatus = 'done' | 'not_possible' | 'open';

interface ReportItem {
  code: string;
  label: string;
  status: ItemStatus;
  reason: string | null;
  checkedAt: string | null;
  employeeName: string | null;
  beforeUrl: string | null;
  afterUrl: string | null;
}

interface Report {
  site: { id: string; name: string; address: string; city: string; postalCode: string | null };
  company: { name: string; address: string | null; city: string | null; postal_code: string | null; phone: string | null; email: string | null };
  month: string;
  visits: Array<{ id: string; date: string; title: string; status: string; workers: string[]; items: ReportItem[] }>;
  totals: { visits: number; planned: number; done: number; notPossible: number; open: number; compliancePercent: number | null };
}

interface SiteOption { id: string; name: string; city: string }

const STATUS_TEXT: Record<ItemStatus, string> = { done: 'erledigt', not_possible: 'nicht möglich', open: 'offen' };
const MAX_PDF_PHOTOS = 80;

function lastMonths(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { value, label: d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
  });
}

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '';

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

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (status === 'not_possible') return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
  return <CircleDashed className="w-4 h-4 text-gray-400 shrink-0" />;
}

export default function LeistungsnachweisPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const role = (userProfile?.role ?? 'WORKER') as UserRole;

  const months = useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useState(months[0].value);
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [siteId, setSiteId] = useState<string>('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'query', table: 'job_sites', select: 'id,name,city', orderBy: { column: 'name' } }),
    })
      .then(r => r.json())
      .then(({ data }) => {
        setSites(data ?? []);
        if (data?.[0]) setSiteId(data[0].id);
      })
      .catch(() => setSites([]));
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/leistungsnachweis?siteId=${encodeURIComponent(siteId)}&month=${month}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setReport(data);
    } catch (e: any) {
      toast({ title: 'Bericht konnte nicht geladen werden', description: e?.message, variant: 'destructive' });
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [siteId, month, toast]);

  useEffect(() => { load(); }, [load]);

  const monthLabel = months.find(m => m.value === month)?.label ?? month;

  const exportPdf = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const M = 14;
      const W = doc.internal.pageSize.getWidth();
      const { company, site, totals } = report;

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
          : 'Keine geplanten Leistungen in diesem Monat',
        M, 41,
      );
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(`${totals.visits} Einsätze · ${totals.notPossible} nicht möglich · ${totals.open} ohne Rückmeldung`, M, 46);

      const body = report.visits.flatMap(v => v.items.map((item, i) => [
        i === 0 ? fmtDate(v.date) : '',
        i === 0 ? v.workers.join(', ') || '—' : '',
        item.label,
        STATUS_TEXT[item.status] + (item.reason ? `: ${item.reason}` : ''),
        item.checkedAt ? `${fmtTime(item.checkedAt)} ${item.employeeName ?? ''}`.trim() : '',
        [item.beforeUrl ? 'vorher' : '', item.afterUrl ? 'nachher' : ''].filter(Boolean).join(' / '),
      ]));
      autoTable(doc, {
        startY: 52,
        head: [['Datum', 'Team', 'Leistung', 'Status', 'Erfasst', 'Fotos']],
        body,
        margin: { left: M, right: M },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', lineColor: [220, 224, 230], lineWidth: 0.15 },
        headStyles: { fillColor: [15, 40, 80], textColor: 255, fontStyle: 'bold' },
        didParseCell: data => {
          if (data.section === 'body' && data.column.index === 3) {
            const text = String(data.cell.raw ?? '');
            data.cell.styles.textColor = text.startsWith('erledigt') ? [22, 128, 61] : text.startsWith('nicht') ? [185, 28, 28] : [120, 120, 120];
          }
        },
      });

      // Photo appendix: before/after pairs per service.
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
          doc.text(`${fmtDate(p.date)} — ${p.label}`, M, y);
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
          doc.text(`… ${photos.length - shown.length} weitere Fotos in der App.`, M, Math.min(y, doc.internal.pageSize.getHeight() - 14));
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
      doc.save(`Leistungsnachweis_${safe}_${report.month}.pdf`);
    } catch (e: any) {
      toast({ title: 'PDF konnte nicht erstellt werden', description: e?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const t = report?.totals;

  return (
    <Shell userRole={role} userName={userProfile?.name ?? ''}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase flex items-center gap-3">
              <ClipboardCheck className="w-8 h-8" /> Leistungsnachweis
            </h1>
            <p className="text-muted-foreground font-medium">Geplante und erbrachte Leistungen je Objekt und Monat, mit Fotos</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={siteId} onValueChange={setSiteId} disabled={!sites?.length}>
              <SelectTrigger className="w-64 h-10 rounded-xl font-bold"><SelectValue placeholder="Objekt wählen" /></SelectTrigger>
              <SelectContent>
                {(sites ?? []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}{s.city && s.city !== s.name ? ` (${s.city})` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-44 h-10 rounded-xl font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>{months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="h-10 rounded-xl font-black gap-2" onClick={exportPdf} disabled={!report?.visits.length || exporting}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF
            </Button>
          </div>
        </div>

        {t && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Erfüllungsquote', value: t.compliancePercent == null ? '—' : `${t.compliancePercent.toLocaleString('de-DE')} %`, strong: true },
              { label: 'Erledigt', value: `${t.done} / ${t.planned}` },
              { label: 'Nicht möglich', value: String(t.notPossible) },
              { label: 'Ohne Rückmeldung', value: String(t.open) },
              { label: 'Einsätze', value: String(t.visits) },
            ].map(card => (
              <Card key={card.label} className={`rounded-2xl border-none shadow-sm ${card.strong ? 'bg-primary text-white' : ''}`}>
                <CardContent className="p-4">
                  <p className={`text-[10px] font-black uppercase tracking-widest ${card.strong ? 'text-white/70' : 'text-muted-foreground'}`}>{card.label}</p>
                  <p className="text-2xl font-black mt-1">{card.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="rounded-3xl border-none shadow-lg overflow-hidden">
          <CardContent className="p-0">
            {loading || sites === null ? (
              <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : !report || report.visits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16 px-6">
                Keine veröffentlichten Einsätze mit Leistungen für dieses Objekt in {monthLabel}.
                Leistungen und Monate werden in der Objekt-Ansicht unter „Leistungen &amp; Monate“ festgelegt.
              </p>
            ) : (
              <div className="divide-y">
                {report.visits.map(v => (
                  <div key={v.id} className="p-5 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
                    <div>
                      <p className="font-black">{fmtDate(v.date)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{v.workers.join(', ') || 'ohne Team'}</p>
                    </div>
                    <ul className="space-y-2">
                      {v.items.map(item => (
                        <li key={item.code} className="flex items-start gap-3">
                          <StatusIcon status={item.status} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold">{item.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.status === 'open' ? 'keine Rückmeldung' : `${STATUS_TEXT[item.status]} · ${fmtTime(item.checkedAt)} · ${item.employeeName ?? ''}`}
                              {item.reason ? ` — ${item.reason}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {item.beforeUrl && (
                              <a href={item.beforeUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                                <ImageIcon className="w-3.5 h-3.5" /> vorher
                              </a>
                            )}
                            {item.afterUrl && (
                              <a href={item.afterUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                                <ImageIcon className="w-3.5 h-3.5" /> nachher
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
