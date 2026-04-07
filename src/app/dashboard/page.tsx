"use client";

import { useState, useEffect, useMemo } from 'react';
import { Shell } from '@/components/layout/Shell';
import { UserRole } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Clock, MapPin, CheckCircle2, TrendingUp, Calendar, ArrowRight,
  LayoutDashboard, Timer, PlusCircle, FileSpreadsheet, Loader2, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/db/provider';
import { useQuery } from '@/db/use-query';
import type { DbJobAssignment, DbJobSite, DbUser } from '@/lib/db-types';

export default function DashboardPage() {
  const router = useRouter();
  const { userProfile, isUserLoading } = useAuth();
  const user = userProfile;

  const companyId   = userProfile?.companyId ?? '';
  const hasContext  = !!userProfile && !!companyId;
  const isManagement = userProfile?.role === 'ADMIN' || userProfile?.role === 'LEADER';
  const effectiveRole     = (userProfile?.role ?? 'WORKER') as UserRole;
  const effectiveUserName = userProfile?.name ?? '';

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const todayIso = now.toISOString().split('T')[0];
  const formattedDate = now.toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  // ── Job Sites ─────────────────────────────────────────────────────────────
  const { data: jobSites } = useQuery<DbJobSite>({
    table: 'job_sites',
    filters: [{ column: 'company_id', value: companyId }],
    enabled: hasContext,
    realtime: true,
  });

  // ── Today's assignments ───────────────────────────────────────────────────
  const { data: allTodayAssignments, isLoading: isAssignmentsLoading } = useQuery<DbJobAssignment>({
    table: 'job_assignments',
    filters: [
      { column: 'company_id', value: companyId },
      { column: 'scheduled_date', value: todayIso },
    ],
    enabled: hasContext,
    realtime: true,
  });

  const todayAssignments = useMemo(() => {
    if (!allTodayAssignments) return null;
    if (isManagement) return allTodayAssignments;
    // Workers: only their published assignments
    return allTodayAssignments.filter(
      a => a.is_plan_published && a.assigned_worker_ids.includes(user?.id ?? ''),
    );
  }, [allTodayAssignments, isManagement, user?.id]);

  // ── Employees (management only) ───────────────────────────────────────────
  const { data: employees } = useQuery<DbUser>({
    table: 'users',
    filters: [{ column: 'company_id', value: companyId }],
    enabled: hasContext && isManagement,
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  const remoteSitesCount = jobSites?.filter(s => s.is_remote).length ?? 0;
  const completedToday   = todayAssignments?.filter(a => a.status === 'COMPLETED').length ?? 0;
  const inProgressToday  = todayAssignments?.filter(a => a.status === 'IN_PROGRESS').length ?? 0;
  const pendingToday     = todayAssignments?.filter(a => a.status === 'PENDING').length ?? 0;

  const myActiveAssignment = useMemo(() => {
    if (!todayAssignments || isManagement) return null;
    return todayAssignments.find(a => a.status === 'IN_PROGRESS')
        ?? todayAssignments.find(a => a.status !== 'COMPLETED')
        ?? null;
  }, [todayAssignments, isManagement]);

  const stats = isManagement
    ? [
        { label: 'Aktive Objekte',  value: `${jobSites?.length ?? 0}`,            icon: MapPin,       color: 'text-blue-600',   sub: 'Gesamt im System' },
        { label: 'Remote Bonus',    value: `${remoteSitesCount}`,                  icon: TrendingUp,   color: 'text-purple-600', sub: 'Objekte mit +1h Bonus' },
        { label: 'Einsätze heute',  value: `${todayAssignments?.length ?? 0}`,     icon: Calendar,     color: 'text-orange-600', sub: `${completedToday} abgeschlossen` },
        { label: 'Team',            value: `${employees?.length ?? 0}`,            icon: Users,        color: 'text-green-600',  sub: 'Mitarbeiter aktiv' },
      ]
    : [
        { label: 'Meine Einsätze', value: `${todayAssignments?.length ?? 0}`,      icon: MapPin,       color: 'text-blue-600',   sub: 'Heute zugewiesen' },
        { label: 'Abgeschlossen',  value: `${completedToday}`,                     icon: CheckCircle2, color: 'text-green-600',  sub: 'Heute erledigt' },
        { label: 'In Bearbeitung', value: `${inProgressToday}`,                    icon: Timer,        color: 'text-orange-600', sub: 'Läuft gerade' },
        { label: 'Ausstehend',     value: `${pendingToday}`,                       icon: Clock,        color: 'text-gray-500',   sub: 'Noch offen' },
      ];

  return (
    <Shell userRole={effectiveRole} userName={effectiveUserName}>
      <div className="space-y-8 animate-in fade-in duration-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tight text-primary uppercase">Tuhmaz Hausmeister Pro</h1>
            <p className="text-muted-foreground font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />{formattedDate}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="font-bold border-primary/20 hover:bg-primary/5 shadow-sm" onClick={() => router.push('/schedule')}>
              <Calendar className="mr-2 h-4 w-4 text-primary" /> Tourplan
            </Button>
            {effectiveRole === 'WORKER' ? (
              <Button size="sm" className="font-bold shadow-md" onClick={() => router.push('/tracking')}>
                <Timer className="mr-2 h-4 w-4" /> Zur Zeiterfassung
              </Button>
            ) : (
              <Button size="sm" className="font-bold shadow-md" onClick={() => router.push('/deployment')}>
                <PlusCircle className="mr-2 h-4 w-4" /> Einsatz planen
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <Card key={i} className="border-none shadow-xl hover:scale-[1.02] transition-all bg-white overflow-hidden group">
              <div className="h-1 w-full bg-primary/10 group-hover:bg-primary transition-colors" />
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-2xl bg-gray-50 ${stat.color} shadow-inner`}>
                    <stat.icon className="h-6 w-6" />
                  </div>
                  <Badge variant="secondary" className="bg-primary/5 text-primary border-none font-bold text-[10px] px-2 py-0.5">LIVE</Badge>
                </div>
                <div>
                  <h3 className="text-3xl font-black text-foreground">{stat.value}</h3>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-1">{stat.label}</p>
                  <p className="text-[10px] text-primary/60 font-medium mt-2 italic">{stat.sub}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 border-none shadow-2xl bg-white rounded-3xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between bg-gray-50/50 pb-6">
              <div>
                <CardTitle className="text-xl font-black text-primary">Heutige Einsätze</CardTitle>
                <CardDescription className="font-medium">
                  {todayAssignments?.length
                    ? `${todayAssignments.length} Einsatz${todayAssignments.length !== 1 ? 'e' : ''} geplant`
                    : 'Keine Einsätze für heute'}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="text-primary font-bold hover:bg-primary/5" onClick={() => router.push('/schedule')}>
                Alle <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {isAssignmentsLoading ? (
                <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-bold text-sm">Wird geladen…</span>
                </div>
              ) : !todayAssignments?.length ? (
                <div className="p-12 text-center flex flex-col items-center justify-center space-y-4">
                  <div className="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center">
                    <LayoutDashboard className="w-8 h-8 text-muted-foreground/30" />
                  </div>
                  <p className="text-muted-foreground font-medium max-w-xs">Keine Einsätze für heute hinterlegt.</p>
                  {isManagement && (
                    <Button variant="outline" className="font-bold border-primary/30" onClick={() => router.push('/deployment')}>
                      Einsatz erstellen
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {todayAssignments.slice(0, 6).map((a) => {
                    const statusColor =
                      a.status === 'COMPLETED'   ? 'bg-green-100 text-green-700' :
                      a.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700'  :
                      'bg-gray-100 text-gray-600';
                    const statusLabel =
                      a.status === 'COMPLETED'   ? 'Abgeschlossen' :
                      a.status === 'IN_PROGRESS' ? 'In Bearbeitung' : 'Ausstehend';
                    return (
                      <div key={a.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 cursor-pointer transition-colors" onClick={() => router.push('/schedule')}>
                        <div className="w-2 h-2 rounded-full bg-primary/40 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm truncate">{a.title || 'Einsatz'}</p>
                          {a.categories?.length > 0 && (
                            <p className="text-xs text-muted-foreground truncate">{a.categories.slice(0, 3).join(' · ')}</p>
                          )}
                        </div>
                        <Badge className={`text-[9px] font-black shrink-0 border-none ${statusColor}`}>{statusLabel}</Badge>
                      </div>
                    );
                  })}
                  {todayAssignments.length > 6 && (
                    <div className="px-6 py-3 text-center text-xs font-bold text-primary cursor-pointer hover:bg-primary/5" onClick={() => router.push('/schedule')}>
                      + {todayAssignments.length - 6} weitere Einsätze anzeigen
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {effectiveRole === 'WORKER' && (
              <Card className="border-none shadow-2xl bg-primary text-white overflow-hidden relative rounded-3xl">
                <div className="absolute top-[-20px] right-[-20px] w-40 h-40 bg-white/10 rounded-full blur-3xl" />
                <CardHeader className="relative z-10">
                  <CardTitle className="text-white text-xl font-black flex items-center gap-2">
                    <Timer className="w-6 h-6" /> Meine Schicht
                  </CardTitle>
                  <CardDescription className="text-white/70 font-medium">
                    {myActiveAssignment ? myActiveAssignment.title || 'Aktiver Einsatz' : 'Kein aktiver Einsatz'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10 space-y-4">
                  <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-md border border-white/10">
                    <p className="text-[9px] font-black uppercase opacity-70 tracking-widest mb-1">Status</p>
                    <p className="text-sm font-bold">
                      {myActiveAssignment
                        ? myActiveAssignment.status === 'IN_PROGRESS' ? '🟢 Läuft gerade' : '🟡 Bereit zum Start'
                        : 'Keine Zuweisung für heute'}
                    </p>
                  </div>
                  <Button variant="secondary" className="w-full font-black h-12 rounded-xl shadow-lg bg-white text-primary hover:bg-gray-100" onClick={() => router.push('/tracking')}>
                    Zur Zeiterfassung
                  </Button>
                </CardContent>
              </Card>
            )}

            {isManagement && (
              <Card className="border-none shadow-2xl bg-primary text-white overflow-hidden relative rounded-3xl">
                <div className="absolute top-[-20px] right-[-20px] w-40 h-40 bg-white/10 rounded-full blur-3xl" />
                <CardHeader className="relative z-10">
                  <CardTitle className="text-white text-xl font-black flex items-center gap-2">
                    <TrendingUp className="w-6 h-6" /> Routen-Übersicht
                  </CardTitle>
                  <CardDescription className="text-white/70 font-medium">LR 39 &amp; LR 38 — Heute</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 relative z-10">
                  {[
                    { label: 'Abgeschlossen',  value: completedToday,  color: 'text-green-300' },
                    { label: 'In Bearbeitung', value: inProgressToday, color: 'text-blue-300' },
                    { label: 'Ausstehend',     value: pendingToday,    color: 'text-yellow-300' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex justify-between items-center p-3 bg-white/10 rounded-xl">
                      <span className="text-xs font-black uppercase tracking-widest opacity-70">{label}</span>
                      <span className={`text-lg font-black ${color}`}>{value}</span>
                    </div>
                  ))}
                  <Button variant="secondary" className="w-full font-black h-11 rounded-xl bg-white text-primary hover:bg-gray-100 mt-2" onClick={() => router.push('/schedule')}>
                    Tourplan öffnen
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card className="border-none shadow-2xl bg-white rounded-3xl overflow-hidden">
              <CardHeader className="bg-gray-50/50">
                <CardTitle className="text-lg font-black text-primary flex items-center gap-2 uppercase">
                  <FileSpreadsheet className="w-5 h-5" /> Dienstleistungen
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3 text-xs">
                  {[
                    { code: 'AR',  label: 'Außenreinigung' },
                    { code: 'VEG', label: 'Grünpflege' },
                    { code: 'RM',  label: 'Rasen mähen' },
                    { code: 'GU',  label: 'Gullis säubern' },
                  ].map(({ code, label }) => (
                    <div key={code} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg transition-colors">
                      <Badge variant="outline" className="font-mono font-bold border-primary/30">{code}</Badge>
                      <span className="font-black text-muted-foreground uppercase">{label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  );
}
