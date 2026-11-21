'use client';

/**
 * Checkliste eines Einsatzes im Browser (wie in der App).
 *
 * Jede Leistung des Einsatzes: erledigt (optional mit Vorher/Nachher-Foto)
 * oder nicht möglich (mit Grund). Jeder Klick wird sofort gespeichert und
 * erscheint im Leistungsnachweis und im Kundenportal.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, CircleDashed, ClipboardCheck, Image as ImageIcon, Loader2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { compressImage } from '@/lib/image-compress';

type Status = 'started' | 'done' | 'not_possible';

interface Item {
  code: string;
  label: string;
  check: null | {
    status: Status;
    reason: string | null;
    before_url: string | null;
    after_url: string | null;
    employee_name?: string | null;
  };
}

export interface ChecklistProgress {
  total: number;
  finished: number;
  open: string[];
}

interface Props {
  assignmentId: string;
  /** Abhaken nur, wenn eingestempelt (Mitarbeiter) bzw. immer (Leitung). */
  canEdit: boolean;
  onProgress?: (progress: ChecklistProgress) => void;
}

const isFinished = (item: Item) => item.check?.status === 'done' || item.check?.status === 'not_possible';

export function ChecklistPanel({ assignmentId, canEdit, onProgress }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<Item | null>(null);
  const [reason, setReason] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<{ item: Item; kind: 'before' | 'after' } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks?assignmentId=${encodeURIComponent(assignmentId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setItems(data.items);
    } catch (e: any) {
      setItems([]);
      toast({ variant: 'destructive', title: 'Checkliste nicht geladen', description: e?.message });
    }
  }, [assignmentId, toast]);

  useEffect(() => { setItems(null); load(); }, [load]);

  useEffect(() => {
    if (!items || !onProgress) return;
    onProgress({
      total: items.length,
      finished: items.filter(isFinished).length,
      open: items.filter(i => !isFinished(i)).map(i => i.label),
    });
  }, [items, onProgress]);

  const send = async (item: Item, body: Record<string, unknown>) => {
    setBusy(item.code);
    try {
      const res = await fetch('/api/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId, serviceCode: item.code, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Fehler (HTTP ${res.status})`);
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Nicht gespeichert', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const pickPhoto = (item: Item, kind: 'before' | 'after') => {
    photoTarget.current = { item, kind };
    fileInput.current?.click();
  };

  const onPhoto = async (file: File | undefined) => {
    const target = photoTarget.current;
    if (fileInput.current) fileInput.current.value = '';
    if (!file || !target) return;
    try {
      const photo = await compressImage(file);
      // Vorher-Foto allein heißt "begonnen"; das Nachher-Foto schließt die Leistung ab.
      await send(target.item, target.kind === 'before'
        ? { status: target.item.check?.status === 'done' ? 'done' : 'started', beforePhoto: photo }
        : { status: 'done', afterPhoto: photo });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Foto nicht lesbar', description: e?.message });
    }
  };

  const submitReason = async () => {
    if (!reasonFor || reason.trim().length < 3) return;
    const item = reasonFor;
    setReasonFor(null);
    await send(item, { status: 'not_possible', reason: reason.trim() });
    setReason('');
  };

  if (items === null) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (items.length === 0) return null;

  const finished = items.filter(isFinished).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
          <ClipboardCheck className="w-3.5 h-3.5" /> Checkliste – Leistungsnachweis
        </p>
        <span className={`text-xs font-black rounded-full px-2.5 py-0.5 ${finished === items.length ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
          {finished}/{items.length}
        </span>
      </div>
      {!canEdit && (
        <p className="text-xs text-muted-foreground">Zum Abhaken bitte zuerst einstempeln.</p>
      )}
      <ul className="space-y-2">
        {items.map(item => {
          const status = item.check?.status;
          const loading = busy === item.code;
          return (
            <li
              key={item.code}
              className={`rounded-2xl border p-3 transition ${status === 'done' ? 'bg-emerald-50 border-emerald-200' : status === 'not_possible' ? 'bg-red-50 border-red-200' : 'bg-white'}`}
            >
              <div className="flex items-center gap-3">
                {status === 'done'
                  ? <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                  : status === 'not_possible'
                    ? <X className="w-5 h-5 text-red-600 shrink-0" />
                    : <CircleDashed className="w-5 h-5 text-gray-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {status === 'done' ? 'erledigt' : status === 'not_possible' ? `nicht möglich: ${item.check?.reason}` : status === 'started' ? 'begonnen (Vorher-Foto)' : 'offen'}
                    {item.check?.employee_name ? ` · ${item.check.employee_name}` : ''}
                  </p>
                  {(item.check?.before_url || item.check?.after_url) && (
                    <div className="flex gap-3 mt-1">
                      {item.check?.before_url && (
                        <a href={item.check.before_url} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-primary hover:underline inline-flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" /> vorher
                        </a>
                      )}
                      {item.check?.after_url && (
                        <a href={item.check.after_url} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-primary hover:underline inline-flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" /> nachher
                        </a>
                      )}
                    </div>
                  )}
                </div>
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                ) : canEdit && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {status === 'done' || status === 'not_possible' ? (
                      <Button size="sm" variant="ghost" className="h-9 rounded-xl text-xs font-bold" onClick={() => send(item, { status: 'open' })} title="Zurücksetzen">
                        <Undo2 className="w-4 h-4" />
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="h-9 rounded-xl text-xs font-bold gap-1" onClick={() => pickPhoto(item, 'before')} title="Vorher-Foto">
                          <Camera className="w-4 h-4" /> vorher
                        </Button>
                        <Button size="sm" variant="outline" className="h-9 rounded-xl text-xs font-bold gap-1" onClick={() => pickPhoto(item, 'after')} title="Nachher-Foto und erledigt">
                          <Camera className="w-4 h-4" /> nachher
                        </Button>
                        <Button size="sm" variant="outline" className="h-9 w-9 p-0 rounded-xl border-red-200 text-red-600 hover:bg-red-50" onClick={() => { setReason(''); setReasonFor(item); }} title="Nicht möglich">
                          <X className="w-4 h-4" />
                        </Button>
                        <Button size="sm" className="h-9 w-9 p-0 rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={() => send(item, { status: 'done' })} title="Erledigt">
                          <Check className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />

      <Dialog open={!!reasonFor} onOpenChange={open => { if (!open) setReasonFor(null); }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-black">Nicht möglich: {reasonFor?.label}</DialogTitle>
            <DialogDescription>Der Grund erscheint im Leistungsnachweis für die Hausverwaltung.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitReason(); }}
            placeholder="z. B. Zufahrt zugeparkt"
            className="h-11"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)}>Abbrechen</Button>
            <Button onClick={submitReason} disabled={reason.trim().length < 3} className="font-bold">Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
