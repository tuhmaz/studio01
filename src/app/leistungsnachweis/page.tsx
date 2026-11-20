"use client";

/**
 * Leistungsnachweis — monthly proof of service per site: what was planned,
 * what was done, when and by whom, with before/after photos, as a PDF for
 * the property manager (Hausverwaltung).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Download, Loader2 } from 'lucide-react';
import { Shell } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeistungsnachweisView } from '@/components/reports/LeistungsnachweisView';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';
import { UserRole } from '@/lib/types';
import { lastMonths, type LeistungsnachweisReport } from '@/lib/leistungsnachweis-types';
import { exportLeistungsnachweisPdf } from '@/lib/leistungsnachweis-pdf';

interface SiteOption { id: string; name: string; city: string }

export default function LeistungsnachweisPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const role = (userProfile?.role ?? 'WORKER') as UserRole;

  const months = useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useState(months[0].value);
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [siteId, setSiteId] = useState<string>('');
  const [report, setReport] = useState<LeistungsnachweisReport | null>(null);
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
      await exportLeistungsnachweisPdf(report, monthLabel);
    } catch (e: any) {
      toast({ title: 'PDF konnte nicht erstellt werden', description: e?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

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

        <LeistungsnachweisView
          report={report}
          loading={loading || sites === null}
          monthLabel={monthLabel}
          emptyHint={'Leistungen und Monate werden in der Objekt-Ansicht unter „Leistungen & Monate“ festgelegt.'}
        />
      </div>
    </Shell>
  );
}
