"use client";

/**
 * Winterdienst — today's status per site, the season log per site (the
 * Streuprotokoll), corrections, PDF export and per-site setup.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  CheckCircle2, Clock, Download, Image as ImageIcon, Loader2, MapPin, Pencil,
  Plus, ShieldAlert, ShieldCheck, Snowflake, ThermometerSnowflake, X,
} from 'lucide-react';
import { Shell } from '@/components/layout/Shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/db/provider';
import { useCompanyBranding } from '@/hooks/use-company';
import { useToast } from '@/hooks/use-toast';
import { UserRole } from '@/lib/types';
import { ACTIVITIES, MATERIALS, type Activity, type Material } from '@/lib/winter-labels';
import { recentSeasons, type Season } from '@/lib/winter-season';

interface WinterSite {
  id: string;
  name: string;
  address: string;
  city: string;
  winter_areas: string[];
  winter_notes: string | null;
  last_performed_at: string | null;
  last_activity: Activity | null;
  last_employee_name: string | null;
  entries_today: number;
}

interface LogEntry {
  id: string;
  chain_seq: string;
  performed_at: string;
  recorded_at: string;
  activity: Activity;
  grit_material: Material | null;
  grit_amount_kg: string | null;
  areas: string[];
  notes: string | null;
  employee_name: string;
  entered_by_name: string;
  lat: string | null;
  lng: string | null;
  gps_accuracy_m: string | null;
  photo_url: string | null;
  weather: { temperatureC?: number | null; condition?: string | null; station?: string | null } | null;
  corrects_log_id: string | null;
  correction_reason: string | null;
  voided: boolean;
  superseded_by: string | null;
  hash: string;
}

interface ChainCheck { valid: boolean; entries: number; brokenAt: number | null; checkedAt: string }
interface PlainSite { id: string; name: string; city: string; winter_service_enabled: boolean }

const WEATHER_DE: Record<string, string> = {
  dry: 'trocken', fog: 'Nebel', rain: 'Regen', sleet: 'Schneeregen', snow: 'Schnee', hail: 'Hagel', thunderstorm: 'Gewitter',
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

function weatherText(w: LogEntry['weather']) {
  if (!w) return '—';
  const parts = [
    w.temperatureC != null ? `${Number(w.temperatureC).toFixed(1)} °C` : null,
    w.condition ? WEATHER_DE[w.condition] ?? w.condition : null,
  ].filter(Boolean);
  return parts.join(', ') || '—';
}

function materialText(e: LogEntry) {
  if (!e.grit_material) return '—';
  const amount = e.grit_amount_kg != null ? ` (${Number(e.grit_amount_kg).toLocaleString('de-DE')} kg)` : '';
  return `${MATERIALS[e.grit_material]}${amount}`;
}

async function api<T>(url: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export default function WinterPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const { companyName } = useCompanyBranding();
  const role = (userProfile?.role ?? 'WORKER') as UserRole;
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER';

  const seasons = useMemo(() => recentSeasons(4), []);
  const [season, setSeason] = useState<Season>(seasons[0]);
  const [sites, setSites] = useState<WinterSite[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [chain, setChain] = useState<ChainCheck | null>(null);
  const [correcting, setCorrecting] = useState<LogEntry | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const loadSites = useCallback(async () => {
    try {
      const { data } = await api<{ data: WinterSite[] }>('/api/winter/sites');
      setSites(data);
      setSelectedId(prev => prev ?? data[0]?.id ?? null);
    } catch (e: any) {
      toast({ title: 'Fehler beim Laden', description: e.message, variant: 'destructive' });
      setSites([]);
    }
  }, [toast]);

  const loadEntries = useCallback(async () => {
    if (!selectedId) { setEntries([]); return; }
    setEntries(null);
    const params = new window.URLSearchParams({ siteId: selectedId, from: season.from.toISOString(), to: season.to.toISOString() });
    try {
      const { data } = await api<{ data: LogEntry[] }>(`/api/winter/logs?${params}`);
      setEntries(data);
    } catch (e: any) {
      toast({ title: 'Protokoll konnte nicht geladen werden', description: e.message, variant: 'destructive' });
      setEntries([]);
    }
  }, [selectedId, season, toast]);

  const loadChain = useCallback(async () => {
    if (!canManage) return;
    try { setChain(await api<ChainCheck>('/api/winter/verify')); } catch { setChain(null); }
  }, [canManage]);

  useEffect(() => { loadSites(); }, [loadSites]);
  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => { loadChain(); }, [loadChain]);

  const selected = sites?.find(s => s.id === selectedId) ?? null;
  const doneToday = sites?.filter(s => s.entries_today > 0).length ?? 0;
  const lastHash = entries?.[0]?.hash;

  const exportPdf = () => {
    if (!selected || !entries) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const M = 12;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(`Streuprotokoll Winterdienst ${season.label}`, M, 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`${selected.name} — ${[selected.address, selected.city].filter(Boolean).join(', ')}`, M, 22);
    doc.text(`Dienstleister: ${companyName || '—'}   ·   Flächen: ${selected.winter_areas.join(', ') || '—'}`, M, 27);

    const rows = [...entries].reverse().map(e => [
      fmtDateTime(e.performed_at),
      ACTIVITIES[e.activity],
      materialText(e),
      e.areas.join(', ') || '—',
      e.employee_name,
      weatherText(e.weather),
      e.lat && e.lng ? `${Number(e.lat).toFixed(5)}, ${Number(e.lng).toFixed(5)}` : '—',
      e.photo_url ? 'ja' : '—',
      [
        e.corrects_log_id
          ? `${e.voided ? 'Storno' : 'Korrektur'} von #${entries.find(x => x.id === e.corrects_log_id)?.chain_seq ?? '?'}: ${e.correction_reason} (${e.entered_by_name})`
          : e.superseded_by ? 'ersetzt' : '',
        e.notes ?? '',
      ].filter(Boolean).join(' · '),
      `#${e.chain_seq}`,
    ]);
    autoTable(doc, {
      startY: 32,
      head: [['Zeitpunkt', 'Tätigkeit', 'Streumittel', 'Flächen', 'Mitarbeiter', 'Wetter (DWD)', 'GPS', 'Foto', 'Hinweis', 'Nr.']],
      body: rows,
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.4, overflow: 'linebreak', lineColor: [220, 224, 230], lineWidth: 0.15 },
      headStyles: { fillColor: [15, 40, 80], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 28 }, 7: { halign: 'center', cellWidth: 10 }, 9: { halign: 'right', cellWidth: 12 } },
      didDrawPage: () => {
        const h = doc.internal.pageSize.getHeight();
        doc.setFontSize(7); doc.setTextColor(110);
        doc.text(
          `Erstellt ${fmtDateTime(new Date().toISOString())} · ${entries.length} Einträge · `
            + (chain ? (chain.valid ? `Protokollkette geprüft und unverändert (${chain.entries} Einträge)` : `WARNUNG: Protokollkette ab Eintrag #${chain.brokenAt} verändert`) : 'Protokollkette nicht geprüft')
            + (lastHash ? ` · Prüfsumme letzter Eintrag: ${lastHash.slice(0, 16)}…` : ''),
          M, h - 6,
        );
        doc.setTextColor(0);
      },
    });
    const safe = selected.name.replace(/[^\w-]+/g, '_').slice(0, 40);
    doc.save(`Streuprotokoll_${safe}_${season.label.replace('/', '-')}.pdf`);
  };

  return (
    <Shell userRole={role} userName={userProfile?.name ?? ''}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase flex items-center gap-3">
              <Snowflake className="w-8 h-8" /> Winterdienst
            </h1>
            <p className="text-muted-foreground font-medium">Räum- und Streuprotokoll mit Zeit, GPS, Foto und Wetter</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {chain && (
              <Badge variant="outline" className={`h-9 px-3 rounded-xl gap-1.5 font-bold ${chain.valid ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-red-300 text-red-700 bg-red-50'}`}>
                {chain.valid ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                {chain.valid ? `Protokoll unverändert (${chain.entries})` : `Verändert ab #${chain.brokenAt}`}
              </Badge>
            )}
            <Select value={String(season.startYear)} onValueChange={v => setSeason(seasons.find(s => String(s.startYear) === v)!)}>
              <SelectTrigger className="w-40 h-10 rounded-xl font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>
                {seasons.map(s => <SelectItem key={s.startYear} value={String(s.startYear)}>Saison {s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {canManage && (
              <Button variant="outline" className="h-10 rounded-xl font-black gap-2" onClick={() => setSetupOpen(true)}>
                <Plus className="w-4 h-4" /> Objekte einrichten
              </Button>
            )}
          </div>
        </div>

        {/* Today */}
        <Card className="rounded-3xl border-none shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-sm uppercase tracking-widest text-primary">Heute</h2>
              {sites && <span className="text-sm font-bold text-muted-foreground">{doneToday} von {sites.length} Objekten erledigt</span>}
            </div>
            {!sites ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : sites.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Noch keine Objekte mit Winterdienst.{canManage ? ' Über „Objekte einrichten“ hinzufügen.' : ''}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {sites.map(site => {
                  const done = site.entries_today > 0;
                  return (
                    <button
                      key={site.id}
                      onClick={() => setSelectedId(site.id)}
                      className={`text-left rounded-2xl border p-4 transition-all ${selectedId === site.id ? 'ring-2 ring-primary' : ''} ${done ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-black text-sm leading-tight">{site.name}</p>
                        {done ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Clock className="w-4 h-4 text-amber-600 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">{[site.address, site.city].filter(Boolean).join(', ')}</p>
                      <p className={`text-xs font-bold mt-2 ${done ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {done
                          ? `${ACTIVITIES[site.last_activity!]} · ${fmtTime(site.last_performed_at!)} · ${site.last_employee_name}`
                          : 'Noch kein Eintrag'}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Season log */}
        {selected && (
          <Card className="rounded-3xl border-none shadow-lg overflow-hidden">
            <CardContent className="p-0">
              <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b">
                <div className="min-w-0">
                  <h2 className="text-xl font-black text-primary">{selected.name}</h2>
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> {[selected.address, selected.city].filter(Boolean).join(', ')}
                  </p>
                  {selected.winter_areas.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {selected.winter_areas.map(a => <Badge key={a} variant="secondary" className="rounded-lg text-[10px]">{a}</Badge>)}
                    </div>
                  )}
                </div>
                <Button className="h-11 rounded-xl font-black gap-2" onClick={exportPdf} disabled={!entries?.length}>
                  <Download className="w-4 h-4" /> Streuprotokoll PDF
                </Button>
              </div>

              {!entries ? (
                <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">Keine Einträge in der Saison {season.label}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[10px] uppercase tracking-widest text-muted-foreground">
                      <tr>
                        {['Zeitpunkt', 'Tätigkeit', 'Streumittel', 'Flächen', 'Mitarbeiter', 'Wetter', 'Nachweis', ''].map(h => (
                          <th key={h} className="text-left font-black px-4 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {entries.map(e => {
                        const inactive = !!e.superseded_by;
                        return (
                          <tr key={e.id} className={inactive ? 'opacity-50' : ''}>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <p className={`font-bold ${inactive ? 'line-through' : ''}`}>{fmtDateTime(e.performed_at)}</p>
                              <p className="text-[10px] text-muted-foreground">#{e.chain_seq}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-bold">{ACTIVITIES[e.activity]}</p>
                              {e.corrects_log_id && (
                                <Badge variant="outline" className={`mt-1 text-[10px] rounded-lg ${e.voided ? 'border-red-300 text-red-700' : 'border-blue-300 text-blue-700'}`}>
                                  {e.voided ? 'Storno' : 'Korrektur'}: {e.correction_reason} ({e.entered_by_name})
                                </Badge>
                              )}
                              {inactive && <p className="text-[10px] text-muted-foreground mt-1">durch Korrektur ersetzt</p>}
                              {e.notes && <p className="text-xs text-muted-foreground mt-1 italic">„{e.notes}“</p>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">{materialText(e)}</td>
                            <td className="px-4 py-3">{e.areas.join(', ') || '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{e.employee_name}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1"><ThermometerSnowflake className="w-3.5 h-3.5 text-blue-500" />{weatherText(e.weather)}</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {e.lat && e.lng && (
                                  <a className="text-primary hover:underline inline-flex items-center gap-1" target="_blank" rel="noreferrer"
                                    href={`https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=18/${e.lat}/${e.lng}`}>
                                    <MapPin className="w-3.5 h-3.5" />GPS
                                  </a>
                                )}
                                {e.photo_url && (
                                  <a className="text-primary hover:underline inline-flex items-center gap-1" target="_blank" rel="noreferrer" href={e.photo_url}>
                                    <ImageIcon className="w-3.5 h-3.5" />Foto
                                  </a>
                                )}
                                {!e.lat && !e.photo_url && '—'}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {canManage && !inactive && !e.voided && (
                                <Button variant="ghost" size="sm" className="h-8 rounded-lg gap-1 text-xs font-bold" onClick={() => setCorrecting(e)}>
                                  <Pencil className="w-3.5 h-3.5" /> Korrigieren
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {correcting && (
        <CorrectionDialog
          entry={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => { setCorrecting(null); loadEntries(); loadSites(); loadChain(); }}
        />
      )}
      {setupOpen && (
        <SetupDialog
          winterSites={sites ?? []}
          onClose={() => setSetupOpen(false)}
          onSaved={() => { loadSites(); }}
        />
      )}
    </Shell>
  );
}

// ─── Correction ───────────────────────────────────────────────────────────────

function CorrectionDialog({ entry, onClose, onSaved }: { entry: LogEntry; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    reason: '',
    voided: false,
    activity: entry.activity,
    gritMaterial: entry.grit_material ?? '',
    gritAmountKg: entry.grit_amount_kg ?? '',
    notes: entry.notes ?? '',
  });
  const needsMaterial = form.activity === 'gritting' || form.activity === 'clearing_gritting';

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/winter/logs/${entry.id}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.voided
          ? { reason: form.reason, voided: true }
          : {
              reason: form.reason,
              activity: form.activity,
              gritMaterial: needsMaterial ? form.gritMaterial || null : null,
              gritAmountKg: needsMaterial && form.gritAmountKg !== '' ? Number(form.gritAmountKg) : null,
              notes: form.notes,
            }),
      });
      toast({ title: form.voided ? 'Eintrag storniert' : 'Korrektur gespeichert', description: 'Der ursprüngliche Eintrag bleibt im Protokoll erhalten.' });
      onSaved();
    } catch (e: any) {
      toast({ title: 'Speichern fehlgeschlagen', description: e.message, variant: 'destructive' });
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Eintrag #{entry.chain_seq} korrigieren</DialogTitle>
          <DialogDescription>
            Einträge werden nie geändert oder gelöscht. Die Korrektur wird als neuer Eintrag mit Begründung angehängt.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-bold">
            <Checkbox checked={form.voided} onCheckedChange={v => setForm(f => ({ ...f, voided: v === true }))} />
            Eintrag stornieren (z. B. falsches Objekt)
          </label>
          {!form.voided && (
            <>
              <div className="space-y-1.5">
                <Label>Tätigkeit</Label>
                <Select value={form.activity} onValueChange={v => setForm(f => ({ ...f, activity: v as Activity }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ACTIVITIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {needsMaterial && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Streumittel</Label>
                    <Select value={form.gritMaterial} onValueChange={v => setForm(f => ({ ...f, gritMaterial: v as Material }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="wählen" /></SelectTrigger>
                      <SelectContent>{Object.entries(MATERIALS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Menge (kg)</Label>
                    <Input type="number" min={0} step={0.5} className="rounded-xl" value={form.gritAmountKg}
                      onChange={e => setForm(f => ({ ...f, gritAmountKg: e.target.value }))} />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Notiz</Label>
                <Textarea className="rounded-xl" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Begründung *</Label>
            <Input className="rounded-xl" placeholder="z. B. Menge falsch eingetragen" value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={onClose}>Abbrechen</Button>
          <Button className="rounded-xl font-black" onClick={save} disabled={saving || form.reason.trim().length < 5}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Korrektur speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Site setup ───────────────────────────────────────────────────────────────

function SetupDialog({ winterSites, onClose, onSaved }: { winterSites: WinterSite[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [allSites, setAllSites] = useState<PlainSite[] | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; areas: string; notes: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api<{ data: PlainSite[] }>('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'query', table: 'job_sites', select: 'id,name,city,winter_service_enabled', orderBy: { column: 'name' } }),
    });
    setAllSites(data);
  }, []);
  useEffect(() => { load().catch(() => setAllSites([])); }, [load]);

  const update = async (id: string, data: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', table: 'job_sites', filters: { id }, data }),
      });
      await load();
      onSaved();
      return true;
    } catch (e: any) {
      toast({ title: 'Speichern fehlgeschlagen', description: e.message, variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (site: PlainSite) => {
    const existing = winterSites.find(w => w.id === site.id);
    setEditing({
      id: site.id,
      name: site.name,
      areas: (existing?.winter_areas ?? ['Gehweg', 'Hauseingang']).join(', '),
      notes: existing?.winter_notes ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const areas = editing.areas.split(',').map(a => a.trim()).filter(Boolean).slice(0, 20);
    if (await update(editing.id, { winter_service_enabled: true, winter_areas: areas, winter_notes: editing.notes || null })) {
      setEditing(null);
    }
  };

  const visible = (allSites ?? []).filter(s => `${s.name} ${s.city}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="rounded-3xl sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Objekte mit Winterdienst</DialogTitle>
          <DialogDescription>Winterdienst je Objekt aktivieren und die zu räumenden Flächen festlegen.</DialogDescription>
        </DialogHeader>
        {editing ? (
          <div className="space-y-4">
            <p className="font-black">{editing.name}</p>
            <div className="space-y-1.5">
              <Label>Flächen (mit Komma getrennt)</Label>
              <Input className="rounded-xl" value={editing.areas} onChange={e => setEditing({ ...editing, areas: e.target.value })}
                placeholder="Gehweg, Hauseingang, Parkplatz" />
            </div>
            <div className="space-y-1.5">
              <Label>Hinweise für Mitarbeiter</Label>
              <Textarea className="rounded-xl" value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })}
                placeholder="z. B. Räumpflicht werktags ab 7 Uhr, sonn- und feiertags ab 9 Uhr" />
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-xl" onClick={() => setEditing(null)}>Zurück</Button>
              <Button className="rounded-xl font-black" onClick={saveEdit} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Speichern'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <Input className="rounded-xl" placeholder="Objekt suchen…" value={filter} onChange={e => setFilter(e.target.value)} />
            <div className="overflow-y-auto -mx-2 px-2 divide-y">
              {!allSites ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : visible.map(site => (
                <div key={site.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{site.name}</p>
                    <p className="text-xs text-muted-foreground">{site.city}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {site.winter_service_enabled ? (
                      <>
                        <Button size="sm" variant="outline" className="rounded-lg h-8 text-xs font-bold" onClick={() => startEdit(site)}>Flächen</Button>
                        <Button size="sm" variant="ghost" className="rounded-lg h-8 text-xs font-bold text-red-600" disabled={saving}
                          onClick={() => update(site.id, { winter_service_enabled: false })}>
                          <X className="w-3.5 h-3.5" /> Deaktivieren
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" className="rounded-lg h-8 text-xs font-bold gap-1" onClick={() => startEdit(site)}>
                        <Snowflake className="w-3.5 h-3.5" /> Aktivieren
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
