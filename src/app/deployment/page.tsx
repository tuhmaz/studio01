
"use client";

import React, { useState } from 'react';
import { Shell } from '@/components/layout/Shell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn, getDistanceFromLatLonInMeters } from '@/lib/utils';
import {
  MapPin,
  Calendar,
  Save,
  UserPlus,
  ListChecks,
  Loader2,
  Hammer,
  Building2,
  Waves,
  Leaf,
  TreePine,
  Lightbulb,
  Zap,
  Info,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/db/provider';
import { useQuery } from '@/db/use-query';
import { UserRole, JobSite } from '@/lib/types';
import { GERMAN_MONTHS, normalizeMonth } from '@/ai/flows/parse-excel-plan-shared';

// Hilfsfunktion für lesbare Labels
const SERVICE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  AR_Oeffen: { label: 'Außengehwege', icon: <Building2 className="w-3 h-3" />, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  AR_Hof: { label: 'Hofbereich', icon: <Building2 className="w-3 h-3" />, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  Gullis: { label: 'Gullis', icon: <Waves className="w-3 h-3" />, color: 'bg-slate-100 text-slate-800 border-slate-300' },
  Ablaufrinnen: { label: 'Ablaufrinnen', icon: <Waves className="w-3 h-3" />, color: 'bg-slate-100 text-slate-800 border-slate-300' },
  AR_Laub: { label: 'Laub AR', icon: <Leaf className="w-3 h-3" />, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  Rasen_Fl1: { label: 'Rasen Fl. 1', icon: <TreePine className="w-3 h-3" />, color: 'bg-green-50 text-green-700 border-green-200' },
  Rasen_Fl2: { label: 'Rasen Fl. 2', icon: <TreePine className="w-3 h-3" />, color: 'bg-green-50 text-green-700 border-green-200' },
  Gittersteine: { label: 'Gittersteine', icon: <TreePine className="w-3 h-3" />, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Gartenpflege: { label: 'Gartenpflege', icon: <TreePine className="w-3 h-3" />, color: 'bg-red-50 text-red-700 border-red-200' },
  Baeume_Pruefen: { label: 'Bäume Prüfen', icon: <TreePine className="w-3 h-3" />, color: 'bg-amber-100 text-amber-900 border-amber-300' },
  VEG_Laub: { label: 'Laub VEG', icon: <Leaf className="w-3 h-3" />, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' }
};

type ServiceDetails = {
  isActive?: boolean;
  frequency?: string | null;
  months?: string[];
};

interface JobAssignment {
  id: string;
  companyId: string;
  jobSiteId: string;
  assignedWorkerIds: string[];
  scheduledDate: string;
  title: string;
  status: string;
  createdAt?: unknown;
  isPlanPublished?: boolean;
  categories?: string[];
}

const isServiceDueInMonth = (details: ServiceDetails | undefined, month: string) => {
  if (!details?.isActive || !details.months?.length) return false;
  const normalizedCurrentMonth = normalizeMonth(month);

  return details.months.some((entry) => normalizeMonth(entry) === normalizedCurrentMonth);
};

export default function DeploymentPage() {
  const [mode, setMode] = useState<'regular' | 'sonder'>('regular');
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [sonderTitle, setSonderTitle] = useState('');
  const [sonderAddress, setSonderAddress] = useState('');
  const { toast } = useToast();
  const { userProfile, isUserLoading } = useAuth();
  const user = userProfile;

  const companyId = userProfile?.companyId ?? '';
  const hasContext = !!userProfile && !!companyId;

  const effectiveRole = (userProfile?.role ?? 'WORKER') as UserRole;
  const effectiveUserName = userProfile?.name ?? 'Benutzer';
  const effectiveCompanyId = companyId;
  const isManagementView = effectiveRole === 'ADMIN' || effectiveRole === 'LEADER';

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const selectedDateString = format(selectedDate, 'yyyy-MM-dd');
  const currentMonth = GERMAN_MONTHS[selectedDate.getMonth()];

  const { data: jobSitesRaw, isLoading: isSitesLoading } = useQuery({
    table: 'job_sites',
    filters: hasContext ? { company_id: effectiveCompanyId } : undefined,
    enabled: hasContext,
  });

  // Map DB rows to camelCase for UI
  const jobSites: JobSite[] = React.useMemo(() => {
    if (!jobSitesRaw) return [];
    return (jobSitesRaw as any[]).map((row: any) => ({
      ...row,
      companyId: row.company_id,
      routeCode: row.route_code ?? row.routeCode ?? row.region,
      isRemote: row.is_remote ?? row.isRemote,
      lat: row.lat != null ? Number(row.lat) : null,
      lng: row.lng != null ? Number(row.lng) : null,
    }));
  }, [jobSitesRaw]);

  const { data: workersRaw, isLoading: isWorkersLoading } = useQuery({
    table: 'users',
    filters: hasContext ? { company_id: effectiveCompanyId } : undefined,
    enabled: hasContext && isManagementView,
  });

  // Filter to WORKER/LEADER roles
  const workers = React.useMemo(() => {
    if (!workersRaw) return null;
    return (workersRaw as any[])
      .filter((w: any) => w.role === 'WORKER' || w.role === 'LEADER')
      .map((w: any) => ({
        id: w.id,
        companyId: w.company_id,
        name: w.name,
        role: w.role,
        avatarUrl: w.avatar_url,
      }));
  }, [workersRaw]);

  const { data: todaysDeploymentsRaw, refresh: refreshDeployments } = useQuery({
    table: 'job_assignments',
    filters: hasContext ? { company_id: effectiveCompanyId, scheduled_date: selectedDateString } : undefined,
    enabled: hasContext && isManagementView,
  });

  // Map assignments to camelCase
  const todaysDeployments: JobAssignment[] = React.useMemo(() => {
    if (!todaysDeploymentsRaw) return [];
    return (todaysDeploymentsRaw as any[]).map((row: any) => ({
      id: row.id,
      companyId: row.company_id,
      jobSiteId: row.job_site_id,
      assignedWorkerIds: row.assigned_worker_ids ?? [],
      scheduledDate: row.scheduled_date,
      title: row.title,
      status: row.status,
      isPlanPublished: row.is_plan_published,
      categories: row.categories,
    }));
  }, [todaysDeploymentsRaw]);

  const toggleWorker = (workerId: string) => {
    setSelectedWorkers(prev =>
      prev.includes(workerId) ? prev.filter(id => id !== workerId) : [...prev, workerId]
    );
  };

  const currentSite = jobSites?.find(s => s.id === selectedSite);
  const dueServices = currentSite?.services
    ? Object.entries(currentSite.services as Record<string, ServiceDetails>)
        .filter(([, details]) => isServiceDueInMonth(details, currentMonth))
    : [];

  const handleSaveDeployment = async () => {
    if (!selectedSite || selectedWorkers.length === 0) {
      toast({
        variant: "destructive",
        title: "Fehlende Informationen",
        description: "Bitte wählen Sie einen Standort und mindestens einen Mitarbeiter aus.",
      });
      return;
    }

    const existing = todaysDeployments?.find(d => d.jobSiteId === selectedSite);
    if (existing) {
      toast({ variant: 'destructive', title: 'Bereits eingeplant', description: 'Für diesen Standort existiert bereits ein Einsatz am selben Tag.' });
      return;
    }

    const assignmentId = `assign-${crypto.randomUUID()}`;
    const activeCategories = dueServices.map(([code]) => code);

    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'insert',
        table: 'job_assignments',
        data: {
          id: assignmentId,
          company_id: effectiveCompanyId,
          job_site_id: selectedSite,
          assigned_worker_ids: selectedWorkers,
          scheduled_date: selectedDateString,
          title: currentSite?.name || 'Tageseinsatz',
          status: 'PENDING',
          is_plan_published: true,
          categories: activeCategories,
        },
      }),
    });

    if (!res.ok) {
      const json = await res.json();
      toast({
        variant: 'destructive',
        title: 'Tagesplan konnte nicht gespeichert werden',
        description: json?.error ?? 'Unbekannter Fehler',
      });
      return;
    }

    toast({
      title: "Tagesplan gespeichert",
      description: `${selectedWorkers.length} Mitarbeiter wurden zugewiesen.`,
    });
    refreshDeployments();
    setSelectedSite('');
    setSelectedWorkers([]);
  };

  const handleSaveSonder = async () => {
    if (!sonderTitle.trim() || selectedWorkers.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Fehlende Informationen',
        description: 'Bitte geben Sie eine Beschreibung ein und wählen Sie mindestens einen Mitarbeiter aus.',
      });
      return;
    }

    const fullTitle = sonderAddress.trim()
      ? `${sonderTitle.trim()} — ${sonderAddress.trim()}`
      : sonderTitle.trim();

    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'insert',
        table: 'job_assignments',
        data: {
          id: `assign-${crypto.randomUUID()}`,
          company_id: effectiveCompanyId,
          job_site_id: null,
          assigned_worker_ids: selectedWorkers,
          scheduled_date: selectedDateString,
          title: fullTitle,
          status: 'PENDING',
          is_plan_published: true,
          categories: [],
        },
      }),
    });

    if (!res.ok) {
      const json = await res.json();
      toast({ variant: 'destructive', title: 'Fehler', description: json?.error ?? 'Unbekannter Fehler' });
      return;
    }

    toast({ title: 'Sonderauftrag gespeichert', description: `${selectedWorkers.length} Mitarbeiter zugewiesen.` });
    refreshDeployments();
    setSonderTitle('');
    setSonderAddress('');
    setSelectedWorkers([]);
  };

  const formattedToday = format(selectedDate, 'dd.MM.yyyy', { locale: de });

  const suggestedSites = React.useMemo(() => {
    if (!currentSite || !jobSites || currentSite.lat == null || currentSite.lng == null) return [];
    
    return jobSites.filter(site => {
      if (site.id === currentSite.id) return false;
      if (site.lat == null || site.lng == null) return false;
      
      // Check if already scheduled today
      if (todaysDeployments?.some(d => d.jobSiteId === site.id)) return false;

      // Check if has due services this month
      const hasDue = site.services ? Object.values(site.services).some((s: any) => isServiceDueInMonth(s, currentMonth)) : false;
      if (!hasDue) return false;

      // Distance <= 25km
      const dist = getDistanceFromLatLonInMeters(currentSite.lat!, currentSite.lng!, site.lat!, site.lng!);
      return dist <= 25000;
    }).sort((a, b) => {
      const distA = getDistanceFromLatLonInMeters(currentSite.lat!, currentSite.lng!, a.lat!, a.lng!);
      const distB = getDistanceFromLatLonInMeters(currentSite.lat!, currentSite.lng!, b.lat!, b.lng!);
      return distA - distB;
    }).slice(0, 5); // top 5 closest
  }, [currentSite, jobSites, todaysDeployments, currentMonth]);

  return (
    <Shell userRole={effectiveRole} userName={effectiveUserName}>
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase">Einsatzplanung</h1>
            <p className="text-muted-foreground font-medium">Teilen Sie das Team und die Aufgaben ein.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-muted rounded-2xl p-1 gap-1">
            <button
              onClick={() => setMode('regular')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${mode === 'regular' ? 'bg-white shadow text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Building2 className="w-3.5 h-3.5" /> Regulärer Einsatz
            </button>
            <button
              onClick={() => setMode('sonder')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${mode === 'sonder' ? 'bg-amber-100 shadow text-amber-800' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Zap className="w-3.5 h-3.5" /> Sonderauftrag
            </button>
          </div>
          <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border shadow-sm">
            <Label className="text-xs font-bold text-muted-foreground uppercase ml-2">Datum:</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[200px] justify-start text-left font-bold rounded-xl",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP", { locale: de }) : <span>Datum wählen</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-2xl" align="end">
                <CalendarComponent
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <Card className={`border-none shadow-xl rounded-3xl overflow-hidden ${mode === 'sonder' ? 'bg-white border-2 border-amber-200' : 'bg-white'}`}>
              <CardHeader className={mode === 'sonder' ? 'bg-amber-50' : 'bg-primary/5'}>
                <CardTitle className={`flex items-center gap-2 font-black uppercase text-sm tracking-widest ${mode === 'sonder' ? 'text-amber-800' : 'text-primary'}`}>
                  {mode === 'sonder'
                    ? <><Zap className="w-4 h-4" /> 1. Beschreibung &amp; Ort</>
                    : <><MapPin className="w-4 h-4" /> 1. Standort &amp; Aufgaben wählen</>
                  }
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                {mode === 'sonder' ? (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-[10px] font-black uppercase text-amber-700 tracking-widest mb-1.5 block">Beschreibung *</Label>
                      <Input
                        placeholder="z.B. Ölfleck-Reinigung, Winterdienst, Sonderreinigung..."
                        value={sonderTitle}
                        onChange={e => setSonderTitle(e.target.value)}
                        className="border-amber-200 focus-visible:ring-amber-400"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] font-black uppercase text-amber-700 tracking-widest mb-1.5 block">Ort / Adresse (optional)</Label>
                      <Input
                        placeholder="z.B. Hauptstraße 12, Musterstadt"
                        value={sonderAddress}
                        onChange={e => setSonderAddress(e.target.value)}
                        className="border-amber-200 focus-visible:ring-amber-400"
                      />
                    </div>
                    <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-2xl border border-amber-100">
                      <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 font-medium leading-relaxed">
                        Einmaliger Einsatz ohne festen Standort. Erscheint im Kschf als Sonderauftrag.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Select onValueChange={setSelectedSite} value={selectedSite}>
                      <SelectTrigger className="h-12 border-primary/20">
                        <SelectValue placeholder={isSitesLoading ? "Lade Standorte..." : "Standort auswählen..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {jobSites?.map(site => (
                          <SelectItem key={site.id} value={site.id}>
                            {site.name} ({site.city}) - {site.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {currentSite && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                        <div className="p-4 bg-muted/30 rounded-2xl border border-dashed border-primary/20">
                          <p className="text-[10px] font-black uppercase text-primary mb-1">Adresse</p>
                          <p className="text-sm font-bold">{currentSite.address}</p>
                        </div>
                        <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                          <p className="text-[10px] font-black uppercase text-primary mb-2 flex items-center gap-1">
                            <Hammer className="w-3 h-3" /> Fällige Leistungen {currentMonth}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {dueServices.length > 0 ? dueServices.map(([key]) => (
                                <div key={key} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black ${SERVICE_LABELS[key]?.color || 'bg-gray-50'}`}>
                                  {SERVICE_LABELS[key]?.icon}
                                  {SERVICE_LABELS[key]?.label || key}
                                </div>
                              )) : (
                                <span className="text-[10px] font-bold text-muted-foreground">
                                  Keine fälligen Leistungen im Monats-Katalog für {currentMonth}
                                </span>
                              )}
                          </div>
                        </div>
                      </div>
                    )}

                    {currentSite && suggestedSites.length > 0 && (
                      <div className="mt-6 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                        <p className="text-[10px] font-black uppercase text-amber-600 mb-3 flex items-center gap-1">
                          <Lightbulb className="w-3 h-3" /> Vorschläge (Standorte in der Nähe)
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {suggestedSites.map(site => (
                            <div key={site.id} className="p-3 bg-white rounded-xl border border-amber-200/50 flex justify-between items-center cursor-pointer hover:bg-amber-100/30 transition-colors" onClick={() => setSelectedSite(site.id)}>
                              <div>
                                <p className="text-xs font-bold text-slate-800">{site.name}</p>
                                <p className="text-[10px] text-muted-foreground">{Math.round(getDistanceFromLatLonInMeters(currentSite.lat!, currentSite.lng!, site.lat!, site.lng!) / 1000)} km entfernt</p>
                              </div>
                              <Button variant="ghost" size="sm" className="h-7 text-[10px] font-bold text-amber-700 bg-amber-100/50 hover:bg-amber-200">
                                Wählen
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-none shadow-xl bg-white rounded-3xl overflow-hidden">
              <CardHeader className="bg-primary/5">
                <CardTitle className="flex items-center gap-2 text-primary font-black uppercase text-sm tracking-widest">
                  <UserPlus className="w-4 h-4" /> 2. Team zusammenstellen
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isWorkersLoading ? (
                  <div className="col-span-2 flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
                ) : workers?.sort((a) => a.role === 'LEADER' ? -1 : 1).map(worker => (
                  <div
                    key={worker.id}
                    className={`flex items-center space-x-3 p-4 rounded-2xl border transition-all cursor-pointer ${selectedWorkers.includes(worker.id) ? 'bg-primary/5 border-primary shadow-inner' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleWorker(worker.id)}
                  >
                    <Checkbox checked={selectedWorkers.includes(worker.id)} className="rounded-full" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Label className="font-black cursor-pointer text-sm">{worker.name}</Label>
                        {worker.role === 'LEADER' && <Badge className="h-4 px-1 text-[8px] bg-blue-500">LEITER</Badge>}
                      </div>
                      <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest">{worker.role}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className={`border-none shadow-2xl sticky top-24 rounded-3xl overflow-hidden text-white ${mode === 'sonder' ? 'bg-amber-800' : 'bg-primary'}`}>
              <CardHeader>
                <CardTitle className="text-white text-lg font-black uppercase tracking-widest">Zusammenfassung</CardTitle>
                <CardDescription className="text-white/70 font-medium">
                  {mode === 'sonder' ? 'Sonderauftrag prüfen' : 'Zuweisung prüfen'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-1">
                  <p className="text-[9px] font-black opacity-70 uppercase tracking-widest">Datum</p>
                  <div className="flex items-center gap-2 font-bold"><Calendar className="w-4 h-4" />{formattedToday}</div>
                </div>
                {mode === 'sonder' ? (
                  <>
                    <div className="space-y-1">
                      <p className="text-[9px] font-black opacity-70 uppercase tracking-widest">Beschreibung</p>
                      <p className="font-bold truncate">{sonderTitle.trim() || '—'}</p>
                    </div>
                    {sonderAddress.trim() && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-black opacity-70 uppercase tracking-widest">Ort</p>
                        <p className="font-bold truncate">{sonderAddress.trim()}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[9px] font-black opacity-70 uppercase tracking-widest">Objekt</p>
                    <p className="font-bold truncate">{currentSite ? currentSite.name : 'Keines gewählt'}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-[9px] font-black opacity-70 uppercase tracking-widest">Team ({selectedWorkers.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedWorkers.length > 0 ? selectedWorkers.map(id => (
                      <Badge key={id} variant="secondary" className="bg-white/20 text-white border-none text-[9px] font-black uppercase">
                        {workers?.find(u => u.id === id)?.name}
                      </Badge>
                    )) : <span className="text-xs opacity-50 italic">Keine Mitarbeiter gewählt</span>}
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                {mode === 'sonder' ? (
                  <Button
                    className="w-full bg-amber-100 text-amber-800 hover:bg-amber-200 font-black h-12 rounded-2xl shadow-lg"
                    onClick={handleSaveSonder}
                    disabled={!sonderTitle.trim() || selectedWorkers.length === 0}
                  >
                    <Zap className="mr-2 h-4 w-4" /> SONDERAUFTRAG SPEICHERN
                  </Button>
                ) : (
                  <Button
                    className="w-full bg-white text-primary hover:bg-gray-100 font-black h-12 rounded-2xl shadow-lg"
                    onClick={handleSaveDeployment}
                    disabled={!selectedSite || selectedWorkers.length === 0}
                  >
                    <Save className="mr-2 h-4 w-4" /> EINSATZ SPEICHERN
                  </Button>
                )}
              </CardFooter>
            </Card>

            {todaysDeployments && todaysDeployments.length > 0 && (
              <Card className="border-none shadow-xl bg-white rounded-3xl overflow-hidden">
                <CardHeader className="bg-gray-50/50 pb-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-black text-primary uppercase">
                    <ListChecks className="w-4 h-4"/> Aktive Einsätze am {formattedToday}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {todaysDeployments.map(dep => {
                    const site = jobSites?.find(s => s.id === dep.jobSiteId);
                    const isSonder = !dep.jobSiteId;
                    return (
                      <div key={dep.id} className={`p-3 rounded-2xl border flex justify-between items-center ${isSonder ? 'bg-amber-50 border-amber-100' : 'bg-muted/30 border-primary/5'}`}>
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-1.5">
                            {isSonder && <Zap className="w-3 h-3 text-amber-600 shrink-0" />}
                            <p className={`font-black text-xs truncate ${isSonder ? 'text-amber-800' : ''}`}>
                              {isSonder ? dep.title : site?.name ?? dep.title}
                            </p>
                          </div>
                          <p className="text-[9px] text-muted-foreground font-bold uppercase">{dep.assignedWorkerIds.length} Personen</p>
                        </div>
                        <Badge variant="outline" className={`text-[9px] font-black shrink-0 ${isSonder ? 'border-amber-300 text-amber-700' : 'border-primary/20 text-primary'}`}>{dep.status}</Badge>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
