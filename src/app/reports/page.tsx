"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { Shell } from '@/components/layout/Shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Clock, Users, TrendingUp, MapPin, Loader2,
  Timer, ChevronRight, AlertCircle, FileDown, X, FileText, Image as ImageIcon, Trash2, Edit2
} from 'lucide-react';
import { simulatePayroll } from '@/lib/payroll';
import { generateArbeitszeitnachweis, generateLohnzettel, LohnExportEntry, CompanySettings, save } from '@/lib/export-lohn';
import { User, JobSite } from '@/lib/types';
import { useAuth } from '@/db/provider';
import { useQuery } from '@/db/use-query';
import { useToast } from '@/hooks/use-toast';
import SiteMediaBrowser from '@/components/tracking/SiteMediaBrowser';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimeEntry {
  id: string;
  employeeId: string;
  jobAssignmentId?: string;
  jobSiteId?: string;
  clockInDateTime?: string;
  clockOutDateTime?: string;
  actualWorkMinutes?: number;
  travelBonusMinutes?: number;
  status: 'OPEN' | 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
}

interface JobAssignment {
  id: string;
  jobSiteId?: string;
  assignedWorkerIds?: string[];
  scheduledDate?: string;
  title?: string;
  categories?: string[];
  status?: string;
}

interface EnrichedEntry {
  entry: TimeEntry;
  assignment: JobAssignment | null;
  site: JobSite | null;
  worker: User | null;
}

interface WorkerMonthStats {
  user: User;
  entries: EnrichedEntry[];
  workMinutes: number;
  remoteBonusMinutes: number;
  billableMinutes: number;
  overtimeMinutes: number;
  regularMinutes: number;
  brutto: number;
  visitedSites: {
    site: JobSite;
    minutes: number;
    visits: number;
    isRemote: boolean;
    remoteDeductionMinutes: number;
    netMinutes: number;
  }[];
}

