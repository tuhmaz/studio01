'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Shell } from '@/components/layout/Shell';
import {
  Card, CardHeader, CardTitle, CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Tabs, TabsContent, TabsList, TabsTrigger
} from '@/components/ui/tabs';
import {
  MapPin, Upload, Loader2, Building2, FileSpreadsheet,
  Trash2, Search, Waves, Leaf, TreePine, CheckCircle2,
  Table as TableIcon, CalendarDays, Info, Clock, Navigation,
  Plus, Pencil
} from 'lucide-react';
import { parseExcelDirect } from '@/ai/flows/parse-excel-direct';
import { GERMAN_MONTHS } from '@/ai/flows/parse-excel-plan-shared';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { UserRole, JobSite } from '@/lib/types';
import { useAuth } from '@/db/provider';
import { useQuery } from '@/db/use-query';

// ─── Konstanten ──────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string; category: string }> = {
  AR_Oeffen:       { label: 'Außengehwege',    icon: <Building2 className="w-3 h-3" />,    color: 'bg-blue-50 text-blue-700 border-blue-200', category: 'Reinigung' },
  AR_Hof:          { label: 'Hofbereich',      icon: <Building2 className="w-3 h-3" />,    color: 'bg-blue-50 text-blue-700 border-blue-200', category: 'Reinigung' },
  Gullis:          { label: 'Gullis',          icon: <Waves className="w-3 h-3" />,        color: 'bg-slate-100 text-slate-800 border-slate-300', category: 'Infrastruktur' },
  Ablaufrinnen:    { label: 'Ablaufrinnen',    icon: <Waves className="w-3 h-3" />,        color: 'bg-slate-100 text-slate-800 border-slate-300', category: 'Infrastruktur' },
  AR_Laub:         { label: 'Laub AR',         icon: <Leaf className="w-3 h-3" />,         color: 'bg-yellow-50 text-yellow-700 border-yellow-200', category: 'Saison' },
  Rasen_Fl1:       { label: 'Rasen Fl. 1',     icon: <TreePine className="w-3 h-3" />,     color: 'bg-green-50 text-green-700 border-green-200', category: 'Grünpflege' },
  Rasen_Fl2:       { label: 'Rasen Fl. 2',     icon: <TreePine className="w-3 h-3" />,     color: 'bg-green-50 text-green-700 border-green-200', category: 'Grünpflege' },
  Gittersteine:    { label: 'Gittersteine',    icon: <TreePine className="w-3 h-3" />,     color: 'bg-emerald-50 text-emerald-700 border-emerald-200', category: 'Grünpflege' },
  Gartenpflege:    { label: 'Gartenpflege',    icon: <TreePine className="w-3 h-3" />,     color: 'bg-red-50 text-red-700 border-red-200', category: 'Garten' },
  Baeume_Pruefen:  { label: 'Bäume Prüfen',    icon: <TreePine className="w-3 h-3" />,     color: 'bg-amber-100 text-amber-900 border-amber-300', category: 'Sicherheit' },
  VEG_Laub:        { label: 'Laub VEG',        icon: <Leaf className="w-3 h-3" />,         color: 'bg-yellow-50 text-yellow-700 border-yellow-200', category: 'Saison' },
};

// Short month labels for table header
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

// ─── Form Types ──────────────────────────────────────────────────────────────

interface ServiceForm {
  isActive: boolean;
  frequency: string;
  months: string[];
}

interface SiteForm {
  id: string;
  city: string;
  address: string;
  postalCode: string;
  region: string;
  latitude: string;
  longitude: string;
  distanceFromHQ: string;
  estimatedTravelTimeMinutesFromHQ: string;
  isRemote: boolean;
  services: Record<string, ServiceForm>;
}

const emptyServices = (): Record<string, ServiceForm> =>
  Object.fromEntries(Object.keys(SERVICE_LABELS).map(k => [k, { isActive: false, frequency: '', months: [] }]));

const emptyForm = (): SiteForm => ({
  id: '',
  city: '',
  address: '',
  postalCode: '',
  region: 'LR-39',
  latitude: '',
  longitude: '',
  distanceFromHQ: '0',
  estimatedTravelTimeMinutesFromHQ: '0',
  isRemote: false,
  services: emptyServices(),
});

