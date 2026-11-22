"use client";
/**
 * Excel/CSV-Import für Objekte und Mitarbeiter – für Firmen mit eigener Tabelle.
 *
 *  1. Datei wählen (xlsx, xls, csv), ggf. Tabellenblatt.
 *  2. Spalten zuordnen (automatisch vorgeschlagen).
 *  3. Prüfen: Server meldet je Zeile neu / übersprungen / Fehler.
 *  4. Importieren. Objekte: danach Koordinaten im Hintergrund.
 *     Mitarbeiter: Startpasswörter einmalig als Liste zum Herunterladen.
 *
 * Der eigene Leistungsverzeichnis-Import (Farben) bleibt auf der Objekte-Seite.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, Download, FileSpreadsheet, KeyRound, Loader2, MapPin, MinusCircle, Upload, Users, XCircle,
} from 'lucide-react';
import { Shell } from '@/components/layout/Shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/db/provider';
import { useToast } from '@/hooks/use-toast';
import { hasPermission } from '@/lib/permissions';
import { UserRole } from '@/lib/types';
import { IMPORT_FIELDS, MAX_IMPORT_ROWS, guessMapping, mapRows, type ImportRow, type ImportType } from '@/lib/import/fields';

interface RowResult { row: number; label: string; status: 'new' | 'skip' | 'error'; messages: string[] }
interface ImportResult {
  rows: RowResult[];
  counts: { new: number; skip: number; error: number };
  created: number;
  credentials?: Array<{ name: string; email: string; role: string; password: string }>;
  createdSiteIds?: string[];
}

interface Sheet { name: string; headers: string[]; rows: unknown[][] }

const NONE = '__none__';

const TEMPLATES: Record<ImportType, { file: string; rows: string[][] }> = {
  sites: {
    file: 'Vorlage_Objekte.xlsx',
    rows: [
      ['Bezeichnung', 'Straße', 'PLZ', 'Ort', 'Region', 'Hausverwaltung', 'Leistungen', 'Monate', 'Winterdienst'],
      ['Lindenhof', 'Lindenstr. 4', '39104', 'Magdeburg', 'Tour 1', 'HV Nord GmbH', 'Hofbereich, Rasen Fl. 1, Treppenhaus reinigen', 'Apr-Okt', 'ja'],
      ['', 'Parkweg 2', '06108', 'Halle', 'Tour 2', '', 'Gullis, Ablaufrinnen', '', 'nein'],
    ],
  },
  users: {
    file: 'Vorlage_Mitarbeiter.xlsx',
    rows: [
      ['Vorname', 'Nachname', 'E-Mail', 'Rolle', 'Vertragsart', 'Stundenlohn', 'Soll-Stunden', 'Steuerklasse'],
      ['Ayşe', 'Demir', 'ayse.demir@beispiel.de', 'Teamleiter', 'Vollzeit', '15,50', '160', '1'],
      ['Piotr', 'Nowak', 'piotr.nowak@beispiel.de', 'Mitarbeiter', 'Minijob', '13,90', '40', ''],
    ],
  },
};

function readSheets(workbook: XLSX.WorkBook): Sheet[] {
  return workbook.SheetNames.map(name => {
    const all = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
    // Kopfzeile = erste Zeile mit mindestens zwei ausgefüllten Zellen (Titelzeilen darüber überspringen).
    const headerIndex = all.findIndex(r => r.filter(c => String(c ?? '').trim()).length >= 2);
    if (headerIndex < 0) return { name, headers: [], rows: [] };
    const headers = all[headerIndex].map((h, i) => String(h ?? '').trim() || `Spalte ${XLSX.utils.encode_col(i)}`);
    return { name, headers, rows: all.slice(headerIndex + 1) };
  }).filter(s => s.headers.length > 0);
}

function ImportPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { userProfile } = useAuth();
  const role = (userProfile?.role ?? 'WORKER') as UserRole;
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ImportType>(params.get('type') === 'users' ? 'users' : 'sites');
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [geo, setGeo] = useState<{ done: number; total: number } | null>(null);

  const canSites = hasPermission({ role } as Parameters<typeof hasPermission>[0], 'job_sites.manage');
  const canUsers = hasPermission({ role } as Parameters<typeof hasPermission>[0], 'users.create');
  const allowed = type === 'sites' ? canSites : canUsers;

  const sheet = sheets[sheetIndex] ?? null;
  const fields = IMPORT_FIELDS[type];
  const rows: ImportRow[] = useMemo(() => (sheet ? mapRows(sheet.rows, mapping) : []), [sheet, mapping]);
  const sample = (index: number | null) => {
    if (index == null || !sheet) return '';
    const value = sheet.rows.find(r => String(r[index] ?? '').trim())?.[index];
    return value == null ? '' : String(value);
  };
  const missingRequired = fields.filter(f => f.required && mapping[f.key] == null);
  const needsName = type === 'users' && mapping.name == null && (mapping.firstName == null || mapping.lastName == null);

  // Zuordnung neu vorschlagen bei neuer Datei, anderem Blatt oder anderer Importart.
  useEffect(() => {
    setMapping(sheet ? guessMapping(type, sheet.headers) : {});
    setCheck(null);
    setDone(null);
  }, [sheet, type]);

  const reset = () => {
    setFileName(null); setSheets([]); setSheetIndex(0); setCheck(null); setDone(null); setGeo(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const switchType = (next: string) => {
    setType(next as ImportType);
    router.replace(`/import?type=${next}`);
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'dd.mm.yyyy', codepage: 65001 });
      const found = readSheets(workbook);
      if (!found.length) throw new Error('Keine Tabelle mit Überschriften gefunden.');
      setFileName(file.name);
      setSheets(found);
      setSheetIndex(0);
    } catch (e: any) {
      toast({ title: 'Datei nicht lesbar', description: e?.message ?? 'Bitte .xlsx, .xls oder .csv verwenden.', variant: 'destructive' });
    }
  };

  const downloadTemplate = () => {
    const { file, rows: templateRows } = TEMPLATES[type];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(templateRows);
    ws['!cols'] = templateRows[0].map((_, i) => ({ wch: Math.max(...templateRows.map(r => String(r[i] ?? '').length), 12) + 2 }));
    XLSX.utils.book_append_sheet(wb, ws, type === 'sites' ? 'Objekte' : 'Mitarbeiter');
    XLSX.writeFile(wb, file);
  };

  const send = async (dryRun: boolean): Promise<ImportResult | null> => {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, rows, dryRun }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: dryRun ? 'Prüfung fehlgeschlagen' : 'Import fehlgeschlagen', description: json?.error, variant: 'destructive' });
      return null;
    }
    return json.data as ImportResult;
  };

  const runCheck = async () => {
    setBusy('check');
    try {
      setCheck(await send(true));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    setBusy('import');
    try {
      const result = await send(false);
      if (!result) return;
      setDone(result);
      setCheck(null);
      toast({ title: `${result.created} ${type === 'sites' ? 'Objekte' : 'Mitarbeiter'} angelegt` });
      if (type === 'sites' && result.createdSiteIds?.length) geocode(result.createdSiteIds);
    } finally {
      setBusy(null);
    }
  };

  // Koordinaten und Fahrzeiten nachladen (Nominatim: ca. 1 Objekt pro Sekunde).
  const geocode = async (ids: string[]) => {
    setGeo({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteIds: chunk }) })
        .catch(() => undefined);
      setGeo({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
  };

  const downloadCredentials = () => {
    if (!done?.credentials?.length) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'E-Mail (Benutzername)', 'Rolle', 'Startpasswort'],
      ...done.credentials.map(c => [c.name, c.email, c.role, c.password]),
      [],
      [`Anmeldung: ${window.location.origin} bzw. Mitarbeiter-App. Bitte Passwort nach der ersten Anmeldung ändern.`],
    ]);
    ws['!cols'] = [{ wch: 28 }, { wch: 34 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Zugangsdaten');
    XLSX.writeFile(wb, `Zugangsdaten_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const sortedCheck = check ? [...check.rows].sort((a, b) => {
    const order = { error: 0, skip: 1, new: 2 } as const;
    return order[a.status] - order[b.status] || a.row - b.row;
  }) : [];

  return (
    <Shell userRole={role} userName={userProfile?.name ?? ''}>
      <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8" /> Import aus Excel
            </h1>
            <p className="text-muted-foreground font-medium">Objekte oder Mitarbeiter aus einer eigenen Tabelle (.xlsx, .xls, .csv) übernehmen</p>
          </div>
          <Tabs value={type} onValueChange={switchType}>
            <TabsList className="rounded-xl h-11">
              <TabsTrigger value="sites" className="font-bold rounded-lg gap-1.5" disabled={busy !== null}><Building2 className="w-4 h-4" />Objekte</TabsTrigger>
              <TabsTrigger value="users" className="font-bold rounded-lg gap-1.5" disabled={busy !== null}><Users className="w-4 h-4" />Mitarbeiter</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {!allowed ? (
          <Card className="rounded-2xl border-none shadow-sm"><CardContent className="p-8 text-center text-muted-foreground">
            Keine Berechtigung für diesen Import.
          </CardContent></Card>
        ) : done ? (
          <DoneView type={type} result={done} geo={geo} onCredentials={downloadCredentials} onAgain={reset}
            onOpen={() => router.push(type === 'sites' ? '/jobs' : '/team')} />
        ) : (
          <>
            {/* 1. Datei */}
            <Card className="rounded-2xl border-none shadow-sm">
              <CardContent className="p-6 space-y-4">
                <StepTitle n={1} title="Datei wählen" />
                <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => openFile(e.target.files?.[0])} />
                {!fileName ? (
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); openFile(e.dataTransfer.files?.[0]); }}
                    onClick={() => fileInput.current?.click()}
                    className="border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                    <p className="mt-3 font-bold">Datei hierher ziehen oder klicken</p>
                    <p className="text-sm text-muted-foreground">Erste Zeile mit Spaltenüberschriften, eine Zeile pro {type === 'sites' ? 'Objekt' : 'Mitarbeiter'} · höchstens {MAX_IMPORT_ROWS[type].toLocaleString('de-DE')} Zeilen</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary" className="text-sm py-1.5 px-3 gap-2 rounded-lg"><FileSpreadsheet className="w-4 h-4" />{fileName}</Badge>
                    {sheets.length > 1 && (
                      <Select value={String(sheetIndex)} onValueChange={v => setSheetIndex(Number(v))}>
                        <SelectTrigger className="w-56 h-9 rounded-lg"><SelectValue /></SelectTrigger>
                        <SelectContent>{sheets.map((s, i) => <SelectItem key={s.name} value={String(i)}>Blatt: {s.name}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    <span className="text-sm text-muted-foreground">{rows.length.toLocaleString('de-DE')} Zeilen mit Daten</span>
                    <Button variant="ghost" size="sm" onClick={reset}>Andere Datei</Button>
                  </div>
                )}
                <Button variant="link" className="px-0 h-auto gap-1.5" onClick={downloadTemplate}>
                  <Download className="w-4 h-4" /> Vorlage herunterladen ({type === 'sites' ? 'Objekte' : 'Mitarbeiter'})
                </Button>
              </CardContent>
            </Card>

            {/* 2. Zuordnung */}
            {sheet && (
              <Card className="rounded-2xl border-none shadow-sm">
                <CardContent className="p-6 space-y-4">
                  <StepTitle n={2} title="Spalten zuordnen" sub="Automatisch vorgeschlagen – bitte prüfen." />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                    {fields.map(field => (
                      <div key={field.key} className="grid grid-cols-[170px_1fr] items-center gap-3">
                        <div>
                          <p className="text-sm font-bold">{field.label}{field.required && <span className="text-destructive"> *</span>}</p>
                          {field.hint && <p className="text-[11px] text-muted-foreground leading-tight">{field.hint}</p>}
                        </div>
                        <div className="min-w-0">
                          <Select
                            value={mapping[field.key] == null ? NONE : String(mapping[field.key])}
                            onValueChange={v => { setMapping(m => ({ ...m, [field.key]: v === NONE ? null : Number(v) })); setCheck(null); }}
                          >
                            <SelectTrigger className={`h-9 rounded-lg ${field.required && mapping[field.key] == null ? 'border-destructive' : ''}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>— nicht importieren —</SelectItem>
                              {sheet.headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {mapping[field.key] != null && (
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">z. B. „{sample(mapping[field.key])}“</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(missingRequired.length > 0 || needsName) && (
                    <p className="text-sm text-destructive flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Bitte zuordnen: {[...missingRequired.map(f => f.label), ...(needsName ? ['Name (oder Vorname + Nachname)'] : [])].join(', ')}
                    </p>
                  )}
                  <Button className="h-11 rounded-xl font-black gap-2" onClick={runCheck}
                    disabled={busy !== null || missingRequired.length > 0 || needsName || rows.length === 0}>
                    {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {rows.length.toLocaleString('de-DE')} Zeilen prüfen
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* 3. Prüfung */}
            {check && (
              <Card className="rounded-2xl border-none shadow-sm">
                <CardContent className="p-6 space-y-4">
                  <StepTitle n={3} title="Prüfen und importieren" />
                  <div className="flex flex-wrap gap-3">
                    <Count icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} label="werden angelegt" value={check.counts.new} />
                    <Count icon={<MinusCircle className="w-4 h-4 text-muted-foreground" />} label="übersprungen (gibt es schon)" value={check.counts.skip} />
                    <Count icon={<XCircle className="w-4 h-4 text-destructive" />} label="mit Fehlern (werden nicht importiert)" value={check.counts.error} />
                  </div>
                  <div className="max-h-[440px] overflow-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 sticky top-0 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <tr><th className="text-left px-3 py-2 w-16">Zeile</th><th className="text-left px-3 py-2">{type === 'sites' ? 'Objekt' : 'Mitarbeiter'}</th><th className="text-left px-3 py-2">Hinweis</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {sortedCheck.map(r => (
                          <tr key={r.row} className={r.status === 'error' ? 'bg-destructive/5' : r.status === 'skip' ? 'text-muted-foreground' : ''}>
                            <td className="px-3 py-2 tabular-nums">{r.row}</td>
                            <td className="px-3 py-2 font-medium">
                              <span className="inline-flex items-center gap-1.5">
                                {r.status === 'new' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : r.status === 'skip' ? <MinusCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                                {r.label}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs">{r.messages.join(' · ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {check.counts.error > 0 && (
                    <p className="text-sm text-muted-foreground">Fehlerhafte Zeilen in der Datei korrigieren und neu laden – oder ohne sie importieren.</p>
                  )}
                  <Button className="h-11 rounded-xl font-black gap-2" onClick={runImport} disabled={busy !== null || check.counts.new === 0}>
                    {busy === 'import' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {check.counts.new.toLocaleString('de-DE')} {type === 'sites' ? 'Objekte' : 'Mitarbeiter'} importieren
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <ImportPageInner />
    </Suspense>
  );
}

function StepTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-black flex items-center justify-center">{n}</span>
      <div>
        <p className="font-black">{title}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function Count({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-4 py-2">
      {icon}<span className="text-lg font-black tabular-nums">{value.toLocaleString('de-DE')}</span><span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function DoneView({ type, result, geo, onCredentials, onAgain, onOpen }: {
  type: ImportType;
  result: ImportResult;
  geo: { done: number; total: number } | null;
  onCredentials: () => void;
  onAgain: () => void;
  onOpen: () => void;
}) {
  return (
    <Card className="rounded-2xl border-none shadow-sm">
      <CardContent className="p-8 space-y-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          <div>
            <p className="text-2xl font-black">{result.created.toLocaleString('de-DE')} {type === 'sites' ? 'Objekte' : 'Mitarbeiter'} angelegt</p>
            <p className="text-sm text-muted-foreground">{result.counts.skip} übersprungen · {result.counts.error} mit Fehlern nicht importiert</p>
          </div>
        </div>

        {type === 'sites' && geo && (
          <p className="text-sm flex items-center gap-2">
            {geo.done < geo.total ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4 text-emerald-600" />}
            {geo.done < geo.total
              ? `Koordinaten und Fahrzeiten werden ermittelt … ${geo.done} / ${geo.total} (Seite bitte offen lassen)`
              : 'Koordinaten und Fahrzeiten ermittelt.'}
          </p>
        )}

        {type === 'users' && !!result.credentials?.length && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
            <p className="text-sm font-bold text-amber-900 flex items-center gap-2"><KeyRound className="w-4 h-4" />Startpasswörter – nur jetzt sichtbar</p>
            <p className="text-sm text-amber-900">Bitte die Liste herunterladen und den Mitarbeitern ihre Zugangsdaten persönlich geben. Danach kann sie niemand mehr abrufen (Passwörter werden nur verschlüsselt gespeichert).</p>
            <div className="max-h-64 overflow-auto rounded-lg bg-white border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {result.credentials.map(c => (
                    <tr key={c.email}>
                      <td className="px-3 py-1.5 font-medium">{c.name}</td>
                      <td className="px-3 py-1.5">{c.email}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{c.role}</td>
                      <td className="px-3 py-1.5 font-mono">{c.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button className="rounded-xl font-black gap-2" onClick={onCredentials}><Download className="w-4 h-4" />Zugangsdaten herunterladen (Excel)</Button>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" className="rounded-xl gap-2" onClick={onOpen}>
            <ArrowLeft className="w-4 h-4" /> Zu {type === 'sites' ? 'den Objekten' : 'Team'}
          </Button>
          <Button variant="ghost" className="rounded-xl" onClick={onAgain}>Weitere Datei importieren</Button>
        </div>
      </CardContent>
    </Card>
  );
}
