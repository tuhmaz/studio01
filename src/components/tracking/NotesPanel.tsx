'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import NextImage from 'next/image';
import {
  FileText, Mic, MicOff, Camera, Send, Download, Trash2,
  Image as ImageIcon, Volume2, ZoomIn, X, Loader2,
  FolderOpen, Filter, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NoteEntry {
  id: string;
  type: 'text' | 'voice' | 'photo';
  content: string;
  authorName: string;
  authorId: string;
  createdAt: string;
  duration?: number;
  jobSiteId?: string;
  jobAssignmentId?: string;
}

interface NotesPanelProps {
  assignmentId: string | null;
  siteId: string | null;
  siteName?: string;
  companyId: string;
  userId: string;
  userName: string;
  /** Whether the current user has an active clock-in (can add notes) */
  canAddNotes: boolean;
  /** Admin/Leader — can see ALL workers' notes */
  isAdmin: boolean;
  timeEntryId?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  downloadDataUrl(URL.createObjectURL(blob), filename);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NotesPanel({
  assignmentId, siteId, siteName, companyId,
  userId, userName, canAddNotes, isAdmin, timeEntryId,
}: NotesPanelProps) {
  const { toast } = useToast();

  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  // Text note
  const [textNote, setTextNote] = useState('');
  const [isSavingText, setIsSavingText] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Photo lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Photo input
  const photoInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch notes ─────────────────────────────────────────────────────────────

  const fetchNotes = useCallback(async () => {
    if (!assignmentId && !siteId) return;
    setIsLoading(true);
    try {
      const filters: Record<string, string> = { company_id: companyId };
      if (assignmentId) filters.job_assignment_id = assignmentId;
      else if (siteId) filters.job_site_id = siteId;
      if (!isAdmin) filters.employee_id = userId;

      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          table: 'work_log_entries',
          filters,
          orderBy: { column: 'created_at', ascending: false },
        }),
      });
      const json = await res.json();
      setNotes((json.data ?? []).map((r: any) => ({
        id:              r.id,
        type:            r.type,
        content:         r.content,
        authorName:      r.author_name,
        authorId:        r.employee_id,
        createdAt:       r.created_at,
        duration:        r.duration ?? undefined,
        jobSiteId:       r.job_site_id,
        jobAssignmentId: r.job_assignment_id,
      })));
    } finally {
      setIsLoading(false);
    }
  }, [assignmentId, siteId, companyId, isAdmin, userId]);

  useEffect(() => { void fetchNotes(); }, [fetchNotes]);

  // Recording ticker
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

  // ── Save note ────────────────────────────────────────────────────────────────

  const saveNote = async (type: 'text' | 'voice' | 'photo', content: string, duration?: number) => {
    if (!timeEntryId) throw new Error('Kein aktiver Zeiteintrag');
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'insert',
        table: 'work_log_entries',
        data: {
          id:                `note-${crypto.randomUUID()}`,
          company_id:        companyId,
          time_entry_id:     timeEntryId,
          employee_id:       userId,
          type,
          content,
          author_name:       userName,
          duration:          duration ?? null,
          job_site_id:       siteId,
          job_assignment_id: assignmentId,
        },
      }),
    });
    if (!res.ok) { const j = await res.json(); throw new Error(j?.error ?? 'Fehler'); }
    void fetchNotes();
  };

  // ── Text note ────────────────────────────────────────────────────────────────

  const handleSaveText = async () => {
    if (!textNote.trim()) return;
    setIsSavingText(true);
    try {
      await saveNote('text', textNote.trim());
      setTextNote('');
      setShowTextInput(false);
      toast({ title: 'Notiz gespeichert' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: e.message });
    } finally {
      setIsSavingText(false);
    }
  };

  // ── Audio ────────────────────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const fr = new FileReader();
        const secs = recordingSeconds;
        fr.onloadend = async () => {
          try {
            await saveNote('voice', fr.result as string, secs);
            toast({ title: 'Sprachnotiz gespeichert' });
          } catch (e: any) {
            toast({ variant: 'destructive', title: 'Fehler', description: e.message });
          }
        };
        fr.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
    } catch {
      toast({ variant: 'destructive', title: 'Mikrofon nicht verfügbar' });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  // ── Photo ────────────────────────────────────────────────────────────────────

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onloadend = () => {
      const img = new window.Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const maxPx = 1200;
        const ratio = Math.min(maxPx / img.width, maxPx / img.height, 1);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.78);
        try {
          await saveNote('photo', compressed);
          toast({ title: 'Foto gespeichert' });
        } catch (e: any) {
          toast({ variant: 'destructive', title: 'Fehler', description: e.message });
        }
      };
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Download all ─────────────────────────────────────────────────────────────

  const handleDownloadAll = () => {
    const photos = notes.filter(n => n.type === 'photo');
    const audios = notes.filter(n => n.type === 'voice');
    const texts  = notes.filter(n => n.type === 'text');

    photos.forEach((n, i) => {
      setTimeout(() => downloadDataUrl(n.content, `foto_${i + 1}_${n.authorName}.jpg`), i * 200);
    });
    audios.forEach((n, i) => {
      setTimeout(() => downloadDataUrl(n.content, `sprach_${i + 1}_${n.authorName}.webm`), (photos.length + i) * 200);
    });
    if (texts.length) {
      const combined = texts.map(n =>
        `[${new Date(n.createdAt).toLocaleString('de-DE')}] ${n.authorName}:\n${n.content}`
      ).join('\n\n---\n\n');
      setTimeout(() => downloadText(combined, `notizen_${siteName ?? siteId}.txt`), (photos.length + audios.length) * 200);
    }
    toast({ title: `${notes.length} Dateien werden heruntergeladen` });
  };

  // ── Filtered lists ────────────────────────────────────────────────────────────

  const photos = notes.filter(n => n.type === 'photo');
  const audios = notes.filter(n => n.type === 'voice');
  const texts  = notes.filter(n => n.type === 'text');
  const filtered = activeTab === 'photo' ? photos : activeTab === 'voice' ? audios : activeTab === 'text' ? texts : notes;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-primary" />
          <p className="text-[11px] font-black uppercase tracking-widest text-primary">
            Berichte & Medien
          </p>
          {notes.length > 0 && (
            <Badge className="bg-primary/10 text-primary border-none font-black text-[9px]">
              {notes.length}
            </Badge>
          )}
        </div>
        {notes.length > 0 && isAdmin && (
          <Button size="sm" variant="outline" onClick={handleDownloadAll}
            className="h-8 text-xs font-black border-primary/20 hover:bg-primary/5">
            <Download className="w-3 h-3 mr-1.5" /> Alle herunterladen
          </Button>
        )}
      </div>

      {/* ── Add note buttons (when clocked in) ── */}
      {canAddNotes && (
        <div className="grid grid-cols-3 gap-3">
          {/* Photo */}
          <button
            onClick={() => photoInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2.5 h-24 rounded-2xl bg-white border-2 border-dashed border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 transition-all group shadow-sm"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
              <Camera className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Foto</span>
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />

          {/* Audio */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`flex flex-col items-center justify-center gap-2.5 h-24 rounded-2xl border-2 border-dashed transition-all group shadow-sm
              ${isRecording
                ? 'bg-red-50 border-red-400 animate-pulse'
                : 'bg-white border-blue-200 hover:border-blue-400 hover:bg-blue-50'}`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors
              ${isRecording ? 'bg-red-100' : 'bg-blue-50 group-hover:bg-blue-100'}`}>
              {isRecording
                ? <MicOff className="w-5 h-5 text-red-600" />
                : <Mic className="w-5 h-5 text-blue-600" />}
            </div>
            <span className={`text-[9px] font-black uppercase tracking-widest ${isRecording ? 'text-red-700' : 'text-blue-700'}`}>
              {isRecording ? formatDuration(recordingSeconds) : 'Sprachnotiz'}
            </span>
          </button>

          {/* Text */}
          <button
            onClick={() => setShowTextInput(v => !v)}
            className={`flex flex-col items-center justify-center gap-2.5 h-24 rounded-2xl border-2 border-dashed transition-all group shadow-sm
              ${showTextInput ? 'bg-violet-50 border-violet-400' : 'bg-white border-violet-200 hover:border-violet-400 hover:bg-violet-50'}`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors
              ${showTextInput ? 'bg-violet-100' : 'bg-violet-50 group-hover:bg-violet-100'}`}>
              <FileText className="w-5 h-5 text-violet-600" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-violet-700">Textnotiz</span>
          </button>
        </div>
      )}

      {/* ── Text input ── */}
      {showTextInput && canAddNotes && (
        <div className="bg-violet-50 rounded-2xl p-4 space-y-3 border border-violet-100">
          <Textarea
            autoFocus
            value={textNote}
            onChange={e => setTextNote(e.target.value)}
            placeholder="Notiz eingeben…"
            className="min-h-[100px] bg-white border-violet-200 focus:border-violet-400 rounded-xl resize-none font-medium text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveText} disabled={isSavingText || !textNote.trim()}
              className="font-black bg-violet-600 hover:bg-violet-700 h-9 rounded-xl flex-1">
              {isSavingText ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-3.5 h-3.5 mr-1.5" />Speichern</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowTextInput(false); setTextNote(''); }}
              className="font-black h-9 rounded-xl text-muted-foreground">
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {/* ── Notes list ── */}
      {isLoading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-8 h-8 text-primary/40 animate-spin" />
        </div>
      ) : notes.length > 0 ? (
        <div className="space-y-3">
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-muted/40 h-10 p-1 rounded-xl">
              <TabsTrigger value="all"   className="rounded-lg text-[10px] font-black uppercase h-8 px-3">Alle ({notes.length})</TabsTrigger>
              <TabsTrigger value="photo" className="rounded-lg text-[10px] font-black uppercase h-8 px-3">Fotos ({photos.length})</TabsTrigger>
              <TabsTrigger value="voice" className="rounded-lg text-[10px] font-black uppercase h-8 px-3">Audio ({audios.length})</TabsTrigger>
              <TabsTrigger value="text"  className="rounded-lg text-[10px] font-black uppercase h-8 px-3">Text ({texts.length})</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Photo grid */}
          {(activeTab === 'all' || activeTab === 'photo') && photos.length > 0 && (
            <div className="space-y-2">
              {activeTab === 'all' && (
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <ImageIcon className="w-3 h-3" /> Fotos
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {photos.map(note => (
                  <div key={note.id} className="relative group rounded-xl overflow-hidden aspect-[4/3] bg-gray-100 shadow-sm">
                    <NextImage
                      src={note.content} alt="Foto"
                      fill unoptimized
                      className="object-cover transition-transform group-hover:scale-105"
                    />
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button onClick={() => setLightboxSrc(note.content)}
                        className="w-9 h-9 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors shadow-lg">
                        <ZoomIn className="w-4 h-4 text-foreground" />
                      </button>
                      <button onClick={() => downloadDataUrl(note.content, `foto_${note.authorName}_${new Date(note.createdAt).toISOString().slice(0,10)}.jpg`)}
                        className="w-9 h-9 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors shadow-lg">
                        <Download className="w-4 h-4 text-foreground" />
                      </button>
                    </div>
                    {/* Meta */}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                      <p className="text-[9px] text-white font-black">{note.authorName}</p>
                      <p className="text-[8px] text-white/70">{new Date(note.createdAt).toLocaleString('de-DE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audio list */}
          {(activeTab === 'all' || activeTab === 'voice') && audios.length > 0 && (
            <div className="space-y-2">
              {activeTab === 'all' && (
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <Volume2 className="w-3 h-3" /> Sprachnotizen
                </p>
              )}
              {audios.map(note => (
                <div key={note.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
                        <Volume2 className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-foreground">{note.authorName}</p>
                        <p className="text-[9px] text-muted-foreground">
                          {new Date(note.createdAt).toLocaleString('de-DE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                          {note.duration && ` · ${formatDuration(note.duration)}`}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => downloadDataUrl(note.content, `sprach_${note.authorName}_${new Date(note.createdAt).toISOString().slice(0,10)}.webm`)}
                      className="w-8 h-8 bg-gray-50 hover:bg-primary/5 rounded-xl flex items-center justify-center transition-colors">
                      <Download className="w-3.5 h-3.5 text-primary" />
                    </button>
                  </div>
                  <audio controls src={note.content} className="w-full h-10 rounded-xl" />
                </div>
              ))}
            </div>
          )}

          {/* Text list */}
          {(activeTab === 'all' || activeTab === 'text') && texts.length > 0 && (
            <div className="space-y-2">
              {activeTab === 'all' && (
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <FileText className="w-3 h-3" /> Textnotizen
                </p>
              )}
              {texts.map(note => (
                <div key={note.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center">
                        <FileText className="w-4 h-4 text-violet-600" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-foreground">{note.authorName}</p>
                        <p className="text-[9px] text-muted-foreground">
                          {new Date(note.createdAt).toLocaleString('de-DE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => downloadText(note.content, `notiz_${note.authorName}.txt`)}
                      className="w-8 h-8 bg-gray-50 hover:bg-primary/5 rounded-xl flex items-center justify-center transition-colors">
                      <Download className="w-3.5 h-3.5 text-primary" />
                    </button>
                  </div>
                  <p className="text-sm font-medium text-foreground leading-relaxed bg-gray-50/60 rounded-xl px-3 py-2.5">
                    {note.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Empty tab state */}
          {filtered.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground font-bold">
              Keine Einträge in dieser Kategorie
            </div>
          )}
        </div>
      ) : (
        !canAddNotes && (
          <div className="py-8 text-center text-xs text-muted-foreground font-bold">
            Noch keine Berichte für diesen Einsatz
          </div>
        )
      )}

      {/* ── Lightbox ── */}
      <Dialog open={!!lightboxSrc} onOpenChange={() => setLightboxSrc(null)}>
        <DialogContent aria-describedby="notes-lightbox-description" className="max-w-4xl p-0 border-none bg-black/90 rounded-2xl overflow-hidden">
          <DialogTitle className="sr-only">Bildvorschau</DialogTitle>
          <DialogDescription id="notes-lightbox-description" className="sr-only">Vollbildansicht des ausgewählten Mediums</DialogDescription>
          <button onClick={() => setLightboxSrc(null)}
            className="absolute top-3 right-3 z-10 w-9 h-9 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
          {lightboxSrc && (
            <>
              <div className="relative w-full" style={{ aspectRatio: '16/10' }}>
                <NextImage src={lightboxSrc} alt="Vollbild" fill unoptimized className="object-contain" />
              </div>
              <div className="flex justify-center p-4">
                <Button onClick={() => downloadDataUrl(lightboxSrc, 'foto.jpg')}
                  variant="outline" size="sm" className="font-black text-white border-white/20 bg-white/10 hover:bg-white/20 rounded-xl">
                  <Download className="w-4 h-4 mr-2" /> Herunterladen
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
