"use client";

import React, { useMemo, useState, useCallback } from 'react';
import { Shell } from '@/components/layout/Shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MapPin, Search, Loader2, Clock, CalendarDays, ChevronDown, ChevronRight,
  History, FileText, Image as ImageIcon, Mic, CheckCircle2, Users, Timer, Building2,
  Printer, FileDown,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '@/db/provider';
import { useQuery } from '@/db/use-query';
import { db } from '@/db';
import { UserRole } from '@/lib/types';

// ─── Labels ────────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  AR_Oeffen: 'Außengehwege', AR_Hof: 'Hofbereich', Gullis: 'Gullis',
  Ablaufrinnen: 'Ablaufrinnen', AR_Laub: 'Laub (AR)', Rasen_Fl1: 'Rasen Fl. 1',
  Rasen_Fl2: 'Rasen Fl. 2', Gittersteine: 'Gittersteine', Gartenpflege: 'Gartenpflege',
  Baeume_Pruefen: 'Bäume prüfen', VEG_Laub: 'Laub (VEG)',
};

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  OPEN:      { label: 'Offen',       className: 'bg-amber-100 text-amber-800' },
  PENDING:   { label: 'Ausstehend',  className: 'bg-amber-100 text-amber-800' },
  SUBMITTED: { label: 'Eingereicht', className: 'bg-violet-100 text-violet-800' },
  APPROVED:  { label: 'Genehmigt',   className: 'bg-green-100 text-green-800' },
  REJECTED:  { label: 'Storniert',   className: 'bg-red-100 text-red-700' },
};

// ─── Row types (snake_case from /api/data) ──────────────────────────────────────

interface SiteRow {
  id: string; name: string; address?: string; city?: string;
  postal_code?: string; region?: string; route_code?: string; is_remote?: boolean;
}
interface UserRow { id: string; name: string; role?: string; avatar_url?: string | null; }
interface AssignmentRow {
  id: string; job_site_id: string | null; title?: string;
  categories?: string[] | null; scheduled_date?: string; status?: string;
}
interface EntryRow {
  id: string; employee_id: string; job_assignment_id: string | null; job_site_id: string | null;
  clock_in_datetime?: string | null; clock_out_datetime?: string | null;
  actual_work_minutes?: number | null; travel_bonus_minutes?: number | null; status: string;
}
interface WorkLogRow {
  id: string; type: string; content: string; author_name?: string;
  duration?: number | null; created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function entryMinutes(e: EntryRow): number {
  if (typeof e.actual_work_minutes === 'number' && Number.isFinite(e.actual_work_minutes)) {
    return Math.max(0, Math.round(e.actual_work_minutes));
  }
  if (e.clock_in_datetime && e.clock_out_datetime) {
    const a = new Date(e.clock_in_datetime).getTime();
    const b = new Date(e.clock_out_datetime).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return Math.round((b - a) / 60000);
  }
  return 0;
}
function fmtDur(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function fmtDayFull(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const ALLOWED_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEADER'];

// ─── Page ────────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { userProfile } = useAuth();
  const companyId = userProfile?.companyId ?? '';
  const hasContext = !!companyId;
  const role = (userProfile?.role ?? 'WORKER') as UserRole;
  const canView = ALLOWED_ROLES.includes(role);

  const [search, setSearch] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [logsByEntry, setLogsByEntry] = useState<Record<string, WorkLogRow[] | 'loading'>>({});

  const enabled = hasContext && canView;

  const { data: sitesRaw, isLoading: sitesLoading } = useQuery<SiteRow>({
    table: 'job_sites', filters: enabled ? { company_id: companyId } : undefined, enabled,
  });
  const { data: usersRaw } = useQuery<UserRow>({
    table: 'users', filters: enabled ? { company_id: companyId } : undefined, enabled,
  });
  const { data: assignmentsRaw } = useQuery<AssignmentRow>({
    table: 'job_assignments', filters: enabled ? { company_id: companyId } : undefined,
    select: 'id,job_site_id,title,categories,scheduled_date,status', enabled,
  });
  const { data: entriesRaw, isLoading: entriesLoading } = useQuery<EntryRow>({
    table: 'time_entries', filters: enabled ? { company_id: companyId } : undefined,
    select: 'id,employee_id,job_assignment_id,job_site_id,clock_in_datetime,clock_out_datetime,actual_work_minutes,travel_bonus_minutes,status',
    enabled,
  });

  const sites = useMemo(() => sitesRaw ?? [], [sitesRaw]);
  const usersMap = useMemo(
    () => Object.fromEntries((usersRaw ?? []).map(u => [u.id, u])),
    [usersRaw],
  );
  const assignmentsMap = useMemo(
    () => Object.fromEntries((assignmentsRaw ?? []).map(a => [a.id, a])),
    [assignmentsRaw],
  );

  const filteredSites = useMemo(() => {
    const list = [...sites].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(s =>
      [s.name, s.address, s.city, s.postal_code, s.region, s.route_code]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q)),
    );
  }, [sites, search]);

