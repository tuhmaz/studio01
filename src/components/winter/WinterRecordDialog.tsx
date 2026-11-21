'use client';

/**
 * Winterdienst-Einsatz im Browser erfassen.
 *
 * - Mitarbeiter (z. B. in der Zeiterfassung): Zeitpunkt = jetzt, GPS des Geräts, wenn erlaubt.
 * - Büro (winter.manage) auf der Winterdienst-Seite: Nachtrag für einen Mitarbeiter
 *   bis 72 Stunden rückwirkend; dann ohne GPS (die Büro-Position wäre kein Nachweis).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Camera, Loader2, Snowflake, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITIES, MATERIALS, NEEDS_MATERIAL, type Activity, type Material } from '@/lib/winter-labels';

export interface RecordSite {
  id: string;
  name: string;
  winter_areas: string[];
}

interface Employee { id: string; name: string }

interface Props {
  site: RecordSite;
  /** Büro-Modus: Mitarbeiter wählen, Zeitpunkt nachtragen. */
  backOffice?: boolean;
  /** Vorauswahl im Büro-Modus (z. B. die Zugeteilten der Aufgabe). */
  defaultEmployeeName?: string;
  /** Vorauswahl des Tages (YYYY-MM-DD) im Büro-Modus. */
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}

const MAX_BACKDATE_H = 72;

function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<InstanceType<typeof window.Image>>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      el.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (typeof window === 'undefined' || !window.navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    window.navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function WinterRecordDialog({ site, backOffice = false, defaultEmployeeName, defaultDate, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [activity, setActivity] = useState<Activity>('clearing_gritting');
  const [material, setMaterial] = useState<Material>('salt');
  const [amount, setAmount] = useState('');
  const [areas, setAreas] = useState<string[]>(site.winter_areas);
  const [extraArea, setExtraArea] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState('');
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [performedAt, setPerformedAt] = useState(() => {
    const now = new Date();
    if (defaultDate && defaultDate < toLocalInput(now).slice(0, 10)) return `${defaultDate}T07:00`;
    return toLocalInput(now);
  });
  const needsMaterial = NEEDS_MATERIAL.includes(activity);
  const limits = useMemo(() => {
    const now = new Date();
    return { min: toLocalInput(new Date(now.getTime() - MAX_BACKDATE_H * 3_600_000)), max: toLocalInput(now) };
  }, []);

  useEffect(() => {
    if (!backOffice) return;
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'query', table: 'users', select: 'id,name,role', orderBy: { column: 'name' } }),
    })
      .then(r => r.json())
      .then(({ data }) => {
        const list: Employee[] = (data ?? []).map((u: Employee) => ({ id: u.id, name: u.name }));
        setEmployees(list);
        const preset = defaultEmployeeName ? list.find(e => e.name === defaultEmployeeName) : undefined;
        if (preset) setEmployeeId(preset.id);
      })
      .catch(() => setEmployees([]));
  }, [backOffice, defaultEmployeeName]);

  const toggleArea = (area: string) =>
    setAreas(prev => (prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]));

  const addArea = () => {
    const value = extraArea.trim();
    if (value && !areas.includes(value)) setAreas([...areas, value]);
    setExtraArea('');
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Foto nicht lesbar', description: e?.message });
    }
  };

  const save = async () => {
    if (backOffice && !employeeId) {
      toast({ variant: 'destructive', title: 'Bitte den Mitarbeiter wählen, der den Einsatz gemacht hat.' });
      return;
    }
    const parsedAmount = amount.trim() ? Number(amount.replace(',', '.')) : null;
    if (parsedAmount != null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      toast({ variant: 'destructive', title: 'Streumenge: bitte eine Zahl in kg eingeben.' });
      return;
    }
    setSaving(true);
    try {
      const position = backOffice ? null : await currentPosition();
      const res = await fetch('/api/winter/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: window.crypto.randomUUID(),
          siteId: site.id,
          activity,
          gritMaterial: needsMaterial ? material : null,
          gritAmountKg: needsMaterial ? parsedAmount : null,
          areas,
          notes: notes.trim() || null,
          performedAt: backOffice ? new Date(performedAt).toISOString() : new Date().toISOString(),
          employeeId: backOffice ? employeeId : undefined,
          lat: position?.lat ?? null,
          lng: position?.lng ?? null,
          gpsAccuracyM: position?.accuracy ?? null,
          photo: photo || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Fehler (HTTP ${res.status})`);
      toast({ title: 'Im Streuprotokoll gespeichert', description: `${site.name} · ${ACTIVITIES[activity]}` });
      onSaved();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Nicht gespeichert', description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2"><Snowflake className="w-6 h-6 text-primary" /> Winterdienst erfassen</DialogTitle>
          <DialogDescription>
            {site.name}
            {backOffice ? ' · Nachtrag durch das Büro (ohne GPS, max. 72 Stunden zurück)' : ' · Zeitpunkt und Standort werden jetzt erfasst'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {backOffice && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Mitarbeiter *</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Wer war im Einsatz?" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Zeitpunkt *</Label>
                <Input type="datetime-local" value={performedAt} min={limits.min} max={limits.max} onChange={e => setPerformedAt(e.target.value)} className="h-11" />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Tätigkeit</Label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ACTIVITIES) as Activity[]).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActivity(a)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-bold text-left transition ${activity === a ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  {ACTIVITIES[a]}
                </button>
              ))}
            </div>
          </div>

          {needsMaterial && (
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <div className="space-y-1.5">
                <Label>Streumittel</Label>
                <Select value={material} onValueChange={v => setMaterial(v as Material)}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(MATERIALS) as Material[]).map(m => <SelectItem key={m} value={m}>{MATERIALS[m]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Menge (kg)</Label>
                <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="optional" className="h-11" />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Flächen</Label>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set([...site.winter_areas, ...areas])).map(area => (
                <button
                  key={area}
                  type="button"
                  onClick={() => toggleArea(area)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition ${areas.includes(area) ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                >
                  {area}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={extraArea} onChange={e => setExtraArea(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } }} placeholder="Weitere Fläche" className="h-9" />
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={addArea}>Hinzufügen</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Bemerkung</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="z. B. Glätte an der Rampe, nachgestreut" className="min-h-[64px]" />
          </div>

          <div className="space-y-1.5">
            <Label>Foto (empfohlen)</Label>
            {photo ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="Foto zum Einsatz" className="rounded-xl max-h-44 w-full object-cover" />
                <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8" onClick={() => setPhoto('')} aria-label="Foto entfernen"><X className="w-4 h-4" /></Button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 h-16 rounded-xl border-2 border-dashed text-sm font-bold text-muted-foreground cursor-pointer hover:bg-muted/50">
                <Camera className="w-5 h-5" /> Foto aufnehmen oder auswählen
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => pickPhoto(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save} disabled={saving} className="font-black">
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Im Protokoll speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
