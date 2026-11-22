"use client";

/**
 * Leistungsnachweis — monthly proof of service per site: what was planned,
 * what was done, when and by whom, with before/after photos, as a PDF for
 * the property manager (Hausverwaltung).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, ClipboardCheck, Download, Loader2 } from 'lucide-react';
import { Shell } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { hasPermission } from '@/lib/permissions';
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmMonth, setConfirmMonth] = useState(false);
  const canNachtrag = hasPermission({ role } as Parameters<typeof hasPermission>[0], 'time_entries.approve');

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

  // Offene Leistungen vergangener Einsätze (bis heute) – Kandidaten für den Nachtrag.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const openPast = (report?.visits ?? [])
    .filter(v => v.date <= today)
    .reduce((n, v) => n + v.items.filter(i => i.status === 'open').length, 0);

  const nachtrag = async (assignmentId: string | null, method: 'POST' | 'DELETE' = 'POST') => {
    setBusyId(assignmentId ?? 'month');
    try {
      const res = await fetch('/api/reports/leistungsnachweis/nachtrag', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'POST' ? { siteId, month, assignmentId } : { assignmentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error);
      toast({
        title: method === 'POST'
          ? `${json.data.services} Leistungen nachgetragen`
          : 'Nachtrag zurückgenommen',
      });
      await load();
    } catch (e: any) {
      toast({ title: 'Nicht gespeichert', description: e?.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

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
            {canNachtrag && openPast > 0 && (
              <Button variant="outline" className="h-10 rounded-xl font-bold gap-2" onClick={() => setConfirmMonth(true)} disabled={busyId !== null}>
                {busyId === 'month' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                Offene nachtragen ({openPast})
              </Button>
            )}
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
          onNachtrag={canNachtrag ? id => nachtrag(id) : undefined}
          onUndo={canNachtrag ? id => nachtrag(id, 'DELETE') : undefined}
          busyId={busyId}
        />

        <AlertDialog open={confirmMonth} onOpenChange={setConfirmMonth}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{openPast} offene Leistungen als erledigt nachtragen?</AlertDialogTitle>
              <AlertDialogDescription>
                Alle Einsätze in {monthLabel} bis heute, für die es keine Rückmeldung gibt. Im Leistungsnachweis
                (auch im PDF und im Kundenportal) steht dann „erledigt (Nachtrag Büro)“ – ohne Uhrzeit und ohne Fotos.
                Rückmeldungen vom Mitarbeiter bleiben unverändert. Je Einsatz kann der Nachtrag zurückgenommen werden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={() => nachtrag(null)}>Nachtragen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Shell>
  );
}
