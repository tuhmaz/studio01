'use client';

import React, { useState, useEffect, useCallback } from 'react';
import NextImage from 'next/image';
import {
  MapPin, Image as ImageIcon, Volume2, FileText, Download,
  ZoomIn, X, Loader2, FolderOpen, Calendar, ChevronDown,
  Search, Filter, Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Site {
  id: string;
  name: string;
  address: string;
  city: string;
  routeCode?: string;
}

interface MediaEntry {
  id: string;
  type: 'photo' | 'voice' | 'text';
  content: string;
  authorName: string;
  createdAt: string;
  duration?: number;
  jobAssignmentId?: string;
  scheduledDate?: string;
}

interface SiteMediaBrowserProps {
  companyId: string;
  sites: Site[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = [
  { value: '01', label: 'Januar' }, { value: '02', label: 'Februar' },
  { value: '03', label: 'März' },   { value: '04', label: 'April' },
  { value: '05', label: 'Mai' },    { value: '06', label: 'Juni' },
  { value: '07', label: 'Juli' },   { value: '08', label: 'August' },
  { value: '09', label: 'September' }, { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' }, { value: '12', label: 'Dezember' },
];

function currentYM() {
  const d = new Date();
  return { y: String(d.getFullYear()), m: String(d.getMonth() + 1).padStart(2, '0') };
}

function downloadDataUrl(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
}

function downloadText(text: string, name: string) {
  downloadDataUrl(URL.createObjectURL(new Blob([text], { type: 'text/plain' })), name);
}

function formatDur(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SiteMediaBrowser({ companyId, sites }: SiteMediaBrowserProps) {
  const { y, m } = currentYM();
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [year, setYear]   = useState(y);
  const [month, setMonth] = useState(m);
  const [search, setSearch]   = useState('');
  const [typeTab, setTypeTab] = useState<'all' | 'photo' | 'voice' | 'text'>('all');

  const [entries, setEntries]     = useState<MediaEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lightbox, setLightbox]   = useState<string | null>(null);

  const selectedSite = sites.find(s => s.id === selectedSiteId);

  // ── Fetch media for the selected site + month ────────────────────────────────

  const fetchMedia = useCallback(async () => {
    if (!selectedSiteId || !companyId) return;
    setIsLoading(true);
    setEntries([]);
    try {
      const monthStart = `${year}-${month}-01`;
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      const monthEnd = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      // Fetch work_log_entries for this site in the date range
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query_range',
          table: 'work_log_entries',
          filters: { company_id: companyId, job_site_id: selectedSiteId },
          rangeFilters: [{ column: 'created_at', gte: monthStart, lte: monthEnd + 'T23:59:59Z' }],
          orderBy: { column: 'created_at', ascending: false },
        }),
      });
      const json = await res.json();

      // Also fetch job_assignments for this site in the range to get scheduled_date
      const assignRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query_range',
          table: 'job_assignments',
          filters: { company_id: companyId, job_site_id: selectedSiteId },
          rangeFilters: [{ column: 'scheduled_date', gte: monthStart, lte: monthEnd }],
          select: 'id, scheduled_date',
        }),
      });
      const assignJson = await assignRes.json();
      const assignMap: Record<string, string> = {};
      for (const a of assignJson.data ?? []) assignMap[a.id] = a.scheduled_date;

      setEntries((json.data ?? []).map((r: any) => ({
        id:              r.id,
        type:            r.type,
        content:         r.content,
        authorName:      r.author_name,
        createdAt:       r.created_at,
        duration:        r.duration ?? undefined,
        jobAssignmentId: r.job_assignment_id,
        scheduledDate:   r.job_assignment_id ? assignMap[r.job_assignment_id] : undefined,
      })));
    } finally {
      setIsLoading(false);
    }
  }, [selectedSiteId, companyId, year, month]);

  useEffect(() => { void fetchMedia(); }, [fetchMedia]);

  // ── Filter ───────────────────────────────────────────────────────────────────

  const filtered = entries.filter(e => {
    if (typeTab !== 'all' && e.type !== typeTab) return false;
    if (search && !e.authorName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const photos = filtered.filter(e => e.type === 'photo');
  const audios = filtered.filter(e => e.type === 'voice');
  const texts  = filtered.filter(e => e.type === 'text');

  // ── Group by date ─────────────────────────────────────────────────────────────

  const grouped = React.useMemo(() => {
    const map: Record<string, MediaEntry[]> = {};
    for (const e of filtered) {
      const d = e.scheduledDate ?? e.createdAt.slice(0, 10);
      if (!map[d]) map[d] = [];
      map[d].push(e);
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  // ── Download all ─────────────────────────────────────────────────────────────

  const handleDownloadAll = () => {
    let delay = 0;
    const sitSlug = selectedSite?.name.slice(0, 20).replace(/\s+/g, '_') ?? 'site';
    for (const e of filtered) {
      if (e.type === 'photo') {
        setTimeout(() => downloadDataUrl(e.content, `foto_${sitSlug}_${e.createdAt.slice(0, 10)}_${e.authorName}.jpg`), delay);
        delay += 200;
      } else if (e.type === 'voice') {
        setTimeout(() => downloadDataUrl(e.content, `audio_${sitSlug}_${e.createdAt.slice(0, 10)}_${e.authorName}.webm`), delay);
        delay += 200;
      }
    }
    if (texts.length) {
      const txt = texts.map(e => `[${new Date(e.createdAt).toLocaleString('de-DE')}] ${e.authorName}:\n${e.content}`).join('\n\n---\n\n');
      setTimeout(() => downloadText(txt, `notizen_${sitSlug}_${year}-${month}.txt`), delay);
    }
  };

  // ── Years list ────────────────────────────────────────────────────────────────

  const years = Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() - i));

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full min-h-[600px]">

      {/* ── Left panel: Site selector + filters ── */}
      <div className="lg:w-72 shrink-0 space-y-4">

        {/* Site search + select */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-3 h-3" /> Standort auswählen
          </p>
          <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
            <SelectTrigger className="h-11 rounded-xl border-primary/20 font-medium text-sm">
              <SelectValue placeholder="Standort wählen…" />
            </SelectTrigger>
            <SelectContent>
              {sites.map(s => (
                <SelectItem key={s.id} value={s.id} className="text-sm">
                  <span className="font-black text-primary mr-2">{s.routeCode ?? s.id}</span>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Month / Year */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Calendar className="w-3 h-3" /> Zeitraum
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-10 rounded-xl border-primary/20 text-xs font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map(mo => (
                  <SelectItem key={mo.value} value={mo.value} className="text-xs">{mo.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-10 rounded-xl border-primary/20 text-xs font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map(yr => (
                  <SelectItem key={yr} value={yr} className="text-xs">{yr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Worker filter */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Filter className="w-3 h-3" /> Mitarbeiter
          </p>
          <Input
            placeholder="Name suchen…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 rounded-xl border-primary/20 text-sm"
          />
        </div>

        {/* Stats summary */}
        {selectedSiteId && !isLoading && entries.length > 0 && (
          <div className="bg-primary/5 rounded-2xl p-4 space-y-3 border border-primary/10">
            <p className="text-[10px] font-black uppercase tracking-widest text-primary">Übersicht</p>
            <div className="space-y-2">
              {[
                { icon: ImageIcon, label: 'Fotos',        count: entries.filter(e=>e.type==='photo').length, color: 'text-emerald-600' },
                { icon: Volume2,   label: 'Sprachnotizen', count: entries.filter(e=>e.type==='voice').length, color: 'text-blue-600' },
                { icon: FileText,  label: 'Textnotizen',  count: entries.filter(e=>e.type==='text').length,  color: 'text-violet-600' },
              ].map(({ icon: Icon, label, count, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                    <span className="text-xs font-bold text-muted-foreground">{label}</span>
                  </div>
                  <Badge className="bg-white border border-gray-100 text-foreground font-black text-[10px]">{count}</Badge>
                </div>
              ))}
            </div>
            <Button size="sm" className="w-full h-9 rounded-xl font-black text-xs" onClick={handleDownloadAll}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Alle herunterladen
            </Button>
          </div>
        )}
      </div>

      {/* ── Right panel: Media content ── */}
      <div className="flex-1 min-w-0 space-y-4">

        {!selectedSiteId ? (
          <div className="h-full min-h-[400px] flex flex-col items-center justify-center gap-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center">
              <FolderOpen className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <p className="font-black text-foreground/60 uppercase text-sm">Standort auswählen</p>
              <p className="text-xs text-muted-foreground mt-1">Wählen Sie links einen Standort, um Berichte anzuzeigen</p>
            </div>
          </div>

        ) : isLoading ? (
          <div className="h-full min-h-[400px] flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-primary/40 animate-spin" />
              <p className="text-xs font-black text-muted-foreground uppercase">Lade Berichte…</p>
            </div>
          </div>

        ) : entries.length === 0 ? (
          <div className="h-full min-h-[400px] flex flex-col items-center justify-center gap-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
            <Package className="w-12 h-12 text-muted-foreground/30" />
            <div className="text-center">
              <p className="font-black text-foreground/60 uppercase text-sm">Keine Berichte</p>
              <p className="text-xs text-muted-foreground mt-1">
                Für {selectedSite?.name} wurden im {MONTHS.find(mo=>mo.value===month)?.label} {year} keine Medien erfasst.
              </p>
            </div>
          </div>

        ) : (
          <div className="space-y-4">
            {/* Type filter tabs */}
            <div className="flex items-center justify-between gap-3">
              <Tabs value={typeTab} onValueChange={v => setTypeTab(v as any)}>
                <TabsList className="h-9 bg-muted/40 p-1 rounded-xl">
                  <TabsTrigger value="all"   className="h-7 px-3 rounded-lg text-[10px] font-black uppercase">Alle ({filtered.length})</TabsTrigger>
                  <TabsTrigger value="photo" className="h-7 px-3 rounded-lg text-[10px] font-black uppercase">Fotos ({photos.length})</TabsTrigger>
                  <TabsTrigger value="voice" className="h-7 px-3 rounded-lg text-[10px] font-black uppercase">Audio ({audios.length})</TabsTrigger>
                  <TabsTrigger value="text"  className="h-7 px-3 rounded-lg text-[10px] font-black uppercase">Text ({texts.length})</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Grouped by date */}
            {grouped.map(([date, dayEntries]) => (
              <div key={date} className="space-y-3">
                {/* Date header */}
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-gray-100" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground bg-white px-2">
                    {new Date(date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
                  </span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>

                {/* Photos grid */}
                {dayEntries.filter(e=>e.type==='photo').length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {dayEntries.filter(e=>e.type==='photo').map(entry => (
                      <div key={entry.id} className="relative group rounded-xl overflow-hidden aspect-[4/3] bg-gray-100 shadow-sm cursor-pointer"
                        onClick={() => setLightbox(entry.content)}>
                        <NextImage src={entry.content} alt="Foto" fill unoptimized className="object-cover transition-transform group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <button onClick={e => { e.stopPropagation(); setLightbox(entry.content); }}
                            className="w-9 h-9 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white">
                            <ZoomIn className="w-4 h-4" />
                          </button>
                          <button onClick={e => { e.stopPropagation(); downloadDataUrl(entry.content, `foto_${entry.authorName}_${entry.createdAt.slice(0,10)}.jpg`); }}
                            className="w-9 h-9 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white">
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2 pointer-events-none">
                          <p className="text-[9px] text-white font-black">{entry.authorName}</p>
                          <p className="text-[8px] text-white/70">
                            {new Date(entry.createdAt).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Audio entries */}
                {dayEntries.filter(e=>e.type==='voice').map(entry => (
                  <div key={entry.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
                          <Volume2 className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-xs font-black">{entry.authorName}</p>
                          <p className="text-[9px] text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}
                            {entry.duration && ` · ${formatDur(entry.duration)}`}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => downloadDataUrl(entry.content, `audio_${entry.authorName}_${entry.createdAt.slice(0,10)}.webm`)}
                        className="w-8 h-8 bg-gray-50 hover:bg-primary/5 rounded-xl flex items-center justify-center transition-colors">
                        <Download className="w-3.5 h-3.5 text-primary" />
                      </button>
                    </div>
                    <audio controls src={entry.content} className="w-full h-10 rounded-xl" />
                  </div>
                ))}

                {/* Text entries */}
                {dayEntries.filter(e=>e.type==='text').map(entry => (
                  <div key={entry.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center">
                          <FileText className="w-4 h-4 text-violet-600" />
                        </div>
                        <div>
                          <p className="text-xs font-black">{entry.authorName}</p>
                          <p className="text-[9px] text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => downloadText(entry.content, `notiz_${entry.authorName}_${entry.createdAt.slice(0,10)}.txt`)}
                        className="w-8 h-8 bg-gray-50 hover:bg-primary/5 rounded-xl flex items-center justify-center transition-colors">
                        <Download className="w-3.5 h-3.5 text-primary" />
                      </button>
                    </div>
                    <p className="text-sm font-medium text-foreground leading-relaxed bg-gray-50 rounded-xl px-3 py-2.5">
                      {entry.content}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Lightbox ── */}
      <Dialog open={!!lightbox} onOpenChange={() => setLightbox(null)}>
        <DialogContent className="max-w-5xl p-0 border-none bg-black/95 rounded-2xl overflow-hidden">
          <button onClick={() => setLightbox(null)}
            className="absolute top-3 right-3 z-10 w-9 h-9 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
          {lightbox && (
            <>
              <div className="relative w-full" style={{ aspectRatio: '16/10' }}>
                <NextImage src={lightbox} alt="Vollbild" fill unoptimized className="object-contain" />
              </div>
              <div className="flex justify-center gap-3 p-4">
                <Button onClick={() => downloadDataUrl(lightbox, 'foto.jpg')} variant="outline" size="sm"
                  className="font-black text-white border-white/20 bg-white/10 hover:bg-white/20 rounded-xl">
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