function siteToForm(site: any): SiteForm {
  const services = emptyServices();
  Object.entries(site.services || {}).forEach(([k, v]: [string, any]) => {
    if (services[k]) {
      services[k] = {
        isActive: v.isActive || false,
        frequency: v.frequency || '',
        months: v.months || [],
      };
    }
  });
  return {
    id: site.id || '',
    city: site.city || '',
    address: site.address || '',
    // Read snake_case from DB (postal_code) with camelCase fallback
    postalCode: site.postal_code ?? site.postalCode ?? '',
    region: site.route_code ?? site.routeCode ?? site.region ?? 'LR-39',
    // DB stores lat/lng directly (not nested in location)
    latitude:  site.lat  != null ? String(site.lat)  : (site.location?.lat  != null ? String(site.location.lat)  : ''),
    longitude: site.lng  != null ? String(site.lng)  : (site.location?.lng  != null ? String(site.location.lng)  : ''),
    distanceFromHQ: String(site.distance_from_hq ?? site.distanceFromHQ ?? 0),
    estimatedTravelTimeMinutesFromHQ: String(
      site.estimated_travel_time_minutes_from_hq ?? site.travel_time_from_hq ?? site.estimatedTravelTimeMinutesFromHQ ?? 0
    ),
    isRemote: site.is_remote ?? site.isRemote ?? false,
    services,
  };
}

function formToSiteData(form: SiteForm): any {
  const lat = parseFloat(form.latitude);
  const lng = parseFloat(form.longitude);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
  const services: Record<string, any> = {};
  Object.entries(form.services).forEach(([k, v]) => {
    if (v.isActive) {
      services[k] = { isActive: true, frequency: v.frequency || null, months: v.months };
    }
  });
  // Return ONLY valid snake_case DB column names to avoid "column does not exist" errors
  return {
    id:           form.id.trim(),
    name:         form.city,
    city:         form.city,
    address:      form.address,
    postal_code:  form.postalCode || null,
    region:       form.region,
    route_code:   form.region,
    is_remote:    form.isRemote,
    distance_from_hq: parseFloat(form.distanceFromHQ) || 0,
    travel_time_from_hq: parseFloat(form.estimatedTravelTimeMinutesFromHQ) || 0,
    estimated_travel_time_minutes_from_hq: parseFloat(form.estimatedTravelTimeMinutesFromHQ) || 0,
    services,
    ...(hasCoordinates ? { lat, lng } : {}),
  };
}

// ─── Monthly Catalog ──────────────────────────────────────────────────────────