interface SiteStat {
  site: JobSite;
  totalMinutes: number;
  totalVisits: number;
  workerIds: Set<string>;
  categories: Set<string>;
  isRemote: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const CONTRACT_LABELS: Record<string, string> = {
  VOLLZEIT: 'Vollzeit',
  TEILZEIT: 'Teilzeit',
  MINIJOB:  'Minijob',
  MIDIJOB:  'Midijob',  // FIX: was MIDIOB
};

const OVERTIME_RATE = 1.25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMin(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const sign = mins < 0 ? '-' : '';
  return m > 0 ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
}

function fmtCurrency(val: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(val);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─── Data Enrichment ──────────────────────────────────────────────────────────

function enrichEntry(
  entry: TimeEntry,
  assignments: JobAssignment[],
  jobSites: JobSite[],
  users: User[]
): EnrichedEntry {
  const assignment = entry.jobAssignmentId
    ? assignments.find(a => a.id === entry.jobAssignmentId) ?? null
    : null;
  const siteId = assignment?.jobSiteId ?? (entry as any).jobSiteId;
  const site = siteId ? jobSites.find(s => s.id === siteId) ?? null : null;
  const worker = users.find(u => u.id === entry.employeeId) ?? null;
  return { entry, assignment, site, worker };
}

function computeMonthlyStats(
  users: User[],
  timeEntries: TimeEntry[],
  assignments: JobAssignment[],
  jobSites: JobSite[],
  month: number,
  year: number
): WorkerMonthStats[] {
  // Abrechnungszeitraum: 21. Vormonat – 20. Aktueller Monat
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear  = month === 0 ? year - 1 : year;
  const periodStart = new Date(prevYear, prevMonth, 21, 0, 0, 0);
  const periodEnd   = new Date(year, month, 20, 23, 59, 59);

  const relevant = timeEntries.filter(e => {
    if (e.status !== 'SUBMITTED' && e.status !== 'APPROVED') return false;
    if (!e.clockInDateTime) return false;
    const d = new Date(e.clockInDateTime);
    return d >= periodStart && d <= periodEnd;
  });

  return users
    .map(user => {
      const userEntries = relevant
        .filter(e => e.employeeId === user.id)
        .map(e => enrichEntry(e, assignments, jobSites, users));

      if (!userEntries.length) return null;

      const workMinutes = userEntries.reduce((s, e) => s + (e.entry.actualWorkMinutes ?? 0), 0);
      // Fahrtabzug: max -60 Min pro Tag (nicht pro Einsatz)
      const bonusPerDay = new Map<string, number>();
      userEntries.forEach(e => {
        if (!e.entry.clockInDateTime) return;
        const day = e.entry.clockInDateTime.split('T')[0];
        const stored = e.entry.travelBonusMinutes ?? 0;
        const isFar = stored !== 0
          ? true
          : ((e.site?.isRemote ?? false) || Number(e.site?.distanceFromHQ ?? 0) >= 95);
        if (!isFar) return;
        const prev = bonusPerDay.get(day) ?? 0;
        bonusPerDay.set(day, Math.max(-60, prev + (stored !== 0 ? stored : -60)));
      });
      const remoteBonusMinutes = Array.from(bonusPerDay.values()).reduce((s, v) => s + v, 0);
      // Vergütete Zeit = Reine Arbeitszeit + Fahrtabzug (remoteBonusMinutes is negative)
      const billableMinutes = workMinutes + remoteBonusMinutes;
      const targetMinutes = (user.monthlyTargetHours ?? 0) * 60;
      const overtimeMinutes = targetMinutes > 0 ? Math.max(0, billableMinutes - targetMinutes) : 0;
      const regularMinutes = billableMinutes - overtimeMinutes;
      const hourly = user.hourlyRate ?? 15;
      const regularPay = (regularMinutes / 60) * hourly;
      const overtimePay = (overtimeMinutes / 60) * hourly * OVERTIME_RATE;
      const brutto = regularPay + overtimePay;

      // Aggregate per site
      const siteMap = new Map<string, {
        site: JobSite;
        minutes: number;
        visits: number;
        isRemote: boolean;
        remoteDeductionMinutes: number;
      }>();
      const remoteMinutesBySiteAndDay = new Map<string, number>();
      userEntries.forEach(e => {
        if (!e.site) return;
        const siteId = e.site.id;
        const day = e.entry.clockInDateTime?.split('T')[0];
        const stored = e.entry.travelBonusMinutes ?? 0;
        const isFar = stored !== 0
          ? true
          : ((e.site.isRemote ?? false) || Number(e.site.distanceFromHQ ?? 0) >= 95);
        if (day && isFar) {
          const key = `${day}__${siteId}`;
          remoteMinutesBySiteAndDay.set(key, (remoteMinutesBySiteAndDay.get(key) ?? 0) + (e.entry.actualWorkMinutes ?? 0));
        }
        const existing = siteMap.get(e.site.id);
        if (existing) {
          existing.minutes += e.entry.actualWorkMinutes ?? 0;
          existing.visits  += 1;
        } else {
          siteMap.set(e.site.id, {
            site: e.site,
            minutes: e.entry.actualWorkMinutes ?? 0,
            visits: 1,
            isRemote: e.site.isRemote,
            remoteDeductionMinutes: 0,
          });
        }
      });

      bonusPerDay.forEach((dayBonus, day) => {
        if (dayBonus === 0) return;
        const siteMinuteShares = Array.from(siteMap.values())
          .map(s => ({
            siteId: s.site.id,
            minutes: remoteMinutesBySiteAndDay.get(`${day}__${s.site.id}`) ?? 0
          }))
          .filter(s => s.minutes > 0)
          .sort((a, b) => b.minutes - a.minutes);
        if (!siteMinuteShares.length) return;
        const totalMinutesForDay = siteMinuteShares.reduce((sum, s) => sum + s.minutes, 0);
        let distributed = 0;
        siteMinuteShares.forEach((share, idx) => {
          const isLast = idx === siteMinuteShares.length - 1;
          const part = isLast
            ? (dayBonus - distributed)
            : Math.round((dayBonus * share.minutes) / totalMinutesForDay);
          distributed += part;
          const siteAgg = siteMap.get(share.siteId);
          if (siteAgg) siteAgg.remoteDeductionMinutes += part;
        });
      });

      return {
        user,
        entries: userEntries,
        workMinutes,
        remoteBonusMinutes,
        billableMinutes,
        overtimeMinutes,
        regularMinutes,
        brutto,
        visitedSites: Array.from(siteMap.values())
          .map(s => ({
            ...s,
            netMinutes: s.minutes + s.remoteDeductionMinutes,
          }))
          .sort((a, b) => b.netMinutes - a.netMinutes),
      } satisfies WorkerMonthStats;
    })
    .filter((s): s is WorkerMonthStats => s !== null);
}

function computeSiteStats(
  timeEntries: TimeEntry[],
  assignments: JobAssignment[],
  jobSites: JobSite[],
  month: number,
  year: number
): SiteStat[] {
  const relevant = timeEntries.filter(e => {
    if (e.status !== 'SUBMITTED' && e.status !== 'APPROVED') return false;
    if (!e.clockInDateTime) return false;
    const d = new Date(e.clockInDateTime);
    return d.getMonth() === month && d.getFullYear() === year;
  });

  const map = new Map<string, SiteStat>();
  relevant.forEach(entry => {
    const assignment = entry.jobAssignmentId
      ? assignments.find(a => a.id === entry.jobAssignmentId) : null;
    const siteId = assignment?.jobSiteId ?? (entry as any).jobSiteId;
    if (!siteId) return;
    const site = jobSites.find(s => s.id === siteId);
    if (!site) return;

    const existing = map.get(siteId);
    if (existing) {
      existing.totalMinutes += entry.actualWorkMinutes ?? 0;
      existing.totalVisits += 1;
      existing.workerIds.add(entry.employeeId);
      assignment?.categories?.forEach(c => existing.categories.add(c));
    } else {
      const cats = new Set<string>(assignment?.categories ?? []);
      map.set(siteId, {
        site,
        totalMinutes: entry.actualWorkMinutes ?? 0,
        totalVisits: 1,
        workerIds: new Set([entry.employeeId]),
        categories: cats,
        isRemote: site.isRemote,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
}

// ─── SVG → PNG Konvertierung (für jsPDF addImage) ────────────────────────────

async function svgToPng(svgDataUrl: string, width = 400, height = 120): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = svgDataUrl;
  });
}

// ─── PDF Export Helper ────────────────────────────────────────────────────────

function toExportEntries(entries: EnrichedEntry[]): LohnExportEntry[] {
  return entries
    .filter(e => e.entry.clockInDateTime && e.entry.clockOutDateTime)
    .map(e => {
      const isRemote = e.site?.isRemote ?? false;
      const distanceFromHQ = Number(e.site?.distanceFromHQ ?? 0);
      const isFarSite = isRemote || distanceFromHQ >= 95;

      // Wenn die Stelle remote ist aber kein Fahrtabzug gespeichert wurde → automatisch -60 anwenden
      const storedBonus = e.entry.travelBonusMinutes ?? 0;
      const travelBonusMinutes = storedBonus !== 0 ? storedBonus : (isFarSite ? -60 : 0);

      // Objekt: Name + Stadt kombinieren, aber Dopplung vermeiden (z.B. "Burg / Burg")
      const nameParts   = [e.site?.name, e.site?.city].filter(Boolean);
      const uniqueParts = nameParts.filter((v, i, arr) => arr.indexOf(v) === i);
      const siteName    = uniqueParts.join(' / ') || e.assignment?.title || '';
      const siteAddress = e.site?.address || '';

      return {
        date:               e.entry.clockInDateTime!,
        clockIn:            e.entry.clockInDateTime!,
        clockOut:           e.entry.clockOutDateTime!,
        workMinutes:        e.entry.actualWorkMinutes ?? 0,
        siteName,
        siteAddress,
        region:             e.site?.routeCode || e.site?.region || '',
        isRemote:           isFarSite,
        distanceKm:         distanceFromHQ,
        travelBonusMinutes,
        categories:         e.assignment?.categories ?? [],
      };
    });
}

// ─── Worker Detail Dialog ─────────────────────────────────────────────────────

function WorkerDetailDialog({
  stats, month, year, open, onClose, onShowPdf, company, onVoidEntry, onEditEntry
}: {
  stats: WorkerMonthStats;
  month: number; year: number;
  open: boolean; onClose: () => void;
  onShowPdf: (type: 'stunden' | 'lohn', data: string) => void;
  company?: CompanySettings;
  onVoidEntry?: (entryId: string) => Promise<void>;
  onEditEntry?: (entryId: string, start: string, end: string) => Promise<void>;
}) {
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  
  // Edit State
  const [editingEntry, setEditingEntry] = useState<EnrichedEntry | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const { user, entries, workMinutes, remoteBonusMinutes, billableMinutes, overtimeMinutes,
          brutto, visitedSites } = stats;
  const payroll = simulatePayroll(user, brutto);

  const byDate = useMemo(() => {
    const groups: Record<string, EnrichedEntry[]> = {};
    entries.forEach(e => {
      if (!e.entry.clockInDateTime) return;
      const d = new Date(e.entry.clockInDateTime).toISOString().split('T')[0];
      if (!groups[d]) groups[d] = [];
      groups[d].push(e);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const handleExport = async (type: 'stunden' | 'lohn') => {
    const generator = type === 'stunden' ? generateArbeitszeitnachweis : generateLohnzettel;

    // SVG-Unterschrift → PNG konvertieren (jsPDF unterstützt kein SVG in addImage)
    let signatureData: string | undefined = user.signatureData;
    if (signatureData?.startsWith('data:image/svg+xml')) {
      try { signatureData = await svgToPng(signatureData); } catch { signatureData = undefined; }
    }

    const pdfData = generator({
      worker: {
        id: user.id,
        name: user.name,
        contractType: user.contractType,
        hourlyRate: user.hourlyRate,
        monthlyTargetHours: user.monthlyTargetHours,
        taxClass: user.taxClass as number | undefined,
        svNr: user.svNr,
        steuerId: user.steuerId,
        statusTaetigkeit: user.statusTaetigkeit,
        kinder: user.kinder,
        hasChurchTax: user.hasChurchTax,
        kvZusatzRate: user.kvZusatzRate,
        signatureData,
      },
      entries: toExportEntries(entries),
      month,
      year,
      company,
    });
    onShowPdf(type, pdfData);
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent aria-describedby="worker-detail-description" className="sm:max-w-3xl rounded-[2rem] border-none shadow-2xl p-0 overflow-hidden max-h-[92vh] flex flex-col">

        {/* Dialog Header */}
        <div className="bg-primary p-8 text-white shrink-0">
          <div className="flex items-center gap-4 mb-5">
            <Avatar className="w-14 h-14 border-2 border-white/20 shrink-0">
              <AvatarFallback className="bg-white/20 text-white font-black text-xl">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <DialogTitle className="text-2xl font-black uppercase">{user.name}</DialogTitle>
              <DialogDescription id="worker-detail-description" className="text-white/60 font-bold mt-1">
                {CONTRACT_LABELS[user.contractType ?? ''] ?? 'Mitarbeiter'} • {MONTH_NAMES[month]} {year}
              </DialogDescription>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Vergütete Zeit', value: fmtMin(billableMinutes) },
              { label: 'Fahrtabzug', value: remoteBonusMinutes !== 0 ? fmtMin(remoteBonusMinutes) : '—' },
              { label: 'Überstunden', value: fmtMin(overtimeMinutes) },
              { label: 'Brutto', value: fmtCurrency(brutto) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/10 rounded-2xl p-3 text-center">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/60">{label}</p>
                <p className="text-sm font-black mt-1">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* PDF Export strip */}
        <div className="px-8 py-3 bg-primary/90 shrink-0 flex items-center justify-end gap-2 border-t border-white/10">
          <span className="text-[9px] font-black uppercase tracking-widest text-white/40 mr-auto">PDF Export</span>
          <Button
            size="sm"
            variant="secondary"
            className="font-black text-[10px] uppercase tracking-widest rounded-xl gap-2 bg-white/15 text-white hover:bg-white/25 border-none"
            onClick={() => handleExport('stunden')}
          >
            <FileDown className="w-3.5 h-3.5" />
            Arbeitszeitnachweis
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="font-black text-[10px] uppercase tracking-widest rounded-xl gap-2 bg-white/20 text-white hover:bg-white/30 border border-white/20"
            onClick={() => handleExport('lohn')}
          >
            <FileDown className="w-3.5 h-3.5" />
            Lohnzettel
          </Button>
        </div>

        {/* Sub-tabs */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <Tabs defaultValue="log" className="w-full h-full flex flex-col">
            <TabsList className="w-full rounded-none h-12 bg-gray-50 border-b p-0 shrink-0">
              <TabsTrigger value="log"     className="flex-1 h-full rounded-none font-black text-[10px] uppercase tracking-widest border-r data-[state=active]:bg-white data-[state=active]:text-primary">Tagesprotokoll</TabsTrigger>
              <TabsTrigger value="sites"   className="flex-1 h-full rounded-none font-black text-[10px] uppercase tracking-widest border-r data-[state=active]:bg-white data-[state=active]:text-primary">Standorte</TabsTrigger>
              <TabsTrigger value="payroll" className="flex-1 h-full rounded-none font-black text-[10px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary">Abrechnung</TabsTrigger>
            </TabsList>

            {/* ── Daily log ── */}
            <TabsContent value="log" className="p-5 space-y-3 mt-0">
              {byDate.length === 0 && (
                <p className="text-center text-muted-foreground font-bold py-10">Keine Einträge vorhanden</p>
              )}
              {byDate.map(([date, dayEntries]) => {
                const totalMins = dayEntries.reduce((s, e) => s + (e.entry.actualWorkMinutes ?? 0), 0);
                const clockIns = dayEntries.map(e => new Date(e.entry.clockInDateTime!).getTime());
                const firstIn = new Date(Math.min(...clockIns)).toISOString();
                
                // Calculate dynamic day bonus exactly as in computeMonthlyStats
                const storedDayBonus = dayEntries.reduce((s, e) => s + (e.entry.travelBonusMinutes ?? 0), 0);
                const isFarDay = dayEntries.some(e => {
                  const stored = e.entry.travelBonusMinutes ?? 0;
                  return stored !== 0 ? true : ((e.site?.isRemote ?? false) || Number(e.site?.distanceFromHQ ?? 0) >= 95);
                });
                const computedDayBonus = isFarDay ? Math.max(-60, storedDayBonus !== 0 ? storedDayBonus : -60) : storedDayBonus;
                
                const netDayMins = totalMins + computedDayBonus;

                return (
                  <div key={date} className="rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden">
                    {/* Day header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-100/80">
                      <span className="font-black text-sm">{fmtDate(firstIn)}</span>
                      <div className="flex items-center gap-2">
                        {computedDayBonus < 0 && (
                          <Badge variant="outline" className="text-[9px] font-black bg-red-50 text-red-600 border-red-200">
                            {fmtMin(computedDayBonus)} Fahrt
                          </Badge>
                        )}
                        {computedDayBonus > 0 && (
                          <Badge variant="outline" className="text-[9px] font-black bg-amber-50 text-amber-600 border-amber-200">
                            +{fmtMin(computedDayBonus)} Bonus
                          </Badge>
                        )}
                        <span className="text-xs font-black text-muted-foreground">{fmtMin(netDayMins)}</span>
                      </div>
                    </div>
                    {/* Individual time entries */}
                    <div className="px-4 py-2 space-y-2">
                      {dayEntries.map(({ entry, site, assignment }) => (
                        <div key={entry.id} className="flex items-center gap-2 py-1 border-b border-gray-100 last:border-0">
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>{fmtTime(entry.clockInDateTime!)} – {fmtTime(entry.clockOutDateTime || entry.clockInDateTime!)}</span>
                              <span className="font-black text-foreground ml-1">{fmtMin(entry.actualWorkMinutes ?? 0)}</span>
                            </div>
                            {site && (
                              <p className="text-[10px] text-muted-foreground truncate pl-5">{site.name || site.city}</p>
                            )}
                            {!site && assignment?.title && (
                              <p className="text-[10px] text-muted-foreground truncate pl-5">{assignment.title}</p>
                            )}
                          </div>
                          {/* Storno button */}
                          {onVoidEntry && (
                            confirmVoidId === entry.id ? (
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[9px] text-red-600 font-black">Stornieren?</span>
                                <button
                                  className="text-[9px] font-black text-white bg-red-500 rounded px-2 py-0.5 hover:bg-red-600"
                                  disabled={voidingId === entry.id}
                                  onClick={async () => {
                                    setVoidingId(entry.id);
                                    await onVoidEntry(entry.id);
                                    setVoidingId(null);
                                    setConfirmVoidId(null);
                                  }}
                                >
                                  {voidingId === entry.id ? '…' : 'JA'}
                                </button>
                                <button
                                  className="text-[9px] font-black text-muted-foreground bg-gray-200 rounded px-2 py-0.5 hover:bg-gray-300"
                                  onClick={() => setConfirmVoidId(null)}
                                >
                                  NEIN
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                  {onEditEntry && (
                                    <button
                                      title="Stunden bearbeiten"
                                      className="text-muted-foreground hover:text-blue-500 transition-colors shrink-0 p-1"
                                      onClick={() => {
                                        setEditingEntry({ entry, site, assignment, worker: user });
                                        const sd = new Date(entry.clockInDateTime!);
                                        const ed = entry.clockOutDateTime ? new Date(entry.clockOutDateTime) : new Date();
                                        
                                        const pad = (n: number) => String(n).padStart(2, '0');
                                        setEditStart(`${sd.getFullYear()}-${pad(sd.getMonth()+1)}-${pad(sd.getDate())}T${pad(sd.getHours())}:${pad(sd.getMinutes())}`);
                                        setEditEnd(`${ed.getFullYear()}-${pad(ed.getMonth()+1)}-${pad(ed.getDate())}T${pad(ed.getHours())}:${pad(ed.getMinutes())}`);
                                      }}
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                <button
                                  title="Stunden stornieren"
                                  className="text-muted-foreground hover:text-red-500 transition-colors shrink-0 p-1"
                                  onClick={() => setConfirmVoidId(entry.id)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </TabsContent>

            {/* ── Sites tab ── */}
            <TabsContent value="sites" className="p-5 space-y-3 mt-0">
              {visitedSites.length === 0 && (
                <p className="text-center text-muted-foreground font-bold py-10">Keine Standorte</p>
              )}
              {visitedSites.map(({ site, minutes, visits, isRemote, remoteDeductionMinutes, netMinutes }) => (
                <div key={site.id} className="rounded-2xl border bg-gray-50 p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm truncate">{site.name || site.city}</p>
                    <p className="text-xs text-muted-foreground truncate">{site.address}</p>
                  </div>
                  <div className="text-right shrink-0 min-w-[140px]">
                    {isRemote && remoteDeductionMinutes < 0 && (
                      <Badge className="mb-1 text-[9px] font-black bg-amber-100 text-amber-700 border-amber-200">
                        Remote {fmtMin(remoteDeductionMinutes)}
                      </Badge>
                    )}
                    <p className="font-black text-sm">{fmtMin(netMinutes)}</p>
                    <p className="text-xs text-muted-foreground">{visits}× Einsatz</p>
                    {isRemote && remoteDeductionMinutes < 0 && (
                      <p className="text-[10px] text-muted-foreground">vor Abzug {fmtMin(minutes)}</p>
                    )}
                  </div>
                </div>
              ))}
            </TabsContent>

            {/* ── Payroll tab ── */}
            <TabsContent value="payroll" className="p-5 mt-0">
              <div className="space-y-3">
                <div className="flex justify-between items-center text-base font-black">
                  <span>Bruttolohn</span>
                  <span className="text-primary">{fmtCurrency(brutto)}</span>
                </div>
                <Separator />
                {[
                  { label: `Lohnsteuer (SK ${user.taxClass ?? 1})`, value: payroll.lohnsteuer },
                  ...(payroll.soli > 0 ? [{ label: 'Solidaritätszuschlag', value: payroll.soli }] : []),
                  ...(payroll.kirchensteuer > 0 ? [{ label: 'Kirchensteuer', value: payroll.kirchensteuer }] : []),
                  { label: `Krankenversicherung (${(14.6 + payroll.kvZusatzRate).toFixed(2)}% / 2 = ${(7.3 + payroll.kvZusatzRate / 2).toFixed(2)}% AN)`, value: payroll.krankenversicherung },
                  { label: 'Rentenversicherung (9,3% AN)', value: payroll.rentenversicherung },
                  { label: 'Arbeitslosenversicherung (1,3% AN)', value: payroll.arbeitslosenversicherung },
                  { label: `Pflegeversicherung (${(user.kinder ?? 0) > 0 ? '1,7%' : '2,0%'} AN)`, value: payroll.pflegeversicherung },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center text-sm text-muted-foreground">
                    <span>{label}</span>
                    <span>− {fmtCurrency(value)}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between items-center font-black text-lg">
                  <span>Nettolohn</span>
                  <span className="text-green-700">{fmtCurrency(payroll.netto)}</span>
                </div>
                <p className="text-[9px] text-muted-foreground/60 leading-relaxed pt-2">
                  * Vereinfachte Simulation. Keine rechtsgültige Lohnabrechnung.
                  SK {user.taxClass ?? 1} · {user.kinder ?? 0} Kinder · {user.bundesland ?? 'ST'} · KV-Zusatz {payroll.kvZusatzRate.toFixed(2)}%
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>

      {/* Edit Dialog */}
      <Dialog open={!!editingEntry} onOpenChange={o => !o && setEditingEntry(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl border-none shadow-2xl p-6">
          <DialogTitle className="text-xl font-black text-primary">Zeiteintrag bearbeiten</DialogTitle>
          <DialogDescription className="text-muted-foreground font-medium mb-4">
            Passen Sie die Arbeitszeiten für diesen Eintrag an.
          </DialogDescription>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-primary/60 tracking-widest">Startzeit</Label>
              <Input
                type="datetime-local"
                value={editStart}
                onChange={e => setEditStart(e.target.value)}
                className="rounded-xl font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-primary/60 tracking-widest">Endzeit</Label>
              <Input
                type="datetime-local"
                value={editEnd}
                onChange={e => setEditEnd(e.target.value)}
                className="rounded-xl font-bold"
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => setEditingEntry(null)}
              className="rounded-xl font-bold border-gray-200"
              disabled={isEditing}
            >
              Abbrechen
            </Button>
            <Button
              className="rounded-xl font-black px-6"
              disabled={isEditing || !editStart || !editEnd}
              onClick={async () => {
                if (!editingEntry || !onEditEntry) return;
                setIsEditing(true);
                try {
                  await onEditEntry(editingEntry.entry.id, editStart, editEnd);
                  setEditingEntry(null);
                } catch (e) {
                  // error handled in parent
                } finally {
                  setIsEditing(false);
                }
              }}
            >
              {isEditing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

// ─── Reports Page ─────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear,  setSelectedYear]  = useState(now.getFullYear());
  const [selectedWorkerStats, setSelectedWorkerStats] = useState<WorkerMonthStats | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState('');

  const { toast } = useToast();
  const { userProfile } = useAuth();

  const companyId = userProfile?.companyId ?? '';
  const role = userProfile?.role ?? 'WORKER';
  const userName = userProfile?.name ?? '';
  const hasContext = !!userProfile && !!companyId;
  const canManageTeam = role === 'ADMIN' || role === 'LEADER';

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: rawEmployees, isLoading: isEmployeesLoading } = useQuery({
    table: 'users',
    filters: { company_id: companyId },
    enabled: hasContext,
  });

  const { data: rawTimeEntries, isLoading: isTimeEntriesLoading, refresh: refreshTimeEntries } = useQuery({
    table: 'time_entries',
    filters: { company_id: companyId },
    enabled: hasContext,
  });

  const { data: rawAssignments, isLoading: isAssignmentsLoading } = useQuery({
    table: 'job_assignments',
    filters: { company_id: companyId },
    enabled: hasContext,
  });

  const { data: rawSites, isLoading: isSitesLoading } = useQuery({
    table: 'job_sites',
    filters: { company_id: companyId },
    enabled: hasContext,
  });

  const { data: rawCompany } = useQuery({
    table: 'companies',
    filters: { id: companyId },
    enabled: hasContext,
  });

  const company = useMemo<CompanySettings | undefined>(() => {
    const row = (rawCompany as any[])?.[0];
    if (!row) return undefined;
    return {
      name:        row.name        ?? '',
      siteName:    row.site_name   ?? undefined,
      address:     row.address     ?? undefined,
      city:        row.city        ?? undefined,
      postalCode:  row.postal_code ?? undefined,
      taxNumber:   row.tax_number  ?? undefined,
      phone:       row.phone       ?? undefined,
      email:       row.email       ?? undefined,
      website:     row.website     ?? undefined,
      logoData:    row.logo_data   ?? undefined,
    };
  }, [rawCompany]);

  const isLoading = isEmployeesLoading || isTimeEntriesLoading || isAssignmentsLoading || isSitesLoading;

  // ── DB → App type mappers ─────────────────────────────────────────────────

  const employees = useMemo<User[]>(() => (rawEmployees ?? []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    companyId: u.company_id,
    contractType: u.contract_type,
    hourlyRate: u.hourly_rate,
    monthlyTargetHours: u.monthly_target_hours,
    taxClass: u.tax_class,
    kinder: u.kinder,
    bundesland: u.bundesland,
    hasChurchTax: u.has_church_tax,
    svNr: u.sv_nr,
    steuerId: u.steuer_id,
    statusTaetigkeit: u.status_taetigkeit,
    kvZusatzRate:  parseFloat(u.kv_zusatz_rate) || 1.7,
    signatureData: u.signature_data ?? undefined,
  })), [rawEmployees]);

  const timeEntries = useMemo<TimeEntry[]>(() => (rawTimeEntries ?? []).map((e: any) => ({
    id: e.id,
    employeeId: e.employee_id,
    jobAssignmentId: e.job_assignment_id ?? undefined,
    jobSiteId: e.job_site_id ?? undefined,
    clockInDateTime: e.clock_in_datetime ?? undefined,
    clockOutDateTime: e.clock_out_datetime ?? undefined,
    actualWorkMinutes: e.actual_work_minutes ?? undefined,
    travelBonusMinutes: e.travel_bonus_minutes ?? undefined,
    status: e.status,
  })), [rawTimeEntries]);

  const assignments = useMemo<JobAssignment[]>(() => (rawAssignments ?? []).map((a: any) => ({
    id: a.id,
    jobSiteId: a.job_site_id ?? undefined,
    assignedWorkerIds: a.assigned_worker_ids ?? [],
    scheduledDate: a.scheduled_date,
    title: a.title,
    categories: a.categories ?? [],
    status: a.status,
  })), [rawAssignments]);

  const jobSites = useMemo<JobSite[]>(() => (rawSites ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    city: s.city,
    address: s.address,
    postalCode: s.postal_code ?? '',
    region: s.region ?? '',
    routeCode: s.route_code ?? '',
    isRemote: s.is_remote,
    distanceFromHQ: s.distance_from_hq ?? 0,
    estimatedTravelTimeMinutesFromHQ: s.estimated_travel_time_minutes_from_hq ?? 0,
    travelTimeFromHQ: s.travel_time_from_hq ?? 0,
    location: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : undefined,
    services: s.services ?? {},
  })), [rawSites]);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const workerStats = useMemo(() => {
    if (!employees.length || !timeEntries.length) return [];
    return computeMonthlyStats(employees, timeEntries, assignments, jobSites, selectedMonth, selectedYear);
  }, [employees, timeEntries, assignments, jobSites, selectedMonth, selectedYear]);

  const siteStats = useMemo(() => {
    if (!timeEntries.length) return [];
    return computeSiteStats(timeEntries, assignments, jobSites, selectedMonth, selectedYear);
  }, [timeEntries, assignments, jobSites, selectedMonth, selectedYear]);

  const totalBrutto      = workerStats.reduce((s, w) => s + w.brutto, 0);
  const totalWorkMinutes = workerStats.reduce((s, w) => s + w.billableMinutes, 0);

  // ── Void (stornieren) a time entry ────────────────────────────────────────

  const handleVoidEntry = async (entryId: string) => {
    try {
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          table: 'time_entries',
          filters: { id: entryId },
          data: { status: 'REJECTED', actual_work_minutes: 0, travel_bonus_minutes: 0 },
        }),
      });
      refreshTimeEntries();
      toast({ title: 'Stunden storniert', description: 'Der Zeiteintrag wurde auf 0 gesetzt.' });
    } catch {
      toast({ variant: 'destructive', title: 'Stornierung fehlgeschlagen' });
    }
  };

  // ── Edit a time entry ──────────────────────────────────────────────────────
  const handleEditEntry = async (entryId: string, start: string, end: string) => {
    try {
      const startDate = new Date(start);
      const endDate = new Date(end);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Ungültiges Datum');
      }
      if (endDate <= startDate) {
        throw new Error('Das Enddatum muss nach dem Startdatum liegen');
      }

      const actualWorkMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          table: 'time_entries',
          filters: { id: entryId, company_id: companyId },
          data: { 
            clock_in_datetime: startDate.toISOString(),
            clock_out_datetime: endDate.toISOString(),
            actual_work_minutes: actualWorkMinutes
          }
        })
      });
      if (!res.ok) throw new Error('Bearbeiten fehlgeschlagen');
      toast({ description: 'Zeiteintrag erfolgreich aktualisiert.' });
      refreshTimeEntries();
    } catch (e: any) {
      toast({ variant: 'destructive', description: e.message || 'Fehler beim Bearbeiten' });
      throw e;
    }
  };

  // ── PDF viewer ─────────────────────────────────────────────────────────────

  const handleShowPdf = (type: 'stunden' | 'lohn', data: string) => {
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl.split('#')[0]);
    }
    setPdfUrl(data);
    setPdfTitle(type === 'stunden' ? 'Arbeitszeitnachweis' : 'Lohnzettel');
  };

  const handleDownloadPdf = () => {
    if (pdfUrl && selectedWorkerStats) {
      const name = selectedWorkerStats.user.name.replace(/\s+/g, '_');
      const month = MONTH_NAMES[selectedMonth];
      const year = selectedYear;
      const typeStr = pdfTitle === 'Arbeitszeitnachweis' ? 'ARBEITSZEIT' : 'LOHNZETTEL';
      const fileName = `${name}_${month}_${year}_${typeStr}.pdf`;
      save(pdfUrl.split('#')[0], fileName);
    }
  };

  const closePdfPreview = () => {
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl.split('#')[0]);
    }
    setPdfUrl(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Shell userRole={role} userName={userName}>
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase">Berichte</h1>
            <p className="text-muted-foreground font-medium">Monatliche Auswertung & Lohnabrechnung</p>
          </div>
        </div>

        {/* Page-level tabs */}
        <Tabs defaultValue="auswertung" className="w-full">
          <TabsList className="w-full rounded-[1.5rem] h-14 bg-gray-100/80 p-1.5 mb-8 shadow-inner border border-gray-200/50">
            <TabsTrigger 
              value="auswertung" 
              className="flex-1 flex items-center justify-center gap-2 rounded-[1.2rem] font-black text-xs uppercase tracking-widest text-muted-foreground transition-all data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-primary data-[state=active]:scale-[0.98]"
            >
              <FileText className="w-4 h-4" />
              <span>Auswertung</span>
            </TabsTrigger>
            <TabsTrigger 
              value="medien" 
              className="flex-1 flex items-center justify-center gap-2 rounded-[1.2rem] font-black text-xs uppercase tracking-widest text-muted-foreground transition-all data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-primary data-[state=active]:scale-[0.98]"
            >
              <ImageIcon className="w-4 h-4" />
              <span>Medien-Archiv</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Auswertung tab ── */}
          <TabsContent value="auswertung" className="mt-0 space-y-8">

          {/* Month/Year selectors */}
          <div className="flex justify-end gap-2">
            <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-36 font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={i} value={String(i)} className="font-bold">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-24 font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[now.getFullYear(), now.getFullYear() - 1].map(y => (
                  <SelectItem key={y} value={String(y)} className="font-bold">{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: Users,     label: 'Mitarbeiter',     value: workerStats.length },
            { icon: Timer,     label: 'Gesamtstunden',   value: fmtMin(totalWorkMinutes) },
            { icon: TrendingUp, label: 'Gesamt Brutto',  value: fmtCurrency(totalBrutto) },
          ].map(({ icon: Icon, label, value }) => (
            <Card key={label} className="rounded-3xl border-none shadow-md">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-2xl">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                  <p className="text-2xl font-black text-primary">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="font-bold">Daten werden geladen…</span>
          </div>
        )}

        {!isLoading && workerStats.length === 0 && (
          <Card className="rounded-3xl border-none shadow-md">
            <CardContent className="py-16 text-center">
              <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="font-black text-muted-foreground">
                Keine abgeschlossenen Zeiteinträge für {MONTH_NAMES[selectedMonth]} {selectedYear}.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Worker table */}
        {!isLoading && workerStats.length > 0 && (
          <Card className="rounded-3xl border-none shadow-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="font-black uppercase tracking-widest text-[10px]">Mitarbeiter</TableHead>
                  <TableHead className="font-black uppercase tracking-widest text-[10px] text-right">Arbeitszeit</TableHead>
                  <TableHead className="font-black uppercase tracking-widest text-[10px] text-right hidden sm:table-cell">Remote</TableHead>
                  <TableHead className="font-black uppercase tracking-widest text-[10px] text-right">Brutto</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {workerStats.map(stats => (
                  <TableRow
                    key={stats.user.id}
                    className="cursor-pointer hover:bg-primary/5 transition-colors"
                    onClick={() => setSelectedWorkerStats(stats)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-9 h-9 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary font-black text-xs">
                            {initials(stats.user.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-black text-sm">{stats.user.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {CONTRACT_LABELS[stats.user.contractType ?? ''] ?? '—'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-bold text-sm">{fmtMin(stats.billableMinutes)}</TableCell>
                    <TableCell className="text-right font-bold text-sm text-red-600 hidden sm:table-cell">
                      {stats.remoteBonusMinutes !== 0 ? fmtMin(stats.remoteBonusMinutes) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-black text-sm text-primary">{fmtCurrency(stats.brutto)}</TableCell>
                    <TableCell>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Site stats */}
        {!isLoading && siteStats.length > 0 && (
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-primary mb-4">Standortübersicht</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {siteStats.slice(0, 8).map(stat => (
                <Card key={stat.site.id} className="rounded-2xl border-none shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-xl shrink-0">
                      <MapPin className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm truncate">{stat.site.name || stat.site.city}</p>
                      <p className="text-xs text-muted-foreground">
                        {stat.totalVisits}× · {stat.workerIds.size} MA · {fmtMin(stat.totalMinutes)}
                      </p>
                    </div>
                    {stat.isRemote && (
                      <Badge className="text-[9px] font-black bg-amber-100 text-amber-700 border-amber-200 shrink-0">Remote</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

          </TabsContent>

          {/* ── Medien-Archiv tab ── */}
          <TabsContent value="medien" className="mt-0">
            <SiteMediaBrowser companyId={companyId} sites={jobSites} />
          </TabsContent>

        </Tabs>
      </div>

      {/* Worker detail dialog */}
      {selectedWorkerStats && (
        <WorkerDetailDialog
          stats={selectedWorkerStats}
          month={selectedMonth}
          year={selectedYear}
          open={!!selectedWorkerStats}
          onClose={() => setSelectedWorkerStats(null)}
          onShowPdf={handleShowPdf}
          company={company}
          onVoidEntry={canManageTeam ? handleVoidEntry : undefined}
          onEditEntry={canManageTeam ? handleEditEntry : undefined}
        />
      )}

      {/* PDF preview dialog */}
      {pdfUrl && (
        <Dialog open={!!pdfUrl} onOpenChange={o => !o && closePdfPreview()}>
          <DialogContent hideClose aria-describedby="pdf-preview-description" className="sm:max-w-4xl h-[90vh] flex flex-col rounded-[2rem] border-none shadow-2xl p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 bg-primary text-white shrink-0">
              <div>
                <DialogTitle className="font-black uppercase tracking-tight">{pdfTitle}</DialogTitle>
                <DialogDescription id="pdf-preview-description" className="text-white/60 text-xs font-bold">
                  {selectedWorkerStats?.user.name} · {MONTH_NAMES[selectedMonth]} {selectedYear}
                </DialogDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white/20 text-white hover:bg-white/30 border-none font-black text-[10px] uppercase tracking-widest rounded-xl gap-2"
                  onClick={handleDownloadPdf}
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Herunterladen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white hover:bg-white/20 rounded-xl"
                  onClick={closePdfPreview}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-gray-100 p-4">
              <iframe
                src={pdfUrl}
                className="w-full h-full rounded-xl border-none"
                title={pdfTitle}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Shell>
  );
}
