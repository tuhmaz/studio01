"use client";

/**
 * Kundenportal für Hausverwaltungen.
 *
 * Zeigt die eigenen Objekte mit Leistungsnachweis (inkl. PDF), Winterdienst-
 * Protokoll (mit Wetter und Fälschungsschutz) und Mängelmeldungen. Interne
 * Daten des Dienstleisters (Löhne, Zeiten, Teams) gibt die API gar nicht heraus.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, Calendar, Camera, CheckCircle2, ClipboardCheck, CloudSnow, Download, Image as ImageIcon,
  KeyRound, Loader2, LogOut, Mail, MapPin, Phone, Send, ShieldCheck, ShieldAlert, Snowflake, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { LeistungsnachweisView } from '@/components/reports/LeistungsnachweisView';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';
import { compressImage } from '@/lib/image-compress';
import { periodOptions, type LeistungsnachweisReport } from '@/lib/leistungsnachweis-types';
import { buildLeistungsnachweisPdf, type LeistungsnachweisPdf } from '@/lib/leistungsnachweis-pdf';
import { PdfPreviewDialog } from '@/components/reports/PdfPreviewDialog';

interface PortalSite {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode: string | null;
  winterServiceEnabled: boolean;
  lastVisit: string | null;
  nextVisit: string | null;
  lastWinter: string | null;
  openDefects: number;
}
interface Overview {
  client: { id: string; name: string };
  provider: { name: string; address: string | null; city: string | null; postal_code: string | null; phone: string | null; email: string | null; website: string | null };
  showWorkerNames: boolean;
  sites: PortalSite[];
}
interface WinterEntry {
  id: string;
  seq: number;
  performedAt: string;
  activityLabel: string;
  material: string | null;
  amountKg: number | null;
  areas: string[];
  notes: string | null;
  weather: { temperatureC?: number | null; condition?: string | null; precipitationMm?: number | null; station?: string | null } | null;
  photoUrl: string | null;
  employeeName: string | null;
  hash: string;
  isCorrection: boolean;
  correctionReason: string | null;
  voided: boolean;
  supersededBy: string | null;
}
interface WinterData { chainValid: boolean; entries: WinterEntry[] }
type DefectStatus = 'open' | 'scheduled' | 'done' | 'rejected';
interface Defect {
  id: string;
  siteId: string;
  siteName: string;
  title: string;
  description: string | null;
  photoUrl: string | null;
  status: DefectStatus;
  statusLabel: string;
  plannedDate: string | null;
  response: string | null;
  reportedByName: string;
  createdAt: string;
}

const STATUS_STYLE: Record<DefectStatus, string> = {
  open: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-blue-100 text-blue-800',
  done: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-gray-200 text-gray-700',
};

const WEATHER_TEXT: Record<string, string> = {
  dry: 'trocken', fog: 'Nebel', rain: 'Regen', sleet: 'Schneeregen', snow: 'Schnee', hail: 'Hagel', thunderstorm: 'Gewitter',
};

const fmtDay = (iso: string | null) => iso
  ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  : '—';
const fmtDateTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' })
  : '—';

async function api<T>(url: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Fehler (HTTP ${res.status})`);
  return data as T;
}

export default function PortalPage() {
  const { userProfile, logout, changePassword } = useAuth();
  const { toast } = useToast();
  const months = useMemo(() => periodOptions(), []);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [siteId, setSiteId] = useState('');
  const [tab, setTab] = useState('leistung');
  const [month, setMonth] = useState(months[0].value);
  const [report, setReport] = useState<LeistungsnachweisReport | null>(null);
  const [winter, setWinter] = useState<WinterData | null>(null);
  const [defects, setDefects] = useState<Defect[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<{ pdf: LeistungsnachweisPdf | null; error: string | null } | null>(null);
  const [defectForm, setDefectForm] = useState({ title: '', description: '', photo: '' });
  const [sending, setSending] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  const fail = useCallback((title: string, e: unknown) => {
    toast({ variant: 'destructive', title, description: e instanceof Error ? e.message : undefined });
  }, [toast]);

  const loadOverview = useCallback(async () => {
    try {
      const data = await api<Overview>('/api/portal/overview');
      setOverview(data);
      setSiteId(current => current || data.sites[0]?.id || '');
    } catch (e) {
      fail('Portal konnte nicht geladen werden', e);
    }
  }, [fail]);

  const loadDefects = useCallback(async () => {
    try {
      setDefects((await api<{ data: Defect[] }>('/api/portal/defects')).data);
    } catch (e) {
      fail('Meldungen konnten nicht geladen werden', e);
    }
  }, [fail]);

  useEffect(() => { loadOverview(); loadDefects(); }, [loadOverview, loadDefects]);

  useEffect(() => {
    if (!siteId || (tab !== 'leistung' && tab !== 'winter')) return;
    let cancelled = false;
    setLoading(true);
    const query = `siteId=${encodeURIComponent(siteId)}&month=${month}`;
    const request = tab === 'leistung'
      ? api<LeistungsnachweisReport>(`/api/portal/leistungsnachweis?${query}`).then(r => { if (!cancelled) setReport(r); })
      : api<WinterData>(`/api/portal/winter?${query}`).then(w => { if (!cancelled) setWinter(w); });
    request
      .catch(e => { if (!cancelled) fail('Daten konnten nicht geladen werden', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId, month, tab, fail]);

  const site = overview?.sites.find(s => s.id === siteId) ?? null;

  useEffect(() => {
    if (site && !site.winterServiceEnabled && tab === 'winter') setTab('leistung');
  }, [site, tab]);
  const monthLabel = months.find(m => m.value === month)?.label ?? month;
  const siteDefects = (defects ?? []).filter(d => d.siteId === siteId);

  const exportPdf = async () => {
    if (!report) return;
    setExporting(true);
    setPreview({ pdf: null, error: null });
    try {
      setPreview({ pdf: await buildLeistungsnachweisPdf(report, monthLabel), error: null });
    } catch (e: any) {
      setPreview({ pdf: null, error: `PDF konnte nicht erstellt werden${e?.message ? `: ${e.message}` : ''}` });
    } finally {
      setExporting(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setDefectForm(f => ({ ...f, photo: '' }));
      const photo = await compressImage(file);
      setDefectForm(f => ({ ...f, photo }));
    } catch (e) {
      fail('Foto konnte nicht verarbeitet werden', e);
    }
  };

  const sendDefect = async () => {
    if (!defectForm.title.trim()) {
      toast({ variant: 'destructive', title: 'Bitte kurz beschreiben, was nicht in Ordnung ist.' });
      return;
    }
    setSending(true);
    try {
      await api('/api/portal/defects', {
        method: 'POST',
        body: JSON.stringify({ siteId, title: defectForm.title, description: defectForm.description, photo: defectForm.photo || undefined }),
      });
      toast({ title: 'Meldung gesendet', description: `${overview?.provider.name ?? 'Ihr Dienstleister'} wurde benachrichtigt.` });
      setDefectForm({ title: '', description: '', photo: '' });
      await Promise.all([loadDefects(), loadOverview()]);
    } catch (e) {
      fail('Meldung konnte nicht gesendet werden', e);
    } finally {
      setSending(false);
    }
  };

  const savePassword = async () => {
    if (pw.next.length < 12) { toast({ variant: 'destructive', title: 'Das neue Passwort muss mindestens 12 Zeichen haben.' }); return; }
    if (pw.next !== pw.confirm) { toast({ variant: 'destructive', title: 'Die Passwörter stimmen nicht überein.' }); return; }
    try {
      await changePassword(pw.current, pw.next);
      toast({ title: 'Passwort geändert' });
      setPwOpen(false);
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) {
      fail('Passwort nicht geändert', e);
    }
  };

  if (!overview) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const { provider } = overview;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest opacity-70">Kundenportal · {provider.name}</p>
            <h1 className="text-xl md:text-2xl font-black truncate flex items-center gap-2"><Building2 className="w-6 h-6 shrink-0" />{overview.client.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:inline text-sm opacity-80 mr-2">{userProfile?.name}</span>
            <Button variant="secondary" size="sm" className="rounded-lg font-bold" onClick={() => setPwOpen(true)}>
              <KeyRound className="w-4 h-4 md:mr-1.5" /><span className="hidden md:inline">Passwort</span>
            </Button>
            <Button variant="secondary" size="sm" className="rounded-lg font-bold" onClick={() => logout()}>
              <LogOut className="w-4 h-4 md:mr-1.5" /><span className="hidden md:inline">Abmelden</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {overview.sites.length === 0 ? (
          <Card className="rounded-3xl">
            <CardContent className="py-16 text-center space-y-2">
              <MapPin className="w-10 h-10 mx-auto text-muted-foreground" />
              <p className="font-bold">Noch keine Objekte freigegeben</p>
              <p className="text-sm text-muted-foreground">Bitte wenden Sie sich an {provider.name}.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">Ihre Objekte ({overview.sites.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {overview.sites.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSiteId(s.id)}
                    className={`text-left rounded-2xl border bg-card p-4 transition shadow-sm hover:shadow-md ${s.id === siteId ? 'ring-2 ring-primary border-primary' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-black leading-tight">{s.name}</p>
                      {s.openDefects > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                          <AlertTriangle className="w-3 h-3" />{s.openDefects}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{[s.address, [s.postalCode, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                      <div><p className="text-muted-foreground">Letzter Einsatz</p><p className="font-bold">{fmtDay(s.lastVisit)}</p></div>
                      <div><p className="text-muted-foreground">Nächster Einsatz</p><p className="font-bold">{fmtDay(s.nextVisit)}</p></div>
                      {s.winterServiceEnabled && (
                        <div className="col-span-2"><p className="text-muted-foreground">Letzter Winterdienst</p><p className="font-bold">{fmtDateTime(s.lastWinter)}</p></div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {site && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black">{site.name}</h2>
                    <p className="text-sm text-muted-foreground">{[site.address, [site.postalCode, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
                  </div>
                  {tab !== 'maengel' && (
                    <div className="flex items-center gap-2">
                      <Select value={month} onValueChange={setMonth}>
                        <SelectTrigger className="w-44 h-10 rounded-xl font-bold"><Calendar className="w-4 h-4 mr-1" /><SelectValue /></SelectTrigger>
                        <SelectContent>{months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                      </Select>
                      {tab === 'leistung' && (
                        <Button className="h-10 rounded-xl font-black gap-2" onClick={exportPdf} disabled={!report?.visits.length || exporting || loading}>
                          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF ansehen
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList className="h-11 rounded-xl">
                    <TabsTrigger value="leistung" className="font-bold rounded-lg gap-1.5"><ClipboardCheck className="w-4 h-4" />Leistungen</TabsTrigger>
                    {site.winterServiceEnabled && (
                      <TabsTrigger value="winter" className="font-bold rounded-lg gap-1.5"><Snowflake className="w-4 h-4" />Winterdienst</TabsTrigger>
                    )}
                    <TabsTrigger value="maengel" className="font-bold rounded-lg gap-1.5"><AlertTriangle className="w-4 h-4" />Mängel</TabsTrigger>
                  </TabsList>

                  <TabsContent value="leistung" className="mt-4">
                    <LeistungsnachweisView report={report?.site.id === siteId ? report : null} loading={loading} monthLabel={monthLabel} />
                  </TabsContent>

                  <TabsContent value="winter" className="mt-4 space-y-3">
                    {loading || !winter ? (
                      <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : (
                      <>
                        <Card className={`rounded-2xl border-none shadow-sm ${winter.chainValid ? 'bg-emerald-50' : 'bg-red-50'}`}>
                          <CardContent className="p-4 flex items-start gap-3">
                            {winter.chainValid
                              ? <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                              : <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />}
                            <p className="text-sm">
                              {winter.chainValid
                                ? 'Protokoll unverändert: Jeder Eintrag ist mit einer Prüfsumme an den vorherigen gekettet. Nachträgliche Änderungen wären erkennbar; Korrekturen erscheinen als eigene Einträge.'
                                : 'Die Prüfung des Protokolls hat eine Abweichung festgestellt. Bitte wenden Sie sich an Ihren Dienstleister.'}
                            </p>
                          </CardContent>
                        </Card>
                        {winter.entries.length === 0 ? (
                          <Card className="rounded-3xl"><CardContent className="py-14 text-center text-sm text-muted-foreground">Kein Winterdienst-Einsatz in {monthLabel}.</CardContent></Card>
                        ) : (
                          <Card className="rounded-3xl border-none shadow-lg overflow-hidden">
                            <CardContent className="p-0 divide-y">
                              {winter.entries.map(e => (
                                <div key={e.id} className={`p-4 md:p-5 grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3 ${e.voided || e.supersededBy ? 'opacity-60' : ''}`}>
                                  <div>
                                    <p className="font-black">{fmtDateTime(e.performedAt)}</p>
                                    <p className="text-[11px] text-muted-foreground font-mono">Nr. {e.seq} · {e.hash.slice(0, 12)}…</p>
                                  </div>
                                  <div className="text-sm space-y-0.5">
                                    <p className="font-bold">
                                      {e.voided ? 'Storniert' : e.activityLabel}
                                      {e.isCorrection && <span className="ml-2 text-xs font-medium text-amber-700">Korrektur: {e.correctionReason}</span>}
                                      {e.supersededBy && <span className="ml-2 text-xs font-medium text-muted-foreground">(später korrigiert)</span>}
                                    </p>
                                    {!e.voided && (
                                      <p className="text-muted-foreground">
                                        {[e.material && `${e.material}${e.amountKg != null ? `, ${e.amountKg.toLocaleString('de-DE')} kg` : ''}`, e.areas.length ? e.areas.join(', ') : null]
                                          .filter(Boolean).join(' · ') || '—'}
                                      </p>
                                    )}
                                    {e.weather && (
                                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                                        <CloudSnow className="w-3.5 h-3.5" />
                                        {[
                                          e.weather.temperatureC != null ? `${e.weather.temperatureC.toLocaleString('de-DE')} °C` : null,
                                          e.weather.condition ? WEATHER_TEXT[e.weather.condition] ?? e.weather.condition : null,
                                          e.weather.precipitationMm ? `${e.weather.precipitationMm.toLocaleString('de-DE')} mm` : null,
                                          e.weather.station ? `DWD ${e.weather.station}` : 'DWD',
                                        ].filter(Boolean).join(' · ')}
                                      </p>
                                    )}
                                    {e.notes && <p className="text-xs">{e.notes}</p>}
                                    {e.employeeName && <p className="text-xs text-muted-foreground">{e.employeeName}</p>}
                                  </div>
                                  {e.photoUrl && (
                                    <a href={e.photoUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1 self-start">
                                      <ImageIcon className="w-3.5 h-3.5" /> Foto
                                    </a>
                                  )}
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="maengel" className="mt-4 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
                    <Card className="rounded-3xl border-none shadow-lg">
                      <CardContent className="p-5 space-y-3">
                        <p className="font-black text-lg">Mangel melden</p>
                        <div className="space-y-1.5">
                          <Label>Was ist nicht in Ordnung? *</Label>
                          <Input
                            value={defectForm.title}
                            maxLength={200}
                            onChange={e => setDefectForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="z. B. Laub im Hof, Mülltonnen nicht rausgestellt"
                            className="h-11"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Details (optional)</Label>
                          <Textarea
                            value={defectForm.description}
                            maxLength={4000}
                            onChange={e => setDefectForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="Wo genau? Seit wann?"
                            className="min-h-[90px]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Foto (optional)</Label>
                          {defectForm.photo ? (
                            <div className="relative">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={defectForm.photo} alt="Foto zur Meldung" className="rounded-xl max-h-48 w-full object-cover" />
                              <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8" onClick={() => setDefectForm(f => ({ ...f, photo: '' }))} aria-label="Foto entfernen">
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <label className="flex items-center justify-center gap-2 h-20 rounded-xl border-2 border-dashed text-sm font-bold text-muted-foreground cursor-pointer hover:bg-muted/50">
                              <Camera className="w-5 h-5" /> Foto aufnehmen oder auswählen
                              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => pickPhoto(e.target.files?.[0])} />
                            </label>
                          )}
                        </div>
                        <Button className="w-full h-11 rounded-xl font-black" onClick={sendDefect} disabled={sending}>
                          {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />} Meldung senden
                        </Button>
                      </CardContent>
                    </Card>

                    <div className="space-y-3">
                      {defects === null ? (
                        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                      ) : siteDefects.length === 0 ? (
                        <Card className="rounded-3xl"><CardContent className="py-14 text-center text-sm text-muted-foreground">Keine Meldungen für dieses Objekt.</CardContent></Card>
                      ) : siteDefects.map(d => (
                        <Card key={d.id} className="rounded-2xl border-none shadow-sm">
                          <CardContent className="p-4 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${STATUS_STYLE[d.status]}`}>
                                {d.status === 'done' && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}
                                {d.statusLabel}{d.status === 'scheduled' && d.plannedDate ? ` für ${fmtDay(d.plannedDate)}` : ''}
                              </span>
                              <span className="text-xs text-muted-foreground">{fmtDateTime(d.createdAt)} · {d.reportedByName}</span>
                            </div>
                            <p className="font-black">{d.title}</p>
                            {d.description && <p className="text-sm text-muted-foreground whitespace-pre-line">{d.description}</p>}
                            {d.response && (
                              <p className="text-sm rounded-xl bg-muted px-3 py-2"><span className="font-bold">{provider.name}:</span> {d.response}</p>
                            )}
                            {d.photoUrl && (
                              <a href={d.photoUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                                <ImageIcon className="w-3.5 h-3.5" /> Foto
                              </a>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </section>
            )}
          </>
        )}

        <Card className="rounded-2xl border-none shadow-sm">
          <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-black">Ihr Dienstleister: {provider.name}</span>
            {provider.phone && <a href={`tel:${provider.phone}`} className="inline-flex items-center gap-1.5 text-primary font-bold"><Phone className="w-4 h-4" />{provider.phone}</a>}
            {provider.email && <a href={`mailto:${provider.email}`} className="inline-flex items-center gap-1.5 text-primary font-bold"><Mail className="w-4 h-4" />{provider.email}</a>}
            {(provider.address || provider.city) && (
              <span className="text-muted-foreground">{[provider.address, [provider.postal_code, provider.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Passwort ändern</DialogTitle>
            <DialogDescription>Mindestens 12 Zeichen. Andere angemeldete Geräte werden abgemeldet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Aktuelles Passwort</Label><Input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} className="h-11" /></div>
            <div className="space-y-1.5"><Label>Neues Passwort</Label><Input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} className="h-11" /></div>
            <div className="space-y-1.5"><Label>Neues Passwort bestätigen</Label><Input type="password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} className="h-11" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)}>Abbrechen</Button>
            <Button onClick={savePassword} className="font-bold">Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PdfPreviewDialog
        open={preview !== null}
        onOpenChange={open => { if (!open) setPreview(null); }}
        pdf={preview?.pdf ?? null}
        error={preview?.error}
        title={`Leistungsnachweis · ${site?.name ?? ''} · ${monthLabel}`}
      />
    </div>
  );
}