function MonthlyCatalog({ services }: { services: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2">
        {GERMAN_MONTHS.map(month => {
          const activeServices = Object.entries(services || {}).filter(([_, details]: [any, any]) =>
            details.isActive && details.months?.some((m: string) => m.trim().toLowerCase() === month.trim().toLowerCase())
          );
          return (
            <div key={month} className={`p-4 rounded-2xl border transition-all ${activeServices.length > 0 ? 'bg-white shadow-sm border-primary/10' : 'bg-gray-50/50 border-transparent opacity-50'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-black uppercase tracking-wider text-primary">{month.trim()}</span>
                <Badge variant="outline" className="text-[9px] font-black uppercase">{activeServices.length} Leistungen</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeServices.length > 0 ? activeServices.map(([code]) => (
                  <div key={code} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black ${SERVICE_LABELS[code]?.color || 'bg-gray-50'}`}>
                    {SERVICE_LABELS[code]?.icon}
                    {SERVICE_LABELS[code]?.label || code}
                  </div>
                )) : (
                  <span className="text-[10px] italic text-muted-foreground/50 font-medium">Keine Arbeiten geplant</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Site Card ────────────────────────────────────────────────────────────────

function SiteCard({ site, onView, onEdit, onDelete }: {
  site: any;
  onView: (site: any) => void;
  onEdit: (site: any) => void;
  onDelete: (site: any) => void;
}) {
  const services = Object.entries(site.services || {}).filter(([, s]: [any, any]) => s.isActive);

  return (
    <Card className="border border-gray-100 shadow-sm bg-white hover:shadow-md transition-all rounded-2xl overflow-hidden group relative">
      <div className={`h-1.5 w-full ${(site.routeCode || site.region) === 'LR-39' ? 'bg-blue-600' : 'bg-blue-400'}`} />

      {/* Edit / Delete buttons - visible on hover */}
      <div className="absolute top-4 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(site); }}
          className="p-1.5 rounded-lg bg-white border border-gray-200 shadow-sm hover:bg-primary hover:text-white hover:border-primary transition-all"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(site); }}
          className="p-1.5 rounded-lg bg-white border border-gray-200 shadow-sm hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div onClick={() => onView(site)} className="cursor-pointer">
        <CardHeader className="p-4 pb-2">
          <div className="flex justify-between items-start">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center text-[10px] font-black text-primary border border-primary/10">#{site.id}</div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-black truncate">{site.city}</CardTitle>
                <p className="text-[10px] text-muted-foreground font-medium truncate">{site.address}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-primary/70 font-bold flex items-center bg-primary/5 px-1.5 py-0.5 rounded-sm">
                    <Navigation className="w-2.5 h-2.5 mr-1" /> {site.distanceFromHQ || 0} km
                  </span>
                  <span className="text-[9px] text-primary/70 font-bold flex items-center bg-primary/5 px-1.5 py-0.5 rounded-sm">
                    <Clock className="w-2.5 h-2.5 mr-1" /> {site.estimatedTravelTimeMinutesFromHQ || 0} Min.
                  </span>
                  {site.isRemote && (
                    <span className="text-[9px] text-amber-700 font-bold flex items-center bg-amber-100 px-1.5 py-0.5 rounded-sm">
                      +1 Std. Zuschlag
                    </span>
                  )}
                </div>
              </div>
            </div>
                    <Badge variant="outline" className="text-[8px] font-black border-primary/20 mr-12">{site.routeCode || site.region}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex flex-wrap gap-1 mt-2">
            {services.slice(0, 4).map(([code, details]: [any, any]) => (
              <div key={code} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[8px] font-black ${SERVICE_LABELS[code]?.color || 'bg-gray-50'}`}>
                {SERVICE_LABELS[code]?.icon}
                {details.frequency || 'Aktiv'}
              </div>
            ))}
            {services.length > 4 && (
              <Badge variant="outline" className="text-[8px] font-bold">+{services.length - 4}</Badge>
            )}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

// ─── Site Detail Dialog ───────────────────────────────────────────────────────

function SiteDetailDialog({ site, open, onClose, onEdit, onDelete }: {
  site: any;
  open: boolean;
  onClose: () => void;
  onEdit: (site: any) => void;
  onDelete: (site: any) => void;
}) {
  if (!site) return null;
  const services = Object.entries(site.services || {}).filter(([, s]: [any, any]) => s.isActive);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="site-details-description" className="sm:max-w-4xl rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl">
        <div className="bg-primary p-10 text-white">
          <div className="flex justify-between items-start mb-4">
            <Badge className="bg-white/20 text-white border-none font-black text-xs px-4">{site.routeCode || site.region}</Badge>
            <div className="flex items-center gap-2">
              <span className="font-mono text-white/50 text-xs">OBJ-ID: {site.id}</span>
              <button
                onClick={() => { onClose(); setTimeout(() => onEdit(site), 100); }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
                title="Bearbeiten"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => { onClose(); setTimeout(() => onDelete(site), 100); }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-red-500/80 transition-colors text-white"
                title="Löschen"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <DialogTitle className="text-3xl font-black uppercase tracking-tight">{site.city}</DialogTitle>
          <DialogDescription id="site-details-description" className="sr-only">{site.address} — Objekt-ID: {site.id}</DialogDescription>
          <div className="flex flex-wrap gap-4 mt-2">
            <p className="text-white/70 flex items-center gap-1.5 font-medium text-sm"><MapPin className="w-4 h-4" /> {site.address}</p>
            <div className="flex items-center gap-3 text-white/90 text-xs font-bold bg-black/10 px-3 py-1 rounded-full">
              <span className="flex items-center gap-1"><Navigation className="w-3.5 h-3.5" /> {site.distanceFromHQ || 0} km</span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {site.estimatedTravelTimeMinutesFromHQ || 0} Min. Fahrtzeit</span>
              {site.isRemote && (
                <>
                  <span className="w-1 h-1 rounded-full bg-white/30" />
                  <span className="flex items-center gap-1 text-amber-300"><Clock className="w-3.5 h-3.5" /> +1 Std. (&gt;95km)</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="bg-gray-50/50">
          <Tabs defaultValue="catalog" className="w-full">
            <TabsList className="w-full bg-white/50 border-b rounded-none h-14 p-0">
              <TabsTrigger value="catalog" className="flex-1 h-full rounded-none font-black text-xs uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary border-r">
                <CalendarDays className="w-4 h-4 mr-2" /> Monats-Katalog
              </TabsTrigger>
              <TabsTrigger value="services" className="flex-1 h-full rounded-none font-black text-xs uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary">
                <Info className="w-4 h-4 mr-2" /> Leistungs-Details
              </TabsTrigger>
            </TabsList>

            <div className="p-8 max-h-[60vh] overflow-y-auto">
              <TabsContent value="catalog" className="mt-0">
                <MonthlyCatalog services={site.services} />
              </TabsContent>

              <TabsContent value="services" className="mt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {services.map(([code, details]: [any, any]) => (
                    <Card key={code} className="p-5 border-none shadow-sm rounded-2xl bg-white group hover:shadow-md transition-all">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-xl ${SERVICE_LABELS[code]?.color || 'bg-gray-100'}`}>
                            {SERVICE_LABELS[code]?.icon}
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase text-muted-foreground">{SERVICE_LABELS[code]?.category}</p>
                            <p className="text-xs font-black uppercase text-foreground">{SERVICE_LABELS[code]?.label || code}</p>
                          </div>
                        </div>
                        {details.annualCount && (
                          <Badge variant="secondary" className="font-black text-[9px] bg-primary/5 text-primary border-none">
                            {details.annualCount}x / Jahr
                          </Badge>
                        )}
                      </div>
                      {details.frequency && (
                        <p className="text-[10px] font-bold text-muted-foreground mb-2 flex items-center gap-1">
                          <TableIcon className="w-3 h-3" /> Frequenz: {details.frequency}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {details.months?.map((m: string) => (
                          <Badge key={m} variant="outline" className="text-[8px] font-bold bg-green-50 border-green-200 text-green-700">
                            {m}
                          </Badge>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add / Edit Site Dialog ───────────────────────────────────────────────────

function AddEditSiteDialog({ open, site, nextId, availableRegions, onSave, onClose, isSaving }: {
  open: boolean;
  site: any | null;
  nextId: string;
  availableRegions: string[];
  onSave: (data: any) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<SiteForm>(emptyForm());
  const [newRegionInput, setNewRegionInput] = useState('');
  const [showNewRegion, setShowNewRegion] = useState(false);

  useEffect(() => {
    if (open) {
      const base = site ? siteToForm(site) : { ...emptyForm(), id: nextId };
      setForm(base);
      setShowNewRegion(false);
      setNewRegionInput('');
    }
  }, [site, open, nextId]);

  const set = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  const setSvc = (key: string, field: string, value: any) =>
    setForm(f => ({ ...f, services: { ...f.services, [key]: { ...f.services[key], [field]: value } } }));

  const toggleMonth = (key: string, month: string) => {
    setForm(f => {
      const months = f.services[key].months;
      const matched = months.find(m => m.trim().toLowerCase() === month.trim().toLowerCase());
      const newMonths = matched ? months.filter(m => m.trim().toLowerCase() !== month.trim().toLowerCase()) : [...months, month];
      return { ...f, services: { ...f.services, [key]: { ...f.services[key], months: newMonths } } };
    });
  };

  const isMonthActive = (key: string, month: string) =>
    form.services[key]?.months.some(m => m.trim().toLowerCase() === month.trim().toLowerCase());

  const canSave = form.id.trim() && form.city.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="job-form-description" className="sm:max-w-5xl rounded-[2rem] border-none shadow-2xl p-0 overflow-hidden max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="bg-primary p-8 text-white shrink-0">
          <DialogTitle className="text-2xl font-black uppercase">
            {site ? 'Liegenschaft bearbeiten' : 'Neue Liegenschaft anlegen'}
          </DialogTitle>
          <DialogDescription id="job-form-description" className="text-white/60 text-sm font-medium mt-1">
            {site ? `Objekt-ID: ${site.id}` : 'Manuelle Erfassung einer neuen Liegenschaft'}
          </DialogDescription>
        </div>

        {/* Tabs */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <Tabs defaultValue="info" className="w-full h-full flex flex-col">
            <TabsList className="w-full bg-white border-b rounded-none h-14 p-0 shrink-0 sticky top-0 z-10">
              <TabsTrigger value="info" className="flex-1 h-full rounded-none font-black text-xs uppercase tracking-widest data-[state=active]:bg-primary/5 data-[state=active]:text-primary border-r">
                Grunddaten
              </TabsTrigger>
              <TabsTrigger value="services" className="flex-1 h-full rounded-none font-black text-xs uppercase tracking-widest data-[state=active]:bg-primary/5 data-[state=active]:text-primary">
                Leistungen &amp; Monate
              </TabsTrigger>
            </TabsList>

            {/* Tab: Basic Info */}
            <TabsContent value="info" className="p-8 mt-0">
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Objekt-ID *</Label>
                  <div className="relative">
                    <Input
                      value={form.id}
                      onChange={e => set('id', e.target.value)}
                      disabled={!!site}
                      placeholder="z.B. 0001"
                      className="rounded-xl font-bold pr-20"
                    />
                    {!site && (
                      <button
                        type="button"
                        onClick={() => set('id', nextId)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded-lg transition-colors"
                      >
                        Auto
                      </button>
                    )}
                  </div>
                  {!!site
                    ? <p className="text-[9px] text-muted-foreground font-medium">ID kann nach dem Erstellen nicht geändert werden.</p>
                    : <p className="text-[9px] text-primary/50 font-medium">Nächste verfügbare ID: <strong>{nextId}</strong></p>
                  }
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Region</Label>
                  {showNewRegion ? (
                    <div className="flex gap-2">
                      <Input
                        value={newRegionInput}
                        onChange={e => setNewRegionInput(e.target.value.toUpperCase())}
                        placeholder="z.B. LR-40"
                        className="rounded-xl font-bold flex-1"
                        autoFocus
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (newRegionInput.trim()) {
                            set('region', newRegionInput.trim());
                          }
                          setShowNewRegion(false);
                          setNewRegionInput('');
                        }}
                        className="rounded-xl font-black shrink-0"
                        disabled={!newRegionInput.trim()}
                      >
                        OK
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => { setShowNewRegion(false); setNewRegionInput(''); }}
                        className="rounded-xl font-black shrink-0"
                      >
                        ✕
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Select value={form.region} onValueChange={v => set('region', v)}>
                        <SelectTrigger className="rounded-xl font-bold flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableRegions.map(r => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowNewRegion(true)}
                        className="rounded-xl font-black shrink-0 border-primary/30 text-primary"
                        title="Neue Region hinzufügen"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  {form.region && !showNewRegion && (
                    <p className="text-[9px] text-primary/50 font-medium">Aktuelle Region: <strong>{form.region}</strong></p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Stadt *</Label>
                  <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Stadt" className="rounded-xl font-bold" />
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Postleitzahl</Label>
                  <Input value={form.postalCode} onChange={e => set('postalCode', e.target.value)} placeholder="PLZ" className="rounded-xl font-bold" />
                </div>

                <div className="col-span-2 space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Adresse</Label>
                  <Input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Straße und Hausnummer" className="rounded-xl font-bold" />
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Latitude</Label>
                  <Input value={form.latitude} onChange={e => set('latitude', e.target.value)} placeholder="z.B. 52.1354" className="rounded-xl font-bold" />
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Longitude</Label>
                  <Input value={form.longitude} onChange={e => set('longitude', e.target.value)} placeholder="z.B. 11.6175" className="rounded-xl font-bold" />
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Entfernung HQ (km)</Label>
                  <Input type="number" min="0" value={form.distanceFromHQ} onChange={e => set('distanceFromHQ', e.target.value)} className="rounded-xl font-bold" />
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-primary/60 tracking-widest">Fahrtzeit (Minuten)</Label>
                  <Input type="number" min="0" value={form.estimatedTravelTimeMinutesFromHQ} onChange={e => set('estimatedTravelTimeMinutesFromHQ', e.target.value)} className="rounded-xl font-bold" />
                </div>

                <div className="col-span-2">
                  <label className={`flex items-center gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${form.isRemote ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-transparent hover:border-gray-200'}`}>
                    <input
                      type="checkbox"
                      checked={form.isRemote}
                      onChange={e => set('isRemote', e.target.checked)}
                      className="w-5 h-5 accent-primary rounded"
                    />
                    <div>
                      <p className="text-sm font-black">Fernliegenschaft — +1 Stunde Zuschlag</p>
                      <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Aktivieren wenn die Liegenschaft mehr als 95 km vom HQ entfernt ist.</p>
                    </div>
                  </label>
                </div>
              </div>
            </TabsContent>

            {/* Tab: Services */}
            <TabsContent value="services" className="mt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-primary/5 border-b-2 border-primary/10">
                      <th className="text-left px-4 py-3 font-black uppercase text-primary/70 tracking-wider min-w-[160px]">Leistung</th>
                      <th className="px-3 py-3 font-black uppercase text-primary/70 tracking-wider text-center">Aktiv</th>
                      <th className="px-3 py-3 font-black uppercase text-primary/70 tracking-wider text-center min-w-[80px]">Frequenz</th>
                      {GERMAN_MONTHS.map((m, i) => (
                        <th key={m} className="px-2 py-3 font-black text-primary/60 text-center min-w-[36px]">{MONTH_SHORT[i]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(SERVICE_LABELS).map(([code, info]) => {
                      const svc = form.services[code];
                      const isActive = svc?.isActive || false;
                      return (
                        <tr
                          key={code}
                          className={`border-b transition-colors ${isActive ? 'bg-white hover:bg-primary/2' : 'bg-gray-50/60 opacity-60'}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`p-1.5 rounded-lg border ${info.color}`}>{info.icon}</div>
                              <div>
                                <p className="font-black text-[9px] uppercase text-muted-foreground">{info.category}</p>
                                <p className="font-black text-[10px] uppercase">{info.label}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={e => setSvc(code, 'isActive', e.target.checked)}
                              className="w-4 h-4 accent-primary cursor-pointer"
                            />
                          </td>
                          <td className="px-2 py-3">
                            <Input
                              value={svc?.frequency || ''}
                              onChange={e => setSvc(code, 'frequency', e.target.value)}
                              placeholder="4xJ"
                              disabled={!isActive}
                              className="h-7 text-[10px] rounded-lg px-2 w-20 font-bold"
                            />
                          </td>
                          {GERMAN_MONTHS.map((month) => (
                            <td key={month} className="px-2 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isMonthActive(code, month)}
                                onChange={() => toggleMonth(code, month)}
                                disabled={!isActive}
                                className="w-3.5 h-3.5 accent-primary cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-white flex justify-end gap-3 shrink-0">
          <Button variant="outline" onClick={onClose} className="rounded-xl font-black px-6">
            Abbrechen
          </Button>
          <Button
            onClick={() => onSave(formToSiteData(form))}
            disabled={isSaving || !canSave}
            className="rounded-xl font-black px-8 shadow-lg shadow-primary/20"
          >
            {isSaving
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Speichern...</>
              : site ? 'Änderungen speichern' : 'Liegenschaft anlegen'
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [isParsing, setIsParsing] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog state
  const [viewingSite, setViewingSite] = useState<any | null>(null);
  const [editingSite, setEditingSite] = useState<any | null>(null);
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingSite, setDeletingSite] = useState<any | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { userProfile, isUserLoading } = useAuth();
  const user = userProfile;

  const companyId = userProfile?.companyId ?? '';
  const hasContext = !!userProfile && !!companyId;

  const effectiveRole = (userProfile?.role ?? 'WORKER') as UserRole;
  const effectiveUserName = userProfile?.name ?? 'Benutzer';
  const effectiveCompanyId = companyId;

  const { data: jobSitesRaw, isLoading: isDbLoading, refresh: refreshSites } = useQuery({
    table: 'job_sites',
    filters: hasContext ? { company_id: effectiveCompanyId } : undefined,
    enabled: hasContext,
    realtime: true,
  });

  // Map snake_case DB rows → camelCase aliases for UI components
  const jobSites: JobSite[] = useMemo(() => {
    if (!jobSitesRaw) return [];
    return (jobSitesRaw as any[]).map((row: any) => ({
      ...row,
      companyId:    row.company_id,
      routeCode:    row.route_code  ?? row.routeCode  ?? row.region,
      isRemote:     row.is_remote   ?? row.isRemote   ?? false,
      postalCode:   row.postal_code ?? row.postalCode ?? '',
      distanceFromHQ: row.distance_from_hq ?? row.distanceFromHQ ?? 0,
      estimatedTravelTimeMinutesFromHQ:
        row.estimated_travel_time_minutes_from_hq ?? row.travel_time_from_hq ?? row.estimatedTravelTimeMinutesFromHQ ?? 0,
      travelTimeFromHQ: row.travel_time_from_hq ?? row.travelTimeFromHQ ?? 0,
    }));
  }, [jobSitesRaw]);

  const filteredSites = useMemo(() => {
    if (!jobSites) return [];
    return jobSites.filter(site => {
      const q = searchQuery.toLowerCase();
      return !q || site.city?.toLowerCase().includes(q) || site.address?.toLowerCase().includes(q) || site.id?.toLowerCase().includes(q);
    }).sort((a, b) => a.id.localeCompare(b.id));
  }, [jobSites, searchQuery]);

  // Auto-generate next ID from existing sites
  const nextId = useMemo(() => {
    if (!jobSites?.length) return '0001';
    const max = jobSites.reduce((acc, s) => {
      const n = parseInt(s.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? acc : Math.max(acc, n);
    }, 0);
    return String(max + 1).padStart(4, '0');
  }, [jobSites]);

  // Collect all unique regions from existing sites + defaults
  const availableRegions = useMemo(() => {
    const fromSites = (jobSites || [])
      .map((site) => site.routeCode || site.region)
      .filter((region): region is string => Boolean(region));
    return Array.from(new Set(['LR-39', 'LR-38', ...fromSites])).sort();
  }, [jobSites]);

  // ── Handlers ──

  const handleOpenAdd = () => {
    setEditingSite(null);
    setIsAddEditOpen(true);
  };

  const handleOpenEdit = (site: any) => {
    setEditingSite(site);
    setIsAddEditOpen(true);
  };

  const handleSaveSite = async (data: any) => {
    if (!effectiveCompanyId) return;
    setIsSaving(true);
    try {
      const upsertRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          table: 'job_sites',
          // data already has snake_case keys from formToSiteData — just add company_id
          data: { ...data, company_id: effectiveCompanyId },
        }),
      });
      if (!upsertRes.ok) { const j = await upsertRes.json(); throw new Error(j?.error ?? 'Upsert fehlgeschlagen'); }
      toast({
        title: editingSite ? 'Liegenschaft aktualisiert' : 'Liegenschaft angelegt',
        description: `${data.city} (${data.id}) wurde erfolgreich gespeichert.`,
      });
      refreshSites();
      setIsAddEditOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingSite || !effectiveCompanyId) return;
    try {
      const deleteRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          table: 'job_sites',
          filters: { id: deletingSite.id, company_id: effectiveCompanyId },
        }),
      });
      if (!deleteRes.ok) { const j = await deleteRes.json(); throw new Error(j?.error ?? 'Löschen fehlgeschlagen'); }
      toast({ title: 'Liegenschaft gelöscht', description: `${deletingSite.city} wurde entfernt.` });
      refreshSites();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: error.message });
    } finally {
      setDeletingSite(null);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !effectiveCompanyId) return;

    setIsParsing(true);
    setImportStatus('Lese Masterplan-Datei...');
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        setImportStatus('Analysiere Tourplan-Struktur...');
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', raw: false, cellStyles: true, sheetStubs: true });

        setImportStatus('Extrahiere Liegenschaften und Leistungskatalog...');
        const sites = await parseExcelDirect(workbook, data);

        if (sites.length === 0) {
          throw new Error('Keine Liegenschaften im Masterplan gefunden. Bitte prüfen Sie das Dateiformat.');
        }

        setImportStatus(`Speichere ${sites.length} Liegenschaften in Datenbank...`);

        // Upsert in chunks to avoid request size limits
        const CHUNK_SIZE = 200;
        for (let i = 0; i < sites.length; i += CHUNK_SIZE) {
          const chunk = sites.slice(i, i + CHUNK_SIZE).map((site: any) => ({
            id:           site.id,
            company_id:   effectiveCompanyId,
            name:         site.name || `${site.address}, ${site.city}`,
            address:      site.address || '',
            city:         site.city || '',
            postal_code:  site.postalCode ?? null,
            region:       site.region ?? null,
            route_code:   site.routeCode || site.region || null,
            is_remote:    site.isRemote ?? false,
            distance_from_hq: site.distanceFromHQ ?? null,
            travel_time_from_hq: site.estimatedTravelTimeMinutesFromHQ ?? site.travelTimeFromHQ ?? 0,
            estimated_travel_time_minutes_from_hq: site.estimatedTravelTimeMinutesFromHQ ?? null,
            lat:          site.lat ?? null,
            lng:          site.lng ?? null,
            services:     site.services ?? {},
          }));
          const chunkRes = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'upsert', table: 'job_sites', data: chunk }),
          });
          if (!chunkRes.ok) { const j = await chunkRes.json(); throw new Error(j?.error ?? 'Upsert fehlgeschlagen'); }
        }

        toast({
          title: 'Masterplan synchronisiert',
          description: `${sites.length} Liegenschaften wurden erfolgreich importiert.`,
        });
        refreshSites();
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Import-Fehler', description: error.message });
      } finally {
        setIsParsing(false);
        setImportStatus('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const clearAllSites = async () => {
    if (!jobSites?.length || !effectiveCompanyId) return;
    setIsParsing(true);
    setImportStatus('Lösche Datenbank-Einträge...');
    const clearRes = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        table: 'job_sites',
        filters: { company_id: effectiveCompanyId },
      }),
    });
    setIsParsing(false);
    setImportStatus('');
    if (!clearRes.ok) {
      const j = await clearRes.json();
      toast({ variant: 'destructive', title: 'Fehler beim Löschen', description: j?.error ?? 'Unbekannter Fehler' });
    } else {
      toast({ title: 'Datenbank bereinigt' });
      refreshSites();
    }
  };

  return (
    <Shell userRole={effectiveRole} userName={effectiveUserName}>
      <div className="space-y-8 animate-in fade-in duration-500">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-8 rounded-[2rem] shadow-xl border border-primary/5">
          <div className="space-y-1">
            <h1 className="text-4xl font-black uppercase text-primary tracking-tighter flex items-center gap-3">
              <CalendarDays className="w-8 h-8" /> Monatliche Indizierung
            </h1>
            <p className="text-muted-foreground font-medium">Extraktion des monatlichen Arbeitsbedarfs aus dem Masterplan {new Date().getFullYear()}.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" id="excel-upload" />
            <Button
              variant="outline"
              size="lg"
              className="text-destructive font-black border-destructive/20 rounded-2xl h-14"
              onClick={clearAllSites}
              disabled={isParsing}
            >
              <Trash2 className="mr-2 h-5 w-5" /> LEEREN
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="font-black rounded-2xl h-14 px-6 border-primary/30"
              onClick={handleOpenAdd}
              disabled={isParsing}
            >
              <Plus className="mr-2 h-5 w-5" /> MANUELL HINZUFÜGEN
            </Button>
            <Button
              size="lg"
              className="font-black rounded-2xl h-14 px-8 shadow-lg shadow-primary/20"
              onClick={() => document.getElementById('excel-upload')?.click()}
              disabled={isParsing}
            >
              {isParsing
                ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> ANALYSE...</>
                : <><Upload className="mr-2 h-5 w-5" /> MASTERPLAN LADEN</>
              }
            </Button>
          </div>
        </div>

        {/* Parsing Alert */}
        {isParsing && (
          <Alert className="bg-primary/5 border-primary/20 animate-pulse rounded-3xl py-6">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <AlertTitle className="font-black uppercase text-xs tracking-widest text-primary ml-2">Monatliche Auswertung aktiv</AlertTitle>
            <AlertDescription className="text-sm font-bold ml-2 mt-1">
              {importStatus || 'Die KI erstellt den monatlichen Leistungskatalog...'}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <aside className="space-y-6">
            <Card className="border-none shadow-xl rounded-[2rem] p-8 bg-primary text-white relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 opacity-10 group-hover:scale-110 transition-transform"><FileSpreadsheet className="w-32 h-32" /></div>
              <p className="text-[10px] font-black uppercase opacity-70 tracking-widest mb-1 relative z-10">Liegenschaften Aktiv</p>
              <p className="text-5xl font-black relative z-10">{jobSites?.length || 0}</p>
              <div className="mt-6 flex items-center gap-2 relative z-10">
                <CheckCircle2 className="w-5 h-5 text-white/50" />
                <p className="text-[10px] text-white/70 font-bold uppercase tracking-widest">Masterplan {new Date().getFullYear()} v4.0</p>
              </div>
            </Card>

            <Card className="border-none shadow-xl rounded-[2rem] p-6 bg-white space-y-4">
              <h3 className="text-xs font-black uppercase text-primary tracking-widest flex items-center gap-2">
                <TableIcon className="w-4 h-4" /> Legende &amp; Farbcodes
              </h3>
              <div className="space-y-3">
                {Object.entries(SERVICE_LABELS).map(([key, info]) => (
                  <div key={key} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-colors">
                    <div className={`p-2 rounded-lg shadow-sm ${info.color}`}>{info.icon}</div>
                    <div>
                      <p className="text-[9px] font-black uppercase text-primary/50">{info.category}</p>
                      <p className="text-[10px] font-black uppercase text-foreground">{info.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </aside>

          {/* Main Content */}
          <main className="lg:col-span-3 space-y-6">
            <div className="relative group">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                placeholder="Liegenschaft, Adresse oder ID suchen..."
                className="pl-14 bg-white h-16 rounded-3xl border-none shadow-lg text-lg font-medium focus-visible:ring-2 focus-visible:ring-primary/20"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredSites.map(site => (
                <SiteCard
                  key={site.id}
                  site={site}
                  onView={setViewingSite}
                  onEdit={handleOpenEdit}
                  onDelete={setDeletingSite}
                />
              ))}
            </div>

            {filteredSites.length === 0 && !isDbLoading && (
              <div className="py-32 text-center bg-white rounded-[3rem] border-4 border-dashed border-gray-100 flex flex-col items-center">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
                  <FileSpreadsheet className="w-10 h-10 text-muted-foreground/20" />
                </div>
                <h3 className="text-2xl font-black text-foreground/80 uppercase tracking-tight">Keine Daten gefunden</h3>
                <p className="text-muted-foreground font-bold uppercase text-xs mt-2 tracking-widest">Masterplan laden oder Liegenschaft manuell hinzufügen.</p>
                <Button onClick={handleOpenAdd} className="mt-6 rounded-2xl font-black px-8">
                  <Plus className="mr-2 h-4 w-4" /> Erste Liegenschaft anlegen
                </Button>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* ── Dialogs ── */}

      <SiteDetailDialog
        site={viewingSite}
        open={!!viewingSite}
        onClose={() => setViewingSite(null)}
        onEdit={(s) => { setViewingSite(null); handleOpenEdit(s); }}
        onDelete={(s) => { setViewingSite(null); setDeletingSite(s); }}
      />

      <AddEditSiteDialog
        open={isAddEditOpen}
        site={editingSite}
        nextId={nextId}
        availableRegions={availableRegions}
        onSave={handleSaveSite}
        onClose={() => setIsAddEditOpen(false)}
        isSaving={isSaving}
      />

      <AlertDialog open={!!deletingSite} onOpenChange={(o) => !o && setDeletingSite(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-black uppercase">Liegenschaft löschen?</AlertDialogTitle>
            <AlertDialogDescription className="font-medium">
              <strong>{deletingSite?.city}</strong> (ID: {deletingSite?.id}) wird dauerhaft aus der Datenbank entfernt.
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl font-black">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="rounded-xl font-black bg-destructive hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Shell>
  );
}
