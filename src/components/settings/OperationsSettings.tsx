"use client";

/**
 * Settings that make the app usable for any company, not just the first one:
 *  - SetupChecklist: what a new company still has to do
 *  - TravelSettings: headquarters and remote-site rule for travel times
 *  - SystemStatus:   file storage usage; server state for SUPER_ADMIN
 */
import Link from 'next/link';
import React, { useState } from 'react';
import {
  CheckCircle2, Circle, Crosshair, HardDrive, Loader2, MapPinned,
  RefreshCw, Route, Server, TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, Section } from '@/components/settings/SettingsSection';
import { useToast } from '@/hooks/use-toast';

export interface SettingsOverview {
  setup: {
    companyProfile: boolean;
    hqLocated: boolean;
    jobSites: number;
    sitesWithoutCoordinates: number;
    workers: number;
    publishedAssignments: number;
  };
  travel: {
    hqLat: number | null;
    hqLng: number | null;
    remoteThresholdKm: number;
    remoteBonusMinutes: number;
  };
  media: { files: number; bytes: number; inlineLegacy: number };
  platform: null | {
    storageDriver: string;
    migrations: null | { applied: number; latest: string | null; pending: string[] };
  };
}

export async function fetchOverview(): Promise<SettingsOverview | null> {
  const res = await fetch('/api/settings/overview');
  if (!res.ok) return null;
  return res.json();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ─── Setup checklist ──────────────────────────────────────────────────────────

export function SetupChecklist({ overview }: { overview: SettingsOverview }) {
  const { setup } = overview;
  const steps = [
    { done: setup.companyProfile, label: 'Firmendaten eintragen', detail: 'Name, Straße und Stadt unten unter „Firmenidentität“.', href: null },
    { done: setup.hqLocated, label: 'Firmensitz bestimmen', detail: 'Grundlage für alle Fahrzeiten zu den Objekten.', href: '#standort' },
    { done: setup.jobSites > 0, label: 'Objekte anlegen', detail: 'Manuell oder per Excel-Import.', href: '/jobs' },
    { done: setup.workers > 0, label: 'Mitarbeiter einladen', detail: 'Konten für Ihr Team anlegen.', href: '/team' },
    { done: setup.publishedAssignments > 0, label: 'Ersten Einsatzplan veröffentlichen', detail: 'Danach sehen die Mitarbeiter ihre Aufgaben in der App.', href: '/schedule' },
  ];
  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <Card className="rounded-3xl border-none shadow-md">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-black text-sm uppercase tracking-widest text-primary">Einrichtung</h2>
            <p className="text-xs text-muted-foreground mt-1">{doneCount} von {steps.length} Schritten erledigt</p>
          </div>
          <div className="h-2 w-40 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
        </div>
        <ol className="space-y-2">
          {steps.map(step => (
            <li key={step.label} className="flex items-start gap-3">
              {step.done
                ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <Circle className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                {step.href && !step.done ? (
                  <Link href={step.href} className="text-sm font-bold text-primary hover:underline">{step.label}</Link>
                ) : (
                  <span className={`text-sm font-bold ${step.done ? 'text-muted-foreground line-through' : ''}`}>{step.label}</span>
                )}
                {!step.done && <p className="text-xs text-muted-foreground">{step.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ─── Travel settings ──────────────────────────────────────────────────────────

export interface TravelForm {
  remoteThresholdKm: string;
  remoteBonusMinutes: string;
}

export function TravelSettings({
  overview,
  form,
  onChange,
  canManage,
  hasUnsavedAddress,
  onLocated,
}: {
  overview: SettingsOverview;
  form: TravelForm;
  onChange: (form: TravelForm) => void;
  canManage: boolean;
  hasUnsavedAddress: boolean;
  onLocated: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | 'hq' | 'recalc' | 'missing'>(null);
  const { travel, setup } = overview;
  const hqSet = travel.hqLat != null && travel.hqLng != null;

  const locateHq = async () => {
    if (hasUnsavedAddress) {
      toast({ title: 'Bitte zuerst speichern', description: 'Die geänderte Adresse muss gespeichert sein, bevor der Firmensitz bestimmt wird.' });
      return;
    }
    setBusy('hq');
    try {
      const res = await fetch('/api/settings/hq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      toast({ title: 'Firmensitz bestimmt', description: data.label ?? `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}` });
      onLocated();
    } catch (e: any) {
      toast({ title: 'Firmensitz nicht gefunden', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const runGeocode = async (recalculate: boolean) => {
    setBusy(recalculate ? 'recalc' : 'missing');
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recalculate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      toast({
        title: recalculate ? 'Fahrzeiten aktualisiert' : 'Koordinaten ergänzt',
        description: data.message
          ?? (recalculate ? `${data.routed} Objekte neu berechnet.` : `${data.geocoded} Objekte gefunden, ${data.routed} Fahrzeiten berechnet.`),
      });
      onLocated();
    } catch (e: any) {
      toast({ title: 'Berechnung fehlgeschlagen', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="standort">
      <Section
        icon={MapPinned}
        title="Standort & Fahrzeiten"
        description="Vom Firmensitz aus berechnet die App Entfernung und Fahrzeit zu jedem Objekt. Objekte über der Fernobjekt-Grenze bekommen die Zusatzzeit gutgeschrieben."
      >
        <div className={`rounded-2xl border p-4 flex items-center justify-between gap-4 ${hqSet ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="min-w-0">
            <p className={`text-sm font-black ${hqSet ? 'text-emerald-800' : 'text-amber-800'}`}>
              {hqSet ? 'Firmensitz bestimmt' : 'Firmensitz noch nicht bestimmt'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hqSet
                ? `${travel.hqLat!.toFixed(5)}, ${travel.hqLng!.toFixed(5)}`
                : 'Ohne Firmensitz können keine Fahrzeiten berechnet werden.'}
            </p>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" className="font-black text-xs rounded-xl gap-2 h-10 shrink-0" onClick={locateHq} disabled={busy !== null}>
              {busy === 'hq' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
              {hqSet ? 'Neu bestimmen' : 'Aus Adresse bestimmen'}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Fernobjekt ab (km)" hint="0 = keine Fernobjekte">
            <Input
              type="number" min={0} max={2000} step={1}
              value={form.remoteThresholdKm}
              onChange={e => onChange({ ...form, remoteThresholdKm: e.target.value })}
              className="h-12 rounded-xl font-medium"
              disabled={!canManage}
            />
          </Field>
          <Field label="Zusatzzeit für Fernobjekte (Min.)" hint="Wird zur Fahrzeit addiert">
            <Input
              type="number" min={0} max={600} step={5}
              value={form.remoteBonusMinutes}
              onChange={e => onChange({ ...form, remoteBonusMinutes: e.target.value })}
              className="h-12 rounded-xl font-medium"
              disabled={!canManage}
            />
          </Field>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline" size="sm" className="font-black text-xs rounded-xl gap-2 h-10"
              onClick={() => runGeocode(true)} disabled={busy !== null || !hqSet || setup.jobSites === 0}
              title={hqSet ? undefined : 'Zuerst Firmensitz bestimmen'}
            >
              {busy === 'recalc' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Route className="w-3.5 h-3.5" />}
              Fahrzeiten aller Objekte neu berechnen
            </Button>
            {setup.sitesWithoutCoordinates > 0 && (
              <Button
                variant="outline" size="sm" className="font-black text-xs rounded-xl gap-2 h-10"
                onClick={() => runGeocode(false)} disabled={busy !== null}
              >
                {busy === 'missing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Fehlende Koordinaten ergänzen ({setup.sitesWithoutCoordinates})
              </Button>
            )}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70">
          Nach Änderung der Grenze oder Zusatzzeit erst speichern, dann neu berechnen. Die Berechnung dauert etwa eine Sekunde pro Objekt.
        </p>
      </Section>
    </div>
  );
}

// ─── Storage & system ─────────────────────────────────────────────────────────

export function SystemStatus({ overview }: { overview: SettingsOverview }) {
  const { media, platform } = overview;
  const pending = platform?.migrations?.pending ?? [];

  return (
    <Section
      icon={HardDrive}
      title="Speicher & System"
      description="Fotos und Sprachnotizen werden als Dateien gespeichert, nicht in der Datenbank."
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gray-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Dateien</p>
          <p className="text-2xl font-black mt-1">{media.files.toLocaleString('de-DE')}</p>
        </div>
        <div className="rounded-2xl bg-gray-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Belegter Speicher</p>
          <p className="text-2xl font-black mt-1">{formatBytes(media.bytes)}</p>
        </div>
      </div>

      {media.inlineLegacy > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900">
            {media.inlineLegacy.toLocaleString('de-DE')} ältere Fotos/Sprachnotizen liegen noch in der Datenbank.
            Der Server-Administrator kann sie mit <code className="font-mono">npm run media:migrate</code> verschieben.
          </p>
        </div>
      )}

      {platform && (
        <div className="rounded-2xl border border-gray-200 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" />
            <p className="text-xs font-black uppercase tracking-widest text-primary">Server (nur Super-Admin)</p>
          </div>
          <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-xs">
            <dt className="text-muted-foreground">Dateispeicher</dt>
            <dd className="font-bold">{platform.storageDriver === 's3' ? 'S3-kompatibler Speicher' : 'Lokale Festplatte'}</dd>
            <dt className="text-muted-foreground">Datenbank-Schema</dt>
            <dd className="font-bold">{platform.migrations?.latest ?? 'unbekannt'}</dd>
          </dl>
          {pending.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-xl p-2">
              Ausstehende Migrationen: {pending.join(', ')} — bitte <code className="font-mono">npm run db:migrate</code> ausführen.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
