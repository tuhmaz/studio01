
"use client";

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Shell } from '@/components/layout/Shell';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  MapPin,
  Clock,
  Users,
  List,
  Navigation,
  Calendar as CalendarIcon,
  ArrowUpRight,
  Hammer,
  Zap,
  Phone,
  CheckCircle2,
  Loader2,
  Trash2
} from 'lucide-react';

// Dynamic import — Leaflet uses window, so SSR must be disabled
const LiveMap = dynamic(() => import('@/components/map/LiveMap'), { ssr: false });
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/db/provider';
import { useQuery } from '@/db/use-query';
import { UserRole, JobSite } from '@/lib/types';
import type { MapSite } from '@/components/map/LiveMap';
import { format } from 'date-fns';

interface TaskAssignment {
  id: string;
  companyId: string;
  jobSiteId: string;
  assignedWorkerIds: string[];
  scheduledDate: string;
  title: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  categories?: string[];
  createdAt?: unknown;
  isPlanPublished?: boolean;
}

interface TeamMember {
  id: string;
  name: string;
  role: UserRole;
}

export default function SchedulePage() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [workerAssignments, setWorkerAssignments] = useState<TaskAssignment[] | null>(null);
  const [isWorkerAssignmentsLoading, setIsWorkerAssignmentsLoading] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const { toast } = useToast();
  const { userProfile } = useAuth();
  const user = userProfile;

  const companyId = userProfile?.companyId ?? '';
  const hasContext = !!userProfile && !!companyId;

  const effectiveRole = (userProfile?.role ?? 'WORKER') as UserRole;
  const effectiveUserName = userProfile?.name ?? 'Benutzer';
  const effectiveCompanyId = companyId;
  const canDeleteTours = effectiveRole === 'ADMIN' || effectiveRole === 'LEADER';
  const isManagementView = effectiveRole === 'ADMIN' || effectiveRole === 'LEADER';

  const formattedDate = date?.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  const isoDate = date ? format(date, 'yyyy-MM-dd') : undefined;

  // Month boundaries for the selected date (used by the map)
  const monthStart = date ? format(new Date(date.getFullYear(), date.getMonth(), 1), 'yyyy-MM-dd') : undefined;
  const monthEnd   = date ? format(new Date(date.getFullYear(), date.getMonth() + 1, 0), 'yyyy-MM-dd') : undefined;

  // ── Monthly completed assignments (for Live-Map) ────────────────────────────
  const [monthlyCompletedRaw, setMonthlyCompletedRaw] = useState<any[]>([]);
  useEffect(() => {
    if (!hasContext || !monthStart || !monthEnd) return;
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'query_range',
        table: 'job_assignments',
        filters: { company_id: effectiveCompanyId, status: 'COMPLETED' },
        rangeFilters: [
          { column: 'scheduled_date', gte: monthStart, lte: monthEnd },
        ],
        select: 'job_site_id, scheduled_date',
      }),
    }).then(r => r.json()).then(j => setMonthlyCompletedRaw(j.data ?? []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContext, effectiveCompanyId, monthStart, monthEnd]);

  // Management view: fetch all assignments for the selected date
  const { data: managementAssignmentsRaw, isLoading: isManagementAssignmentsLoading } = useQuery({
    table: 'job_assignments',
    filters: hasContext && isoDate ? { company_id: effectiveCompanyId, scheduled_date: isoDate } : undefined,
    enabled: hasContext && isManagementView && !!isoDate,
    realtime: true,
  });

  // Worker view: complex query with array-contains filter — done via useEffect
  useEffect(() => {
    if (!hasContext || !isoDate || isManagementView || !user) return;
    setIsWorkerAssignmentsLoading(true);
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'query',
        table: 'job_assignments',
        filters: {
          company_id: effectiveCompanyId,
          scheduled_date: isoDate,
          is_plan_published: true,
          'assigned_worker_ids@cs': [user.id],
        },
      }),
    }).then(async (res) => {
      const json = await res.json();
      const data = json.data ?? [];
      setWorkerAssignments(data.map((row: any) => ({
        id: row.id,
        companyId: row.company_id,
        jobSiteId: row.job_site_id,
        assignedWorkerIds: row.assigned_worker_ids ?? [],
        scheduledDate: row.scheduled_date,
        title: row.title,
        status: row.status,
        isPlanPublished: row.is_plan_published,
        categories: row.categories,
      })));
      setIsWorkerAssignmentsLoading(false);
    });
  }, [hasContext, isoDate, isManagementView, user, effectiveCompanyId]);

  // Map management assignments from snake_case
  const managementAssignments: TaskAssignment[] = React.useMemo(() => {
    if (!managementAssignmentsRaw) return [];
    return (managementAssignmentsRaw as any[]).map((row: any) => ({
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
  }, [managementAssignmentsRaw]);

  const assignments = React.useMemo(
    () => isManagementView ? managementAssignments : (workerAssignments ?? []),
    [isManagementView, managementAssignments, workerAssignments],
  );
  const isAssignmentsLoading = isManagementView ? isManagementAssignmentsLoading : isWorkerAssignmentsLoading;

  // Standorte laden — refresh() called after geocoding to pick up new coordinates
  const { data: jobSitesRaw, refresh: refreshJobSites } = useQuery({
    table: 'job_sites',
    filters: hasContext ? { company_id: effectiveCompanyId } : undefined,
    enabled: hasContext,
  });

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

  // Mitarbeiter laden (users table)
  const { data: usersRaw } = useQuery({
    table: 'users',
    filters: hasContext ? { company_id: effectiveCompanyId } : undefined,
    enabled: hasContext,
  });

  const teamMembers: TeamMember[] = React.useMemo(() => {
    if (!usersRaw) return [];
    return (usersRaw as any[]).map((row: any) => ({
      id: row.id,
      name: row.name,
      role: row.role,
    }));
  }, [usersRaw]);

  // ── Build map sites: merge job sites with today's status + monthly completions
  const mapSites: MapSite[] = React.useMemo(() => {
    if (!jobSites.length) return [];

    // Group monthly completions by site id
    const monthlyBySite: Record<string, string[]> = {};
    for (const row of monthlyCompletedRaw) {
      const sid = row.job_site_id;
      if (!monthlyBySite[sid]) monthlyBySite[sid] = [];
      monthlyBySite[sid].push(row.scheduled_date);
    }

    return jobSites.map(site => {
      const assignment = assignments.find(a => a.jobSiteId === site.id);
      const workers = assignment
        ? teamMembers.filter(m => assignment.assignedWorkerIds.includes(m.id)).map(m => m.name)
        : [];
      const monthlyDates = monthlyBySite[site.id] ?? [];
      return {
        id:                 site.id,
        name:               site.name,
        address:            site.address,
        city:               site.city,
        lat:                site.lat != null ? Number(site.lat) : null,
        lng:                site.lng != null ? Number(site.lng) : null,
        routeCode:          site.routeCode ?? site.region ?? null,
        status:             assignment?.status ?? null,
        monthlyCompletions: monthlyDates.length,
        monthlyDates:       monthlyDates.sort(),
        workers,
        categories:         assignment?.categories,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobSites, assignments, teamMembers, monthlyCompletedRaw]);

  // ── Geocode missing coordinates via OSM Nominatim ─────────────────────────
  const handleGeocode = async () => {
    setIsGeocoding(true);
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.geocoded > 0) {
        toast({
          title: `${json.geocoded} Standort${json.geocoded !== 1 ? 'e' : ''} geortet`,
          description: 'Koordinaten wurden gespeichert.',
        });
        refreshJobSites();
      } else {
        toast({ title: 'Alle Standorte haben bereits Koordinaten.' });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Geokodierung fehlgeschlagen' });
    } finally {
      setIsGeocoding(false);
    }
  };

  const completedCount = assignments?.filter(t => t.status === 'COMPLETED').length || 0;
  const progressPercent = assignments && assignments.length > 0 ? (completedCount / assignments.length) * 100 : 0;

  const handleDeleteTour = async (taskId: string) => {
    if (!canDeleteTours) return;

    try {
      // Delete all time_entries for this assignment first
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          table: 'time_entries',
          filters: { job_assignment_id: taskId },
        }),
      });
      // Then delete the assignment itself
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          table: 'job_assignments',
          filters: { id: taskId },
        }),
      });
      if (!res.ok) throw new Error('delete failed');
      setOpenTaskId(null);
      toast({
        title: 'Tour gelöscht',
        description: 'Einsatz und alle Zeiteinträge wurden entfernt.',
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Löschen fehlgeschlagen',
        description: 'Die Tour konnte nicht gelöscht werden.',
      });
    }
  };

  return (
    <Shell userRole={effectiveRole} userName={effectiveUserName}>
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase">Tourplan Master</h1>
            <p className="text-muted-foreground flex items-center gap-2 font-medium">
              <CalendarIcon className="w-4 h-4 text-primary" /> {formattedDate}
            </p>
          </div>
          <div className="flex flex-wrap gap-2" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <Card className="border-none shadow-2xl bg-white overflow-hidden rounded-3xl">
              <CardHeader className="bg-primary/5 pb-4">
                <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4" /> Datum wählen
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 flex items-center justify-center">
                <CalendarUI 
                  mode="single" 
                  selected={date} 
                  onSelect={setDate} 
                  fixedWeeks 
                  className="rounded-md border-none w-full max-w-[320px]" 
                />
              </CardContent>
            </Card>

            <Card className="border-none shadow-2xl bg-primary text-white relative overflow-hidden rounded-3xl group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform"><Zap className="w-24 h-24" /></div>
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest opacity-80">Tagesstatus</CardTitle>
                <h3 className="text-5xl font-black">{Math.round(progressPercent)}%</h3>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={progressPercent} className="h-3 bg-white/20 mb-4" />
                <div className="grid grid-cols-2 gap-4 text-[10px] font-black uppercase">
                  <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-md border border-white/10">
                    <p className="opacity-70 mb-1">Fertig</p>
                    <p className="text-2xl">{completedCount}</p>
                  </div>
                  <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-md border border-white/10">
                    <p className="opacity-70 mb-1">Offen</p>
                    <p className="text-2xl">{(assignments?.length || 0) - completedCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Monthly completions summary */}
            <Card className="border-none shadow-xl bg-white overflow-hidden rounded-3xl">
              <CardHeader className="bg-green-50 pb-3">
                <CardTitle className="text-[10px] font-black text-green-700 uppercase tracking-widest flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {date?.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-black text-green-600">{monthlyCompletedRaw.length}</span>
                  <span className="text-xs font-black text-muted-foreground uppercase pb-1">Einsätze abgeschlossen</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-xs text-muted-foreground font-medium">
                    {new Set(monthlyCompletedRaw.map((r: any) => r.job_site_id)).size} verschiedene Standorte
                  </span>
                </div>
                <Progress
                  value={jobSites.length > 0 ? (new Set(monthlyCompletedRaw.map((r: any) => r.job_site_id)).size / jobSites.length) * 100 : 0}
                  className="h-2 bg-green-100"
                />
                <p className="text-[9px] text-muted-foreground font-medium">
                  {Math.round(jobSites.length > 0 ? (new Set(monthlyCompletedRaw.map((r: any) => r.job_site_id)).size / jobSites.length) * 100 : 0)}% aller Standorte besucht
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-8 space-y-6">
            <Tabs defaultValue="list" className="w-full">
              <TabsList className="bg-muted/50 p-1.5 rounded-2xl h-14 shadow-inner mb-6">
                <TabsTrigger value="list" className="rounded-xl h-11 px-8 font-black uppercase text-xs data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-primary transition-all">
                  <List className="mr-2 h-4 w-4" /> Protokoll
                </TabsTrigger>
                <TabsTrigger value="map" className="rounded-xl h-11 px-8 font-black uppercase text-xs data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-primary transition-all">
                  <Navigation className="mr-2 h-4 w-4" /> Live-Map
                </TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-4 mt-0">
                {isAssignmentsLoading ? (
                  <div className="py-24 text-center flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 text-primary animate-spin" />
                    <p className="text-muted-foreground font-bold uppercase text-xs">Synchronisierung läuft...</p>
                  </div>
                ) : assignments && assignments.length > 0 ? assignments.map((task) => {
                  const site = jobSites?.find(s => s.id === task.jobSiteId);
                  const assignedWorkers = teamMembers?.filter(u => task.assignedWorkerIds.includes(u.id)) || [];

                  return (
                    <Dialog key={task.id} open={openTaskId === task.id} onOpenChange={(open) => setOpenTaskId(open ? task.id : null)}>
                      <DialogTrigger asChild>
                        <Card className="border-none shadow-xl hover:scale-[1.01] transition-all cursor-pointer overflow-hidden bg-white border-l-[8px]" style={{ borderLeftColor: task.status === 'COMPLETED' ? '#22c55e' : task.status === 'IN_PROGRESS' ? '#3b82f6' : '#cbd5e1' }}>
                          <CardContent className="p-6">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                              <div className="space-y-4 flex-1">
                                <div className="flex flex-wrap items-center gap-3">
                                  <Badge className="bg-primary/10 text-primary border-none font-mono text-[10px] font-black uppercase">
                                    {site?.routeCode || site?.region || 'Tour'}
                                  </Badge>
                                  <span className="text-[10px] font-black text-muted-foreground flex items-center gap-2 bg-muted/40 px-3 py-1 rounded-full">
                                    <Clock className="w-3 h-3 text-primary" /> STATUS: {task.status}
                                  </span>
                                  {task.status === 'COMPLETED' && (
                                    <Badge className="bg-green-500 text-white border-none font-black text-[9px] px-3 ml-auto">
                                      <CheckCircle2 className="w-3 h-3 mr-1" /> ERLEDIGT
                                    </Badge>
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <h3 className="text-xl font-black group-hover:text-primary transition-colors flex items-center gap-2">
                                    {!task.jobSiteId ? (task.title || 'Sonderauftrag') : (site?.name || 'Unbekanntes Objekt')}
                                    <ArrowUpRight className="w-5 h-5 text-primary opacity-50" />
                                  </h3>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {task.categories?.map((cat: string) => (
                                      <Badge key={cat} variant="secondary" className="text-[8px] py-0.5 px-3 bg-gray-100 border-none font-black text-muted-foreground uppercase">
                                        {cat}
                                      </Badge>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3 font-medium">
                                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                                    <span className="truncate">{site?.address}, {site?.city}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center -space-x-3 p-3 bg-muted/20 rounded-2xl md:w-36 justify-center border-2 border-dashed border-primary/10">
                                {assignedWorkers.map((worker) => (
                                  <Avatar key={worker.id} className="border-4 border-white w-10 h-10 shadow-lg">
                                    <AvatarImage src={`https://picsum.photos/seed/${worker.id}/100/100`} />
                                    <AvatarFallback className="font-black text-xs">{worker.name.charAt(0)}</AvatarFallback>
                                  </Avatar>
                                ))}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-2xl rounded-3xl border-none shadow-2xl">
                        <DialogHeader>
                          <div className="flex flex-wrap items-center gap-3 mb-4">
                            <Badge className="bg-primary text-white font-mono px-3 py-1 text-xs">{site?.routeCode || site?.region}</Badge>
                            <Badge variant="outline" className="font-black text-[10px] border-primary/20 uppercase">{task.status}</Badge>
                          </div>
                          <DialogTitle className="text-2xl font-black text-primary">{site?.name}</DialogTitle>
                        </DialogHeader>
                        <Separator className="my-6" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
                          <div className="space-y-6">
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-black uppercase text-primary flex items-center gap-2 tracking-widest">
                                <MapPin className="w-3 h-3" /> Standort
                              </h4>
                              <div className="p-4 bg-muted/30 rounded-2xl border border-primary/5">
                                <p className="font-black text-lg">{site?.name}</p>
                                <p className="text-sm text-muted-foreground font-medium mt-1">{site?.address}, {site?.city}</p>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-black uppercase text-primary flex items-center gap-2 tracking-widest">
                                <Hammer className="w-3 h-3" /> Aufgaben
                              </h4>
                              <div className="flex flex-wrap gap-2">
                                {task.categories?.map((cat: string) => (
                                  <Badge key={cat} className="bg-white border-primary/20 text-primary font-black text-[9px] px-3 py-1">
                                    {cat}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-primary flex items-center gap-2 tracking-widest">
                              <Users className="w-3 h-3" /> Eingeteiltes Team
                            </h4>
                            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
                              {assignedWorkers.map(worker => (
                                <div key={worker.id} className="p-3 bg-white border-2 border-gray-50 rounded-2xl flex items-center gap-4 hover:shadow-md transition-all">
                                  <Avatar className="w-10 h-10 shadow-sm">
                                    <AvatarImage src={`https://picsum.photos/seed/${worker.id}/100/100`} />
                                    <AvatarFallback className="font-black text-sm">{worker.name.charAt(0)}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-black text-foreground truncate">{worker.name}</p>
                                    <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">{worker.role}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-primary/5 hover:bg-primary/10 text-primary">
                                    <Phone className="w-4 h-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <DialogFooter className="gap-3 mt-8">
                          {canDeleteTours && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="destructive"
                                  className="font-black h-12 rounded-2xl"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  TOUR LÖSCHEN
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-3xl border-none shadow-2xl p-0 overflow-hidden max-w-md">
                                <div className="bg-destructive/10 px-6 py-5 border-b border-destructive/10">
                                  <AlertDialogHeader className="space-y-2 text-left">
                                    <AlertDialogTitle className="text-2xl font-black text-destructive">
                                      TOUR wirklich löschen?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription className="text-sm font-medium text-muted-foreground">
                                      Dieser Einsatz für <span className="font-black text-foreground">{site?.name || task.title || 'dieses Objekt'}</span> wird dauerhaft entfernt — einschließlich aller Zeiteinträge der Mitarbeiter.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                </div>
                                <div className="px-6 py-5 space-y-4">
                                  <div className="rounded-2xl border border-border bg-muted/20 p-4">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                      {!task.jobSiteId ? 'Sonderauftrag' : 'Betroffene Tour'}
                                    </p>
                                    <p className="mt-2 text-base font-black text-foreground">
                                      {!task.jobSiteId ? (task.title || 'Sonderauftrag') : (site?.name || 'Unbekanntes Objekt')}
                                    </p>
                                    {!task.jobSiteId ? (
                                      <p className="mt-1 text-sm text-muted-foreground">Ohne festen Standort</p>
                                    ) : (
                                      <p className="mt-1 text-sm text-muted-foreground">{site?.address}, {site?.city}</p>
                                    )}
                                  </div>
                                  <AlertDialogFooter className="gap-3 sm:space-x-0">
                                    <AlertDialogCancel className="mt-0 h-12 rounded-2xl font-black">
                                      Abbrechen
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      className="h-12 rounded-2xl bg-destructive font-black text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() => handleDeleteTour(task.id)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      Jetzt löschen
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </div>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          <DialogClose asChild>
                            <Button variant="outline" className="flex-1 font-black h-12 rounded-2xl border-primary/20">SCHLIESSEN</Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  );
                }) : (
                  <div className="py-24 text-center bg-white rounded-3xl border-4 border-dashed border-gray-50 flex flex-col items-center gap-6">
                    <CalendarIcon className="w-16 h-16 text-muted-foreground/20" />
                    <div className="space-y-2">
                      <h3 className="text-2xl font-black text-foreground/80 uppercase">Keine Einsätze</h3>
                      <p className="text-sm text-muted-foreground font-medium max-w-xs mx-auto">Für dieses Datum wurde noch kein Tourplan erstellt.</p>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="map" className="mt-0">
                <LiveMap
                  sites={mapSites}
                  onGeocode={handleGeocode}
                  isGeocoding={isGeocoding}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </Shell>
  );
}
