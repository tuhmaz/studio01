"use client";

/**
 * Hausverwaltungen — Kunden des Dienstleisters und ihr Zugang zum Kundenportal.
 *
 * Tab 1: Hausverwaltungen anlegen, Objekte zuordnen, Portal-Zugänge verwalten.
 * Tab 2: Mängelmeldungen aus dem Portal bearbeiten (Status + Antwort an den Kunden).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, Copy, Image as ImageIcon, KeyRound, Loader2, Mail, MapPin, Pencil, Phone, Plus, Search, Trash2, Wand2,
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';
import { UserRole } from '@/lib/types';

interface SiteRef { id: string; name: string; city: string }
interface Login { id: string; name: string; email: string; lastLogin: string | null }
interface Client {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  sites: SiteRef[];
  logins: Login[];
  openDefects: number;
}
interface SiteOption extends SiteRef { clientId: string | null }
interface Overview {
  clients: Client[];
  sites: SiteOption[];
  portalShowWorkerNames: boolean;
  canManageLogins: boolean;
}
type DefectStatus = 'open' | 'scheduled' | 'done' | 'rejected';
interface Defect {
  id: string;
  siteName: string;
  siteAddress: string;
  clientName: string;
  title: string;
  description: string | null;
  photoUrl: string | null;
  status: DefectStatus;
  statusLabel: string;
  storedStatus: DefectStatus;
  response: string | null;
  reportedByName: string;
  assignmentPublished: boolean;
  assignmentStatus: string | null;
  plannedDate: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<DefectStatus, string> = {
  open: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-blue-100 text-blue-800',
  done: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-gray-200 text-gray-700',
};

const EMPTY_FORM = { id: '', name: '', contactName: '', email: '', phone: '', address: '', notes: '', siteIds: [] as string[] };

async function api<T>(url: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Fehler (HTTP ${res.status})`);
  return data as T;
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

export default function KundenPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const role = (userProfile?.role ?? 'WORKER') as UserRole;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const [data, setData] = useState<Overview | null>(null);
  const [defects, setDefects] = useState<Defect[] | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [siteSearch, setSiteSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [loginFor, setLoginFor] = useState<Client | null>(null);
  const [loginForm, setLoginForm] = useState({ name: '', email: '', password: '' });
  const [createdLogin, setCreatedLogin] = useState<{ email: string; password: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: DefectStatus; response: string }>>({});

  const fail = useCallback((title: string, e: unknown) => {
    toast({ variant: 'destructive', title, description: e instanceof Error ? e.message : undefined });
  }, [toast]);

  const load = useCallback(async () => {
    try {
      const [overview, defectList] = await Promise.all([
        api<Overview>('/api/clients'),
        api<{ data: Defect[] }>('/api/defects'),
      ]);
      setData(overview);
      setDefects(defectList.data);
    } catch (e) {
      fail('Daten konnten nicht geladen werden', e);
    }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  const siteOwner = useMemo(() => {
    const map = new Map<string, string>();
    data?.clients.forEach(c => c.sites.forEach(s => map.set(s.id, c.name)));
    return map;
  }, [data]);

  const openCount = defects?.filter(d => d.status === 'open').length ?? 0;

  const openForm = (client?: Client) => {
    setForm(client
      ? {
          id: client.id, name: client.name, contactName: client.contactName ?? '', email: client.email ?? '',
          phone: client.phone ?? '', address: client.address ?? '', notes: client.notes ?? '', siteIds: client.sites.map(s => s.id),
        }
      : EMPTY_FORM);
    setSiteSearch('');
    setFormOpen(true);
  };

  const saveClient = async () => {
    setSaving(true);
    try {
      await api('/api/clients', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      toast({ title: form.id ? 'Gespeichert' : 'Hausverwaltung angelegt' });
      setFormOpen(false);
      await load();
    } catch (e) {
      fail('Speichern fehlgeschlagen', e);
    } finally {
      setSaving(false);
    }
  };

  const removeClient = async (client: Client) => {
    if (!window.confirm(`„${client.name}“ löschen? Portal-Zugänge und Mängelmeldungen werden entfernt, die Objekte bleiben erhalten.`)) return;
    try {
      await api(`/api/clients?id=${encodeURIComponent(client.id)}`, { method: 'DELETE' });
      toast({ title: 'Hausverwaltung gelöscht' });
      await load();
    } catch (e) {
      fail('Löschen fehlgeschlagen', e);
    }
  };

  const openLogin = (client: Client) => {
    setLoginFor(client);
    setLoginForm({ name: client.contactName ?? '', email: client.email ?? '', password: generatePassword() });
    setCreatedLogin(null);
  };

  const saveLogin = async () => {
    if (!loginFor) return;
    setSaving(true);
    try {
      await api('/api/clients/logins', { method: 'POST', body: JSON.stringify({ clientId: loginFor.id, ...loginForm }) });
      setCreatedLogin({ email: loginForm.email.trim().toLowerCase(), password: loginForm.password });
      await load();
    } catch (e) {
      fail('Zugang konnte nicht angelegt werden', e);
    } finally {
      setSaving(false);
    }
  };

  const removeLogin = async (login: Login) => {
    if (!window.confirm(`Zugang ${login.email} löschen? Die Person kann sich danach nicht mehr anmelden.`)) return;
    try {
      await api(`/api/clients/logins?userId=${encodeURIComponent(login.id)}`, { method: 'DELETE' });
      toast({ title: 'Zugang gelöscht' });
      await load();
    } catch (e) {
      fail('Löschen fehlgeschlagen', e);
    }
  };

  const toggleNames = async (value: boolean) => {
    try {
      await api('/api/data', {
        method: 'POST',
        body: JSON.stringify({ action: 'update', table: 'companies', filters: { id: userProfile?.companyId }, data: { portal_show_worker_names: value } }),
      });
      setData(d => d ? { ...d, portalShowWorkerNames: value } : d);
    } catch (e) {
      fail('Einstellung nicht gespeichert', e);
    }
  };

  const credentialsText = createdLogin
    ? `Kundenportal ${typeof window !== 'undefined' ? window.location.origin : ''}\nE-Mail: ${createdLogin.email}\nPasswort: ${createdLogin.password}`
    : '';

  const saveDefect = async (defect: Defect) => {
    const draft = drafts[defect.id];
    if (!draft) return;
    try {
      await api('/api/defects', { method: 'PATCH', body: JSON.stringify({ id: defect.id, status: draft.status, response: draft.response }) });
      toast({ title: 'Meldung aktualisiert', description: 'Die Hausverwaltung sieht den neuen Stand im Portal.' });
      setDrafts(d => { const next = { ...d }; delete next[defect.id]; return next; });
      await load();
    } catch (e) {
      fail('Speichern fehlgeschlagen', e);
    }
  };

  const filteredSites = (data?.sites ?? []).filter(s =>
    !siteSearch || `${s.name} ${s.city}`.toLowerCase().includes(siteSearch.toLowerCase()));

  return (
    <Shell userRole={role} userName={userProfile?.name ?? ''}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase flex items-center gap-3">
              <Building2 className="w-8 h-8" /> Hausverwaltungen
            </h1>
            <p className="text-muted-foreground font-medium">Kunden, ihre Objekte und der Zugang zum Kundenportal</p>
          </div>
          <Button className="h-12 px-6 font-bold shadow-lg" onClick={() => openForm()}>
            <Plus className="mr-2 h-5 w-5" /> Neue Hausverwaltung
          </Button>
        </div>

        {data === null ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue={openCount ? 'defects' : 'clients'}>
            <TabsList className="h-11 rounded-xl">
              <TabsTrigger value="clients" className="font-bold rounded-lg">Hausverwaltungen ({data.clients.length})</TabsTrigger>
              <TabsTrigger value="defects" className="font-bold rounded-lg gap-2">
                Mängelmeldungen
                {openCount > 0 && <span className="rounded-full bg-amber-500 text-white text-[11px] px-2 py-0.5">{openCount} neu</span>}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="clients" className="space-y-4 mt-4">
              <Card className="rounded-2xl border-none shadow-sm">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-bold">Mitarbeiternamen im Portal zeigen</p>
                    <p className="text-xs text-muted-foreground">Aus: Die Hausverwaltung sieht nur, was wann erledigt wurde – nicht von wem.</p>
                  </div>
                  <Switch checked={data.portalShowWorkerNames} onCheckedChange={toggleNames} disabled={!isAdmin} />
                </CardContent>
              </Card>

              {data.clients.length === 0 ? (
                <Card className="rounded-3xl border-dashed">
                  <CardContent className="py-16 text-center space-y-2">
                    <Building2 className="w-10 h-10 mx-auto text-muted-foreground" />
                    <p className="font-bold">Noch keine Hausverwaltung angelegt</p>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Legen Sie Ihre Auftraggeber an, ordnen Sie ihnen Objekte zu und geben Sie ihnen einen Zugang:
                      Sie sehen dann Leistungsnachweise, Winterdienst-Protokolle und Fotos und können Mängel melden.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {data.clients.map(client => (
                    <Card key={client.id} className="rounded-3xl border-none shadow-lg">
                      <CardContent className="p-6 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="text-xl font-black truncate">{client.name}</h2>
                            <div className="text-sm text-muted-foreground space-y-0.5 mt-1">
                              {client.contactName && <p>{client.contactName}</p>}
                              {client.email && <p className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{client.email}</p>}
                              {client.phone && <p className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{client.phone}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {client.openDefects > 0 && (
                              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1"><AlertTriangle className="w-3 h-3" />{client.openDefects} offen</Badge>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => openForm(client)} aria-label="Bearbeiten"><Pencil className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => removeClient(client)} aria-label="Löschen"><Trash2 className="w-4 h-4 text-red-600" /></Button>
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Objekte ({client.sites.length})</p>
                          {client.sites.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {client.sites.map(s => (
                                <Badge key={s.id} variant="secondary" className="font-medium"><MapPin className="w-3 h-3 mr-1" />{s.name}</Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">Noch keine Objekte zugeordnet.</p>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Portal-Zugänge</p>
                            {data.canManageLogins && (
                              <Button variant="outline" size="sm" className="h-8 rounded-lg font-bold" onClick={() => openLogin(client)}>
                                <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Zugang anlegen
                              </Button>
                            )}
                          </div>
                          {client.logins.length ? (
                            <ul className="divide-y rounded-xl border">
                              {client.logins.map(login => (
                                <li key={login.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold truncate">{login.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {login.email} · {login.lastLogin ? `zuletzt ${fmtDateTime(login.lastLogin)}` : 'noch nie angemeldet'}
                                    </p>
                                  </div>
                                  {data.canManageLogins && (
                                    <Button variant="ghost" size="icon" onClick={() => removeLogin(login)} aria-label="Zugang löschen">
                                      <Trash2 className="w-4 h-4 text-red-600" />
                                    </Button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">Kein Zugang – die Hausverwaltung kann das Portal noch nicht nutzen.</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="defects" className="space-y-3 mt-4">
              {!defects?.length ? (
                <Card className="rounded-3xl border-dashed">
                  <CardContent className="py-16 text-center text-sm text-muted-foreground">
                    Keine Mängelmeldungen. Meldungen aus dem Kundenportal erscheinen hier und als Aufgabe im Tourplan.
                  </CardContent>
                </Card>
              ) : defects.map(defect => {
                const draft = drafts[defect.id] ?? { status: defect.storedStatus, response: defect.response ?? '' };
                const dirty = !!drafts[defect.id];
                return (
                  <Card key={defect.id} className="rounded-2xl border-none shadow-sm">
                    <CardContent className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${STATUS_STYLE[defect.status]}`}>{defect.statusLabel}</span>
                          <span className="text-xs text-muted-foreground">{fmtDateTime(defect.createdAt)} · {defect.reportedByName}</span>
                        </div>
                        <p className="text-lg font-black">{defect.title}</p>
                        <p className="text-sm font-medium">{defect.clientName} — {defect.siteName}, {defect.siteAddress}</p>
                        {defect.description && <p className="text-sm text-muted-foreground whitespace-pre-line">{defect.description}</p>}
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          {defect.photoUrl && (
                            <a href={defect.photoUrl} target="_blank" rel="noreferrer" className="font-bold text-primary hover:underline inline-flex items-center gap-1">
                              <ImageIcon className="w-3.5 h-3.5" /> Foto ansehen
                            </a>
                          )}
                          <span className="text-muted-foreground">
                            Tourplan: {defect.assignmentStatus == null
                              ? 'Aufgabe gelöscht'
                              : defect.assignmentStatus === 'COMPLETED'
                                ? 'erledigt'
                                : defect.assignmentPublished
                                  ? `veröffentlicht${defect.plannedDate ? ` für ${fmtDay(defect.plannedDate)}` : ''}`
                                  : 'noch nicht veröffentlicht – im Tourplan Team und Datum festlegen'}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Select value={draft.status} onValueChange={v => setDrafts(d => ({ ...d, [defect.id]: { ...draft, status: v as DefectStatus } }))}>
                          <SelectTrigger className="h-10 rounded-xl font-bold"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Eingegangen</SelectItem>
                            <SelectItem value="scheduled">Eingeplant</SelectItem>
                            <SelectItem value="done">Erledigt</SelectItem>
                            <SelectItem value="rejected">Abgelehnt</SelectItem>
                          </SelectContent>
                        </Select>
                        <Textarea
                          placeholder="Antwort an die Hausverwaltung (sichtbar im Portal)"
                          value={draft.response}
                          onChange={e => setDrafts(d => ({ ...d, [defect.id]: { ...draft, response: e.target.value } }))}
                          className="min-h-[72px] rounded-xl"
                        />
                        <Button className="w-full h-10 rounded-xl font-bold" disabled={!dirty} onClick={() => saveDefect(defect)}>Speichern</Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-2xl rounded-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">{form.id ? 'Hausverwaltung bearbeiten' : 'Neue Hausverwaltung'}</DialogTitle>
            <DialogDescription>Stammdaten und die Objekte, die diese Hausverwaltung im Portal sieht.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z. B. Musterverwaltung GmbH" className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>Ansprechpartner</Label>
              <Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>E-Mail</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>Telefon</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>Adresse</Label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Interne Notiz</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="min-h-[60px]" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Objekte ({form.siteIds.length} ausgewählt)</Label>
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input value={siteSearch} onChange={e => setSiteSearch(e.target.value)} placeholder="Suchen" className="h-9 pl-8" />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border divide-y">
              {filteredSites.length === 0 && <p className="text-sm text-muted-foreground p-4">Keine Objekte gefunden.</p>}
              {filteredSites.map(site => {
                const checked = form.siteIds.includes(site.id);
                const owner = site.clientId && site.clientId !== form.id ? siteOwner.get(site.id) : null;
                return (
                  <label key={site.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={v => setForm(f => ({
                        ...f,
                        siteIds: v ? [...f.siteIds, site.id] : f.siteIds.filter(id => id !== site.id),
                      }))}
                    />
                    <span className="text-sm font-medium flex-1">{site.name}{site.city && site.city !== site.name ? ` (${site.city})` : ''}</span>
                    {owner && <span className="text-[11px] text-amber-700">{checked ? `wird von ${owner} übernommen` : owner}</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Abbrechen</Button>
            <Button onClick={saveClient} disabled={saving || !form.name.trim()} className="font-bold">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!loginFor} onOpenChange={open => { if (!open) setLoginFor(null); }}>
        <DialogContent className="sm:max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">Portal-Zugang für {loginFor?.name}</DialogTitle>
            <DialogDescription>Die Person meldet sich mit E-Mail und Passwort auf der normalen Anmeldeseite an und landet direkt im Kundenportal.</DialogDescription>
          </DialogHeader>
          {createdLogin ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-emerald-700">Zugang angelegt. Diese Daten jetzt weitergeben – das Passwort wird nicht noch einmal angezeigt.</p>
              <pre className="rounded-xl bg-muted p-4 text-sm whitespace-pre-wrap">{credentialsText}</pre>
              <DialogFooter>
                <Button variant="outline" onClick={() => { void window.navigator.clipboard?.writeText(credentialsText); toast({ title: 'Kopiert' }); }}>
                  <Copy className="w-4 h-4 mr-2" /> Kopieren
                </Button>
                <Button onClick={() => setLoginFor(null)}>Fertig</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={loginForm.name} onChange={e => setLoginForm({ ...loginForm, name: e.target.value })} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label>E-Mail (Login)</Label>
                <Input type="email" value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label>Passwort</Label>
                <div className="flex gap-2">
                  <Input value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} className="h-11 font-mono" />
                  <Button type="button" variant="outline" className="h-11" onClick={() => setLoginForm({ ...loginForm, password: generatePassword() })} aria-label="Neues Passwort">
                    <Wand2 className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{loginForm.password.length}/12 Zeichen mindestens. Die Person kann es nach der Anmeldung ändern.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setLoginFor(null)}>Abbrechen</Button>
                <Button onClick={saveLogin} disabled={saving} className="font-bold">
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Zugang anlegen
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