  const selectedSite = useMemo(
    () => sites.find(s => s.id === selectedSiteId) ?? null,
    [sites, selectedSiteId],
  );

  const siteIdOfEntry = useCallback((e: EntryRow): string | null => (
    e.job_site_id ?? (e.job_assignment_id ? assignmentsMap[e.job_assignment_id]?.job_site_id ?? null : null)
  ), [assignmentsMap]);

  // All visits for the selected site, oldest → newest.
  const siteEntriesAll = useMemo(() => {
    if (!selectedSiteId) return [];
    return (entriesRaw ?? [])
      .filter(e => !!e.clock_in_datetime && siteIdOfEntry(e) === selectedSiteId)
      .sort((a, b) => (a.clock_in_datetime ?? '').localeCompare(b.clock_in_datetime ?? ''));
  }, [entriesRaw, selectedSiteId, siteIdOfEntry]);

  // Distinct employees who have visited this site (for the filter dropdown).
  const siteEmployees = useMemo(() => {
    const ids = Array.from(new Set(siteEntriesAll.map(e => e.employee_id)));
    return ids
      .map(id => ({ id, name: usersMap[id]?.name ?? 'Unbekannt' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [siteEntriesAll, usersMap]);

  const siteEntries = useMemo(() => (
    selectedEmployee === 'all'
      ? siteEntriesAll
      : siteEntriesAll.filter(e => e.employee_id === selectedEmployee)
  ), [siteEntriesAll, selectedEmployee]);

  // Group entries by calendar month (oldest → newest)
  const monthGroups = useMemo(() => {
    const map = new Map<string, EntryRow[]>();
    for (const e of siteEntries) {
      const d = new Date(e.clock_in_datetime!);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [siteEntries]);

  const stats = useMemo(() => {
    const totalMinutes = siteEntries.reduce((s, e) => s + entryMinutes(e), 0);
    const workers = new Set(siteEntries.map(e => e.employee_id));
    const monthsActive = new Set(siteEntries.map(e => {
      const d = new Date(e.clock_in_datetime!); return `${d.getFullYear()}-${d.getMonth()}`;
    }));
    return { visits: siteEntries.length, totalMinutes, workers: workers.size, months: monthsActive.size };
  }, [siteEntries]);

  const handlePrint = useCallback(() => { window.print(); }, []);

  const exportPdf = useCallback(() => {
    if (!selectedSite) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const MARGIN = 14;
    let y = 16;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Objekt-Verlauf', MARGIN, y); y += 7;
    doc.setFontSize(12);
    doc.text(selectedSite.name, MARGIN, y); y += 5;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const addr = [
      selectedSite.address,
      [selectedSite.postal_code, selectedSite.city].filter(Boolean).join(' '),
      selectedSite.region, selectedSite.route_code,
    ].filter(Boolean).join('  ·  ');
    if (addr) { doc.text(addr, MARGIN, y); y += 5; }

    const empLabel = selectedEmployee === 'all' ? 'Alle Mitarbeiter' : (usersMap[selectedEmployee]?.name ?? '—');
    doc.text(`Mitarbeiter: ${empLabel}   ·   Besuche: ${siteEntries.length}   ·   Arbeitszeit: ${fmtDur(stats.totalMinutes)}`, MARGIN, y); y += 4.5;
    doc.setTextColor(120); doc.text(`Erstellt: ${new Date().toLocaleString('de-DE')}`, MARGIN, y); y += 4;
    doc.setTextColor(0);

    const body = siteEntries.map(e => {
      const assignment = e.job_assignment_id ? assignmentsMap[e.job_assignment_id] : null;
      const cats = (assignment?.categories ?? []).map(c => SERVICE_LABELS[c] ?? c).join(', ');
      return [
        new Date(e.clock_in_datetime!).toLocaleDateString('de-DE'),
        `${fmtTime(e.clock_in_datetime)}–${fmtTime(e.clock_out_datetime)}`,
        usersMap[e.employee_id]?.name ?? 'Unbekannt',
        fmtDur(entryMinutes(e)),
        cats || '—',
        STATUS_LABELS[e.status]?.label ?? e.status,
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [['Datum', 'Zeit', 'Mitarbeiter', 'Dauer', 'Leistungen', 'Status']],
      body,
      margin: { left: MARGIN, right: MARGIN },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', lineColor: [220, 224, 230], lineWidth: 0.15 },
      headStyles: { fillColor: [15, 40, 80], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: { 3: { halign: 'center' }, 5: { halign: 'center' } },
    });

    const safeName = selectedSite.name.replace(/[^\w\-]+/g, '_').slice(0, 40);
    doc.save(`Objekt-Verlauf_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [selectedSite, selectedEmployee, siteEntries, stats.totalMinutes, usersMap, assignmentsMap]);

  const toggleEntry = useCallback(async (entryId: string) => {
    if (expandedEntry === entryId) { setExpandedEntry(null); return; }
    setExpandedEntry(entryId);
    if (!logsByEntry[entryId]) {
      setLogsByEntry(prev => ({ ...prev, [entryId]: 'loading' }));
      try {
        const rows = await db.from('work_log_entries').select(
          { time_entry_id: entryId },
          { orderBy: { column: 'created_at', ascending: true } },
        );
        setLogsByEntry(prev => ({ ...prev, [entryId]: (rows ?? []) as WorkLogRow[] }));
      } catch {
        setLogsByEntry(prev => ({ ...prev, [entryId]: [] }));
      }
    }
  }, [expandedEntry, logsByEntry]);

  // ── Guards ──
  if (!userProfile) {
    return <Shell userRole={role} userName="—"><Centered><Loader2 className="w-8 h-8 animate-spin text-primary" /></Centered></Shell>;
  }
  if (!canView) {
    return (
      <Shell userRole={role} userName={userProfile.name}>
        <Centered>
          <History className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="font-bold text-muted-foreground">Keine Berechtigung für den Objekt-Verlauf.</p>
        </Centered>
      </Shell>
    );
  }

  return (
    <Shell userRole={role} userName={userProfile.name}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <History className="w-6 h-6" /> Objekt-Verlauf
          </h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Wählen Sie ein Objekt, um alle Besuche zu sehen: Monat, Adresse, Datum &amp; Uhrzeit,
            Mitarbeiter und erledigte Arbeiten.
          </p>
        </div>

        {/* Site picker */}
        <Card className="border-none shadow-lg rounded-3xl print:hidden">
          <CardContent className="p-5">
            <div className="relative">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10 h-11 rounded-xl"
                placeholder="Objekt suchen (Name, Straße, Stadt, PLZ, Route)…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {sitesLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
              <div className="mt-3 max-h-72 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredSites.length === 0 && (
                  <p className="col-span-full text-center text-sm text-muted-foreground py-6">Keine Objekte gefunden.</p>
                )}
                {filteredSites.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedSiteId(s.id); setExpandedEntry(null); setSelectedEmployee('all'); }}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      selectedSiteId === s.id
                        ? 'border-primary bg-primary/5 shadow-inner'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-bold text-sm truncate">{s.name}</span>
                      {s.route_code && (
                        <Badge variant="secondary" className="ml-auto text-[9px] font-black shrink-0">{s.route_code}</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 truncate">
                      {[s.address, [s.postal_code, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Selected site history */}
        {selectedSite && (
          <>
            {/* Site info + stats */}
            <Card className="border-none shadow-lg rounded-3xl overflow-hidden">
              <div className="bg-primary text-white p-5">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-black truncate">{selectedSite.name}</h2>
                    <p className="text-sm text-white/80 truncate">
                      {selectedSite.address || '—'}
                    </p>
                    <p className="text-xs text-white/60">
                      {[selectedSite.postal_code, selectedSite.city].filter(Boolean).join(' ')}
                      {selectedSite.region ? `  ·  ${selectedSite.region}` : ''}
                      {selectedSite.route_code ? `  ·  ${selectedSite.route_code}` : ''}
                    </p>
                  </div>
                </div>
              </div>
              <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat icon={<CalendarDays className="w-4 h-4" />} value={stats.visits} label="Besuche" />
                <Stat icon={<Timer className="w-4 h-4" />} value={fmtDur(stats.totalMinutes)} label="Arbeitszeit" />
                <Stat icon={<Users className="w-4 h-4" />} value={stats.workers} label="Mitarbeiter" />
                <Stat icon={<History className="w-4 h-4" />} value={stats.months} label="Aktive Monate" />
              </CardContent>
            </Card>

            {/* Controls: employee filter + export/print */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 print:hidden">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <Select
                  value={selectedEmployee}
                  onValueChange={(v) => { setSelectedEmployee(v); setExpandedEntry(null); }}
                >
                  <SelectTrigger className="w-60 h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Mitarbeiter</SelectItem>
                    {siteEmployees.map(emp => (
                      <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:ml-auto flex gap-2">
                <Button variant="outline" className="rounded-xl h-10" onClick={handlePrint}>
                  <Printer className="w-4 h-4 mr-2" /> Drucken
                </Button>
                <Button className="rounded-xl h-10" onClick={exportPdf} disabled={siteEntries.length === 0}>
                  <FileDown className="w-4 h-4 mr-2" /> PDF export
                </Button>
              </div>
            </div>

            {/* Timeline */}
            {entriesLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            ) : siteEntries.length === 0 ? (
              <Card className="border-none shadow-lg rounded-3xl">
                <CardContent className="py-12 flex flex-col items-center gap-3">
                  <CheckCircle2 className="w-12 h-12 text-muted-foreground/40" />
                  <p className="text-muted-foreground font-medium">Für dieses Objekt wurden noch keine Einsätze erfasst.</p>
                </CardContent>
              </Card>
            ) : (
              monthGroups.map(([key, entries]) => {
                const [y, m] = key.split('-').map(Number);
                const monthMinutes = entries.reduce((s, e) => s + entryMinutes(e), 0);
                return (
                  <div key={key} className="space-y-2">
                    <div className="flex items-center gap-2 px-1 pt-2">
                      <CalendarDays className="w-4 h-4 text-primary" />
                      <h3 className="font-black text-primary uppercase tracking-wide text-sm">
                        {MONTH_NAMES[m]} {y}
                      </h3>
                      <span className="text-xs text-muted-foreground font-bold">
                        · {entries.length} Besuch{entries.length !== 1 ? 'e' : ''} · {fmtDur(monthMinutes)}
                      </span>
                    </div>

                    {entries.map(e => {
                      const worker = usersMap[e.employee_id];
                      const assignment = e.job_assignment_id ? assignmentsMap[e.job_assignment_id] : null;
                      const cats = assignment?.categories ?? [];
                      const st = STATUS_LABELS[e.status] ?? { label: e.status, className: 'bg-muted text-muted-foreground' };
                      const isOpen = expandedEntry === e.id;
                      const logs = logsByEntry[e.id];
                      return (
                        <Card key={e.id} className="border-none shadow-sm rounded-2xl overflow-hidden">
                          <button onClick={() => toggleEntry(e.id)} className="w-full text-left">
                            <div className="p-4 flex items-start gap-3">
                              <Avatar className="w-9 h-9 shrink-0">
                                <AvatarFallback className="text-xs font-black bg-primary/10 text-primary">
                                  {(worker?.name ?? '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm">{fmtDayFull(e.clock_in_datetime!)}</span>
                                  <Badge className={`text-[9px] font-black border-none ${st.className}`}>{st.label}</Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {fmtTime(e.clock_in_datetime)}–{fmtTime(e.clock_out_datetime)}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Timer className="w-3 h-3" /> {fmtDur(entryMinutes(e))}
                                  </span>
                                  <span className="font-semibold text-foreground/70">{worker?.name ?? 'Unbekannt'}</span>
                                </div>
                                {cats.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {cats.map(c => (
                                      <span key={c} className="text-[10px] font-bold bg-primary/10 text-primary rounded px-1.5 py-0.5">
                                        {SERVICE_LABELS[c] ?? c}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                                      : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
                            </div>
                          </button>

                          {isOpen && (
                            <div className="px-4 pb-4 border-t bg-muted/20">
                              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-3 mb-2">
                                Erledigte Arbeiten &amp; Notizen
                              </p>
                              {logs === 'loading' || logs === undefined ? (
                                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                              ) : logs.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-2">Keine Notizen oder Medien für diesen Besuch.</p>
                              ) : (
                                <div className="space-y-2">
                                  {logs.map(l => <WorkLogItem key={l.id} log={l} />)}
                                </div>
                              )}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">{children}</div>;
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="bg-muted/40 rounded-2xl p-3 flex flex-col items-center gap-1">
      <div className="text-primary">{icon}</div>
      <span className="text-lg font-black text-primary">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-center">{label}</span>
    </div>
  );
}

function WorkLogItem({ log }: { log: WorkLogRow }) {
  const time = new Date(log.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="bg-white rounded-xl p-3 border">
      <div className="flex items-center gap-2 mb-1.5">
        {log.type === 'photo' ? <ImageIcon className="w-3.5 h-3.5 text-emerald-600" />
          : log.type === 'voice' ? <Mic className="w-3.5 h-3.5 text-indigo-600" />
          : <FileText className="w-3.5 h-3.5 text-slate-500" />}
        <span className="text-[11px] font-bold text-foreground/80">{log.author_name ?? '—'}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{time}</span>
      </div>
      {log.type === 'photo' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={log.content} alt="Dokumentation" className="w-full max-h-64 object-cover rounded-lg" />
      )}
      {log.type === 'text' && <p className="text-sm text-foreground/90 whitespace-pre-wrap">{log.content}</p>}
      {log.type === 'voice' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mic className="w-4 h-4" /> Sprachnotiz{log.duration ? ` · ${log.duration}s` : ''}
        </div>
      )}
    </div>
  );
}
