"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/layout/Shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Wallet, Users, Banknote, RotateCcw, CheckCircle2, Clock,
  Loader2, ChevronRight, AlertCircle, Info, History, Edit2, Trash2,
} from 'lucide-react';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';

// ─── Constants ────────────────────────────────────────────────────────────────

const MINIJOB_LIMIT_EUR = 603; // Minijob-Grenze ab 01.01.2026
const MONTH_NAMES = [
  'Januar','Februar','März','April','Mai','Juni',
  'Juli','August','September','Oktober','November','Dezember',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkerStats {
  id: string;
  name: string;
  hourlyRate: number;
  contractType: string;
  totalMinutes: number;          // aus reports-Logik
  prevRolloverMinutes: number;   // aus letztem Settlement
  netMinutes: number;            // total + prev
  // Settlement (falls schon gespeichert)
  settlement?: Settlement | null;
}

interface Settlement {
  id: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  totalMinutes: number;
  prevRolloverMinutes: number;
  netMinutes: number;
  minijobMinutes: number;
  cashMinutes: number;
  rolloverMinutes: number;
  hourlyRate: number;
  cashHourlyRate: number;
  minijobLimitEur: number;
  minijobAmount: number;
  cashAmount: number;
  status: 'DRAFT' | 'SETTLED';
  notes: string | null;
  settledAt: string | null;
  employeeName?: string;
}

interface TimeEntryRow {
  employee_id: string;
  actual_work_minutes: number | null;
  travel_bonus_minutes: number | null;
  clock_in_datetime: string;
  status: string;
  job_site_id: string | null;
}

interface UserRow {
  id: string;
  name: string;
  hourly_rate: number;
  contract_type: string;
  company_id: string;
}

interface SiteRow {
  id: string;
  is_remote: boolean;
  distance_from_hq: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMin(min: number): string {
  if (min === 0) return '0h 0m';
  const neg = min < 0;
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${neg ? '-' : ''}${h}h${m > 0 ? ` ${m}m` : ''}`;
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function getPeriod(month: number, year: number) {
  const prevM  = month === 0 ? 11 : month - 1;
  const prevY  = month === 0 ? year - 1 : year;
  const startDate = `${prevY}-${String(prevM + 1).padStart(2, '0')}-21`;
  const endDate   = `${year}-${String(month + 1).padStart(2, '0')}-20`;
  const label = `21. ${MONTH_NAMES[prevM]} – 20. ${MONTH_NAMES[month]} ${year}`;
  return { startDate, endDate, label, month, year };
}

function minutesToEur(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate * 100) / 100;
}

function calcMinijobMax(hourlyRate: number, limitEur: number): number {
  if (hourlyRate <= 0) return 0;
  return Math.floor((limitEur / hourlyRate) * 60); // in minutes
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();

  const now = new Date();
  const [selMonth, setSelMonth] = useState(now.getMonth());
  const [selYear,  setSelYear]  = useState(now.getFullYear());
  const period = useMemo(() => getPeriod(selMonth, selYear), [selMonth, selYear]);

  const [workers,     setWorkers]     = useState<WorkerStats[]>([]);
  const [settlements, setSettlements] = useState<Map<string, Settlement>>(new Map());
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState<string | null>(null); // employeeId being saved

  const [editWorker,  setEditWorker]  = useState<WorkerStats | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<Settlement[]>([]);
  const [historyEmployee, setHistoryEmployee] = useState<WorkerStats | null>(null);
  // For editing a historical (past-period) settlement from within Verlauf
  const [historyEditSettlement, setHistoryEditSettlement] = useState<Settlement | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const companyId = userProfile.companyId;

      // 1. Load all workers (WORKER + LEADER)
      const usersRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query', table: 'users',
          filters: { company_id: companyId },
        }),
      }).then(r => r.json());
      // Only MINIJOB workers — VOLLZEIT/MIDIJOB/TEILZEIT are NOT managed here
      const allUsers: UserRow[] = (usersRes.data ?? []).filter(
        (u: any) => (u.role === 'WORKER' || u.role === 'LEADER') && u.contract_type === 'MINIJOB'
      );

      // 2. Load time entries for the period
      const entriesRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query_range', table: 'time_entries',
          filters: { company_id: companyId },
          rangeFilters: [
            { column: 'clock_in_datetime', gte: `${period.startDate}T00:00:00`, lte: `${period.endDate}T23:59:59` },
          ],
          select: 'employee_id,actual_work_minutes,travel_bonus_minutes,clock_in_datetime,status,job_site_id',
        }),
      }).then(r => r.json());
      const entries: TimeEntryRow[] = (entriesRes.data ?? []).filter(
        (e: any) => e.status === 'SUBMITTED' || e.status === 'APPROVED'
      );

      // 3. Load job sites for travel bonus calc
      const sitesRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query', table: 'job_sites',
          filters: { company_id: companyId },
          select: 'id,is_remote,distance_from_hq',
        }),
      }).then(r => r.json());
      const siteMap = new Map<string, SiteRow>();
      (sitesRes.data ?? []).forEach((s: SiteRow) => siteMap.set(s.id, s));

      // 4. Compute work minutes per employee (with travel bonus cap)
      const minutesByEmployee = new Map<string, number>();
      const bonusByEmployeeDay = new Map<string, Map<string, number>>();

      entries.forEach(e => {
        if (!e.employee_id) return;
        const workMin = e.actual_work_minutes ?? 0;
        minutesByEmployee.set(e.employee_id, (minutesByEmployee.get(e.employee_id) ?? 0) + workMin);

        // Travel bonus per day
        const stored = e.travel_bonus_minutes ?? 0;
        const site   = e.job_site_id ? siteMap.get(e.job_site_id) : null;
        const isFar  = stored !== 0 ? true :
          ((site?.is_remote ?? false) || Number(site?.distance_from_hq ?? 0) >= 95);
        if (!isFar) return;
        const day = e.clock_in_datetime.split('T')[0];
        if (!bonusByEmployeeDay.has(e.employee_id)) bonusByEmployeeDay.set(e.employee_id, new Map());
        const dayMap = bonusByEmployeeDay.get(e.employee_id)!;
        const prev   = dayMap.get(day) ?? 0;
        dayMap.set(day, Math.max(-60, prev + (stored !== 0 ? stored : -60)));
      });

      // 5. Load existing settlements for this period
      const settlementsRes = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', companyId, periodStart: period.startDate }),
      }).then(r => r.json());
      const settledMap = new Map<string, Settlement>();
      (settlementsRes.data ?? []).forEach((row: any) => {
        settledMap.set(row.employee_id, rowToSettlement(row));
      });

      // 6. Load previous rollovers for each worker
      const prevRollovers = await Promise.all(
        allUsers.map(u =>
          fetch('/api/payroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'prev_rollover',
              companyId,
              employeeId: u.id,
              beforePeriodStart: period.startDate,
            }),
          }).then(r => r.json()).then(d => ({ id: u.id, rollover: d.data?.rollover_minutes ?? 0 }))
        )
      );
      const prevRolloverMap = new Map(prevRollovers.map(r => [r.id, r.rollover]));

      // 7. Build WorkerStats
      const stats: WorkerStats[] = allUsers.map(u => {
        const totalWork   = minutesByEmployee.get(u.id) ?? 0;
        // Sum per-day capped travel bonus for this employee (negative = deduction)
        const dayBonuses  = bonusByEmployeeDay.get(u.id);
        const travelBonus = dayBonuses
          ? Array.from(dayBonuses.values()).reduce((s, v) => s + v, 0)
          : 0;
        // Vergütete Zeit = Reine Arbeitszeit + Fahrtabzug (consistent with Berichte)
        const totalMin   = totalWork + travelBonus;
        const prevRoll   = prevRolloverMap.get(u.id) ?? 0;
        const net        = totalMin + prevRoll;
        return {
          id: u.id,
          name: u.name,
          hourlyRate: u.hourly_rate ?? 13,
          contractType: u.contract_type ?? 'MINIJOB',
          totalMinutes: totalMin,
          prevRolloverMinutes: prevRoll,
          netMinutes: net,
          settlement: settledMap.get(u.id) ?? null,
        };
      }).filter(w => w.totalMinutes > 0 || w.prevRolloverMinutes > 0 || w.settlement);

      setWorkers(stats);
      setSettlements(settledMap);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: e.message });
    } finally {
      setLoading(false);
    }
  }, [userProfile, period, toast]);

  useEffect(() => { load(); }, [load]);

  // ── Save (upsert) ─────────────────────────────────────────────────────────
  const handleSave = async (w: WorkerStats, draft: DraftValues) => {
    if (!userProfile) return;
    setSaving(w.id);
    try {
      const minijobAmount = minutesToEur(draft.minijobMinutes, w.hourlyRate);
      const cashAmount    = minutesToEur(draft.cashMinutes, draft.cashHourlyRate);
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          companyId:            userProfile.companyId,
          employeeId:           w.id,
          periodStart:          period.startDate,
          periodEnd:            period.endDate,
          totalMinutes:         w.totalMinutes,
          prevRolloverMinutes:  w.prevRolloverMinutes,
          netMinutes:           w.netMinutes,
          minijobMinutes:       draft.minijobMinutes,
          cashMinutes:          draft.cashMinutes,
          rolloverMinutes:      draft.rolloverMinutes,
          hourlyRate:           w.hourlyRate,
          cashHourlyRate:       draft.cashHourlyRate,
          minijobLimitEur:      MINIJOB_LIMIT_EUR,
          minijobAmount,
          cashAmount,
          notes:                draft.notes,
        }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      toast({ title: 'Gespeichert', description: `Abrechnung für ${w.name} wurde gespeichert.` });
      setEditWorker(null);
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: e.message });
    } finally {
      setSaving(null);
    }
  };

  // ── Settle ────────────────────────────────────────────────────────────────
  const handleSettle = async (w: WorkerStats) => {
    if (!userProfile) return;
    setSaving(w.id);
    try {
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settle',
          companyId:   userProfile.companyId,
          employeeId:  w.id,
          periodStart: period.startDate,
        }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      toast({ title: 'Abgerechnet', description: `${w.name} wurde abgerechnet und gesperrt.` });
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: e.message });
    } finally {
      setSaving(null);
    }
  };

  // ── Delete draft ──────────────────────────────────────────────────────────
  const handleDelete = async (w: WorkerStats) => {
    if (!userProfile) return;
    setSaving(w.id);
    try {
      await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          companyId:   userProfile.companyId,
          employeeId:  w.id,
          periodStart: period.startDate,
        }),
      });
      await load();
    } finally {
      setSaving(null);
    }
  };

  // ── Save a historical (past-period) draft edit ────────────────────────────
  const handleHistorySave = async (s: Settlement, draft: DraftValues) => {
    if (!userProfile || !historyEmployee) return;
    setSaving(historyEmployee.id);
    try {
      const minijobAmount = minutesToEur(draft.minijobMinutes, s.hourlyRate);
      const cashAmount    = minutesToEur(draft.cashMinutes, draft.cashHourlyRate);
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          companyId:           userProfile.companyId,
          employeeId:          s.employeeId,
          periodStart:         s.periodStart,
          periodEnd:           s.periodEnd,
          totalMinutes:        s.totalMinutes,
          prevRolloverMinutes: s.prevRolloverMinutes,
          netMinutes:          s.netMinutes,
          minijobMinutes:      draft.minijobMinutes,
          cashMinutes:         draft.cashMinutes,
          rolloverMinutes:     draft.rolloverMinutes,
          hourlyRate:          s.hourlyRate,
          cashHourlyRate:      draft.cashHourlyRate,
          minijobLimitEur:     s.minijobLimitEur,
          minijobAmount,
          cashAmount,
          notes:               draft.notes,
        }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      toast({ title: 'Korrigiert', description: 'Abrechnung wurde aktualisiert.' });
      setHistoryEditSettlement(null);
      // Reload history list
      const reloaded = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query', table: 'payroll_settlements',
          filters: { company_id: userProfile.companyId, employee_id: s.employeeId },
          orderBy: { column: 'period_start', ascending: false },
        }),
      }).then(r => r.json());
      setHistoryData((reloaded.data ?? []).map(rowToSettlement));
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: e.message });
    } finally {
      setSaving(null);
    }
  };

  // ── Load history ──────────────────────────────────────────────────────────
  const openHistory = async (w: WorkerStats) => {
    if (!userProfile) return;
    setHistoryEmployee(w);
    setHistoryOpen(true);
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'query', table: 'payroll_settlements',
        filters: { company_id: userProfile.companyId, employee_id: w.id },
        orderBy: { column: 'period_start', ascending: false },
      }),
    }).then(r => r.json());
    setHistoryData((res.data ?? []).map(rowToSettlement));
  };

  // ── Summary totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let totalH = 0, minijobH = 0, cashH = 0, rollH = 0, minijobEur = 0, cashEur = 0;
    workers.forEach(w => {
      const s = settlements.get(w.id);
      totalH    += w.netMinutes;
      if (s) {
        minijobH   += s.minijobMinutes;
        cashH      += s.cashMinutes;
        rollH      += s.rolloverMinutes;
        minijobEur += s.minijobAmount;
        cashEur    += s.cashAmount;
      }
    });
    return { totalH, minijobH, cashH, rollH, minijobEur, cashEur };
  }, [workers, settlements]);

  if (!userProfile) return null;

  return (
    <Shell userRole={userProfile.role} userName={userProfile.name}>
      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary flex items-center gap-2">
              <Wallet className="w-6 h-6" /> Lohnabrechnung
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Minijob-Verwaltung · Barzahlung · Stundenübertrag
            </p>
          </div>
          <PeriodSelector
            month={selMonth} year={selYear}
            onChange={(m, y) => { setSelMonth(m); setSelYear(y); }}
          />
        </div>

        {/* ── Period label ── */}
        <div className="bg-primary/5 border border-primary/15 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Info className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-primary">{period.label}</span>
        </div>

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Gesamtstunden',  value: fmtMin(totals.totalH),   icon: Clock,     color: 'text-primary'  },
            { label: 'Minijob (Bank)', value: fmtEur(totals.minijobEur), icon: Banknote, color: 'text-blue-600' },
            { label: 'Bar',            value: fmtEur(totals.cashEur),   icon: Wallet,    color: 'text-green-600'},
            { label: 'Übertrag',       value: fmtMin(totals.rollH),     icon: RotateCcw, color: 'text-amber-600'},
          ].map(c => (
            <Card key={c.label} className="rounded-2xl shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-xl bg-muted ${c.color}`}>
                  <c.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{c.label}</p>
                  <p className={`text-lg font-black ${c.color}`}>{c.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Workers table ── */}
        <Card className="rounded-2xl shadow-sm overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : workers.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-2">
                <Users className="w-12 h-12 text-muted-foreground/30" />
                <p className="text-muted-foreground font-semibold">Keine Einträge für diesen Zeitraum</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-black">Mitarbeiter</TableHead>
                    <TableHead className="text-right font-black">Stunden</TableHead>
                    <TableHead className="text-right font-black">+ Übertrag</TableHead>
                    <TableHead className="text-right font-black">Netto</TableHead>
                    <TableHead className="text-right font-black">Minijob</TableHead>
                    <TableHead className="text-right font-black">Bar</TableHead>
                    <TableHead className="text-right font-black">→ Übertrag</TableHead>
                    <TableHead className="text-center font-black">Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers.map(w => {
                    const s   = settlements.get(w.id);
                    const isSaving = saving === w.id;
                    return (
                      <TableRow key={w.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="text-xs font-black bg-primary/10 text-primary">
                                {w.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold text-sm">{w.name}</p>
                              <p className="text-xs text-muted-foreground">{fmtEur(w.hourlyRate)}/Std.</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtMin(w.totalMinutes)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-600">
                          {w.prevRolloverMinutes > 0 ? `+${fmtMin(w.prevRolloverMinutes)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right font-black text-sm text-primary">{fmtMin(w.netMinutes)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-blue-600">
                          {s ? fmtEur(s.minijobAmount) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-green-600">
                          {s ? fmtEur(s.cashAmount) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-600">
                          {s && s.rolloverMinutes > 0 ? fmtMin(s.rolloverMinutes) : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          {s ? (
                            <Badge className={
                              s.status === 'SETTLED'
                                ? 'bg-green-100 text-green-700 border-green-200 font-black'
                                : 'bg-amber-100 text-amber-700 border-amber-200 font-black'
                            }>
                              {s.status === 'SETTLED' ? 'Abgerechnet' : 'Entwurf'}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground font-semibold">Offen</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            {isSaving ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Verlauf"
                                  onClick={() => openHistory(w)}>
                                  <History className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Bearbeiten"
                                  onClick={() => setEditWorker(w)}>
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                {s?.status === 'DRAFT' && (
                                  <>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:text-green-700" title="Abrechnen"
                                      onClick={() => handleSettle(w)}>
                                      <CheckCircle2 className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive/80" title="Löschen"
                                      onClick={() => handleDelete(w)}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ── Info box ── */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-700 space-y-1">
            <p className="font-semibold">Minijob-Grenze: {fmtEur(MINIJOB_LIMIT_EUR)}/Monat</p>
            <p>Der Minijob-Betrag wird per Banküberweisung überwiesen. Alles darüber hinaus kann bar ausgezahlt oder auf den nächsten Monat übertragen werden.</p>
          </div>
        </div>
      </div>

      {/* ── Edit/Create dialog ── */}
      {editWorker && (
        <EditDialog
          worker={editWorker}
          existingSettlement={settlements.get(editWorker.id) ?? null}
          saving={saving === editWorker.id}
          onSave={(draft) => handleSave(editWorker, draft)}
          onClose={() => setEditWorker(null)}
        />
      )}

      {/* ── History dialog ── */}
      <Dialog open={historyOpen} onOpenChange={v => { setHistoryOpen(v); if (!v) setHistoryEditSettlement(null); }}>
        <DialogContent className="max-w-3xl rounded-3xl">
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" /> Verlauf — {historyEmployee?.name}
          </DialogTitle>
          <DialogDescription>
            Alle Abrechnungsperioden · Jede Periode kann bearbeitet werden
          </DialogDescription>

          {historyEditSettlement ? (
            /* ── Inline correction editor ── */
            <div className="space-y-4 pt-1">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-sm font-semibold text-amber-700">
                  Korrektur: {historyEditSettlement.periodStart} → {historyEditSettlement.periodEnd}
                  {historyEditSettlement.status === 'SETTLED' && (
                    <span className="block text-xs font-normal mt-0.5">
                      Abgeschlossene Abrechnung — wird nach dem Speichern auf Entwurf zurückgesetzt.
                    </span>
                  )}
                </span>
              </div>
              <HistoryEditForm
                settlement={historyEditSettlement}
                saving={saving === historyEmployee?.id}
                onSave={(draft) => handleHistorySave(historyEditSettlement, draft)}
                onCancel={() => setHistoryEditSettlement(null)}
              />
            </div>
          ) : historyData.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Keine Abrechnungen vorhanden</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Zeitraum</TableHead>
                  <TableHead className="text-right">Netto-Std.</TableHead>
                  <TableHead className="text-right">Minijob</TableHead>
                  <TableHead className="text-right">Bar</TableHead>
                  <TableHead className="text-right font-black text-amber-700">→ Übertrag</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyData.map(s => (
                  <TableRow key={s.id} className={s.rolloverMinutes > 0 ? 'bg-amber-50/40' : ''}>
                    <TableCell className="text-sm font-mono text-xs">
                      {s.periodStart} → {s.periodEnd}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtMin(s.netMinutes)}</TableCell>
                    <TableCell className="text-right text-blue-600 font-mono text-sm">{fmtEur(s.minijobAmount)}</TableCell>
                    <TableCell className="text-right text-green-600 font-mono text-sm">{fmtEur(s.cashAmount)}</TableCell>
                    <TableCell className="text-right font-black text-sm">
                      {s.rolloverMinutes > 0 ? (
                        <span className="text-amber-600 flex items-center justify-end gap-1">
                          <RotateCcw className="w-3 h-3" /> {fmtMin(s.rolloverMinutes)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={s.status === 'SETTLED'
                        ? 'bg-green-100 text-green-700 border-green-200 font-black text-xs'
                        : 'bg-amber-100 text-amber-700 border-amber-200 font-black text-xs'
                      }>
                        {s.status === 'SETTLED' ? 'Abgerechnet' : 'Entwurf'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Korrigieren"
                        onClick={() => setHistoryEditSettlement(s)}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

// ─── Period Selector ──────────────────────────────────────────────────────────

function PeriodSelector({ month, year, onChange }: {
  month: number; year: number;
  onChange: (m: number, y: number) => void;
}) {
  const years = [year - 1, year, year + 1];
  return (
    <div className="flex items-center gap-2">
      <Select value={String(month)} onValueChange={v => onChange(Number(v), year)}>
        <SelectTrigger className="w-36 rounded-xl font-semibold">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONTH_NAMES.map((m, i) => (
            <SelectItem key={i} value={String(i)}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(year)} onValueChange={v => onChange(month, Number(v))}>
        <SelectTrigger className="w-24 rounded-xl font-semibold">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

interface DraftValues {
  minijobMinutes: number;
  cashMinutes: number;
  rolloverMinutes: number;
  cashHourlyRate: number;
  notes: string;
}

function EditDialog({ worker, existingSettlement, saving, onSave, onClose }: {
  worker: WorkerStats;
  existingSettlement: Settlement | null;
  saving: boolean;
  onSave: (draft: DraftValues) => void;
  onClose: () => void;
}) {
  const maxMinijob  = calcMinijobMax(worker.hourlyRate, MINIJOB_LIMIT_EUR);
  const net         = worker.netMinutes;

  // Auto-calculate defaults: fill Minijob first, rest = cash, rollover = 0
  const defaultMinijob  = Math.min(maxMinijob, net);
  const defaultCash     = Math.max(0, net - defaultMinijob);

  const [minijobH, setMinijobH] = useState(
    existingSettlement ? Math.floor(existingSettlement.minijobMinutes / 60) : Math.floor(defaultMinijob / 60)
  );
  const [minijobM, setMinijobM] = useState(
    existingSettlement ? existingSettlement.minijobMinutes % 60 : defaultMinijob % 60
  );
  const [cashH, setCashH] = useState(
    existingSettlement ? Math.floor(existingSettlement.cashMinutes / 60) : Math.floor(defaultCash / 60)
  );
  const [cashM, setCashM] = useState(
    existingSettlement ? existingSettlement.cashMinutes % 60 : defaultCash % 60
  );
  const [cashRate, setCashRate] = useState(
    existingSettlement?.cashHourlyRate
      ? Number(existingSettlement.cashHourlyRate)
      : worker.hourlyRate
  );
  const [notes, setNotes] = useState(existingSettlement?.notes ?? '');

  const minijobMin   = minijobH * 60 + minijobM;
  const cashMin      = cashH * 60 + cashM;
  const allocatedMin = minijobMin + cashMin;
  const rolloverMin  = Math.max(0, net - allocatedMin);
  const overAllocated = allocatedMin > net;

  const minijobEur  = minutesToEur(minijobMin, worker.hourlyRate);
  const cashEur     = minutesToEur(cashMin, cashRate);
  const minijobOver = minijobMin > maxMinijob;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg rounded-3xl">
        <DialogTitle className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary" />
          Abrechnung — {worker.name}
        </DialogTitle>
        <DialogDescription>
          Stunden aufteilen: Minijob (Banküberweisung) · Bar · Übertrag
        </DialogDescription>

        {existingSettlement?.status === 'SETTLED' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-sm text-amber-700 font-semibold">
              Diese Abrechnung ist abgeschlossen. Nach dem Speichern wird sie auf <strong>Entwurf</strong> zurückgesetzt und muss erneut abgerechnet werden.
            </span>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-2xl p-4">
          <div className="text-center">
            <p className="text-xs text-muted-foreground font-semibold uppercase">Gearbeitet</p>
            <p className="text-xl font-black text-primary">{fmtMin(worker.totalMinutes)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground font-semibold uppercase">+ Übertrag</p>
            <p className="text-xl font-black text-amber-600">
              {worker.prevRolloverMinutes > 0 ? `+${fmtMin(worker.prevRolloverMinutes)}` : '—'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground font-semibold uppercase">Netto</p>
            <p className="text-xl font-black text-green-600">{fmtMin(net)}</p>
          </div>
        </div>

        <div className="space-y-5 pt-1">
          {/* Minijob */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-black flex items-center gap-2 text-blue-700">
                <Banknote className="w-4 h-4" /> Minijob (Banküberweisung)
              </Label>
              <span className="text-sm font-black text-blue-700">{fmtEur(minijobEur)}</span>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Stunden</Label>
                <Input type="number" min={0} value={minijobH}
                  onChange={e => setMinijobH(Math.max(0, Number(e.target.value)))}
                  className="rounded-xl" />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Minuten</Label>
                <Input type="number" min={0} max={59} value={minijobM}
                  onChange={e => setMinijobM(Math.max(0, Math.min(59, Number(e.target.value))))}
                  className="rounded-xl" />
              </div>
            </div>
            {minijobOver && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Über Minijob-Grenze ({fmtEur(MINIJOB_LIMIT_EUR)}). Max. {fmtMin(maxMinijob)}.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Minijob-Max: {fmtMin(maxMinijob)} = {fmtEur(MINIJOB_LIMIT_EUR)} ÷ {fmtEur(worker.hourlyRate)}/Std.
            </p>
          </div>

          <Separator />

          {/* Cash */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-black flex items-center gap-2 text-green-700">
                <Wallet className="w-4 h-4" /> Barzahlung
              </Label>
              <span className="text-sm font-black text-green-700">{fmtEur(cashEur)}</span>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Stunden</Label>
                <Input type="number" min={0} value={cashH}
                  onChange={e => setCashH(Math.max(0, Number(e.target.value)))}
                  className="rounded-xl" />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Minuten</Label>
                <Input type="number" min={0} max={59} value={cashM}
                  onChange={e => setCashM(Math.max(0, Math.min(59, Number(e.target.value))))}
                  className="rounded-xl" />
              </div>
            </div>
            <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
              <Label className="text-xs text-green-700 font-semibold whitespace-nowrap">Stundenlohn Bar (€)</Label>
              <Input
                type="number" min={0} step={0.01}
                value={cashRate}
                onChange={e => setCashRate(Math.max(0, Number(e.target.value)))}
                className="rounded-lg h-8 text-sm font-black text-green-700 border-green-200 bg-white w-24"
              />
              <span className="text-xs text-green-600 whitespace-nowrap">
                = {fmtEur(cashEur)} gesamt
              </span>
            </div>
          </div>

          <Separator />

          {/* Rollover (auto-calculated) */}
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              <div>
                <p className="font-black text-sm text-amber-700">→ Übertrag nächster Monat</p>
                <p className="text-xs text-amber-600">Netto − Minijob − Bar</p>
              </div>
            </div>
            <p className="text-xl font-black text-amber-600">{fmtMin(rolloverMin)}</p>
          </div>

          {overAllocated && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Zuweisung ({fmtMin(allocatedMin)}) überschreitet verfügbare Stunden ({fmtMin(net)}).
            </p>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Notiz (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="z.B. Oktober-Zahlung bar übergeben..."
              className="rounded-xl text-sm resize-none" rows={2} />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl flex-1">Abbrechen</Button>
          <Button
            className="rounded-xl flex-1 font-black"
            disabled={saving || overAllocated || minijobOver}
            onClick={() => onSave({ minijobMinutes: minijobMin, cashMinutes: cashMin, rolloverMinutes: rolloverMin, cashHourlyRate: cashRate, notes })}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Entwurf speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── History Edit Form ────────────────────────────────────────────────────────
// Lightweight editor used inside the Verlauf dialog to correct a past-period DRAFT

function HistoryEditForm({ settlement: s, saving, onSave, onCancel }: {
  settlement: Settlement;
  saving: boolean;
  onSave: (draft: DraftValues) => void;
  onCancel: () => void;
}) {
  const maxMinijob = calcMinijobMax(s.hourlyRate, s.minijobLimitEur);
  const net        = s.netMinutes;

  const [minijobH, setMinijobH] = useState(Math.floor(s.minijobMinutes / 60));
  const [minijobM, setMinijobM] = useState(s.minijobMinutes % 60);
  const [cashH,    setCashH]    = useState(Math.floor(s.cashMinutes / 60));
  const [cashM,    setCashM]    = useState(s.cashMinutes % 60);
  const [cashRate, setCashRate] = useState(Number(s.cashHourlyRate || s.hourlyRate));
  const [notes,    setNotes]    = useState(s.notes ?? '');

  const minijobMin   = minijobH * 60 + minijobM;
  const cashMin      = cashH * 60 + cashM;
  const allocatedMin = minijobMin + cashMin;
  const rolloverMin  = Math.max(0, net - allocatedMin);
  const overAlloc    = allocatedMin > net;
  const overMinijob  = minijobMin > maxMinijob;

  return (
    <div className="space-y-4">
      {/* Hours summary */}
      <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-2xl p-4 text-center">
        <div>
          <p className="text-xs text-muted-foreground font-semibold uppercase">Gearbeitet</p>
          <p className="text-lg font-black text-primary">{fmtMin(s.totalMinutes)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-semibold uppercase">+ Übertrag</p>
          <p className="text-lg font-black text-amber-600">
            {s.prevRolloverMinutes > 0 ? `+${fmtMin(s.prevRolloverMinutes)}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-semibold uppercase">Netto</p>
          <p className="text-lg font-black text-green-600">{fmtMin(net)}</p>
        </div>
      </div>

      {/* Minijob */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="font-black text-blue-700 flex items-center gap-2">
            <Banknote className="w-4 h-4" /> Minijob
          </Label>
          <span className="text-sm font-black text-blue-700">{fmtEur(minutesToEur(minijobMin, s.hourlyRate))}</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Stunden</Label>
            <Input type="number" min={0} value={minijobH}
              onChange={e => setMinijobH(Math.max(0, Number(e.target.value)))} className="rounded-xl" />
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Minuten</Label>
            <Input type="number" min={0} max={59} value={minijobM}
              onChange={e => setMinijobM(Math.max(0, Math.min(59, Number(e.target.value))))} className="rounded-xl" />
          </div>
        </div>
        {overMinijob && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Über Minijob-Grenze. Max. {fmtMin(maxMinijob)}.
          </p>
        )}
      </div>

      <Separator />

      {/* Cash */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="font-black text-green-700 flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Bar
          </Label>
          <span className="text-sm font-black text-green-700">{fmtEur(minutesToEur(cashMin, cashRate))}</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Stunden</Label>
            <Input type="number" min={0} value={cashH}
              onChange={e => setCashH(Math.max(0, Number(e.target.value)))} className="rounded-xl" />
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Minuten</Label>
            <Input type="number" min={0} max={59} value={cashM}
              onChange={e => setCashM(Math.max(0, Math.min(59, Number(e.target.value))))} className="rounded-xl" />
          </div>
        </div>
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
          <Label className="text-xs text-green-700 font-semibold whitespace-nowrap">Stundenlohn Bar (€)</Label>
          <Input
            type="number" min={0} step={0.01}
            value={cashRate}
            onChange={e => setCashRate(Math.max(0, Number(e.target.value)))}
            className="rounded-lg h-8 text-sm font-black text-green-700 border-green-200 bg-white w-24"
          />
          <span className="text-xs text-green-600 whitespace-nowrap">
            = {fmtEur(minutesToEur(cashMin, cashRate))} gesamt
          </span>
        </div>
      </div>

      {/* Auto rollover */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-amber-600" />
          <div>
            <p className="font-black text-sm text-amber-700">→ Übertrag nächster Monat</p>
            <p className="text-xs text-amber-600">Netto − Minijob − Bar (automatisch)</p>
          </div>
        </div>
        <p className="text-2xl font-black text-amber-600">{fmtMin(rolloverMin)}</p>
      </div>

      {overAlloc && (
        <p className="text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Zuweisung ({fmtMin(allocatedMin)}) überschreitet Netto ({fmtMin(net)}).
        </p>
      )}

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Notiz</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Korrekturgrund..." className="rounded-xl text-sm resize-none" rows={2} />
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onCancel} className="rounded-xl flex-1">Abbrechen</Button>
        <Button
          className="rounded-xl flex-1 font-black"
          disabled={saving || overAlloc || overMinijob}
          onClick={() => onSave({ minijobMinutes: minijobMin, cashMinutes: cashMin, rolloverMinutes: rolloverMin, cashHourlyRate: cashRate, notes })}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Korrektur speichern'}
        </Button>
      </div>
    </div>
  );
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToSettlement(row: any): Settlement {
  return {
    id:                   row.id,
    employeeId:           row.employee_id,
    periodStart:          row.period_start,
    periodEnd:            row.period_end,
    totalMinutes:         row.total_minutes,
    prevRolloverMinutes:  row.prev_rollover_minutes,
    netMinutes:           row.net_minutes,
    minijobMinutes:       row.minijob_minutes,
    cashMinutes:          row.cash_minutes,
    rolloverMinutes:      row.rollover_minutes,
    hourlyRate:           Number(row.hourly_rate),
    cashHourlyRate:       Number(row.cash_hourly_rate ?? row.hourly_rate),
    minijobLimitEur:      Number(row.minijob_limit_eur),
    minijobAmount:        Number(row.minijob_amount),
    cashAmount:           Number(row.cash_amount),
    status:               row.status,
    notes:                row.notes,
    settledAt:            row.settled_at,
    employeeName:         row.employee_name,
  };
}
