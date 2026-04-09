"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import NextImage from 'next/image';
import { Shell } from '@/components/layout/Shell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MapPin, Play, Square, Loader2, Ban,
  CheckCircle2, Hammer, Building2, Waves, Leaf,
  TreePine, Users, Clock, Send, Edit
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/db/provider';
import NotesPanel from '@/components/tracking/NotesPanel';
import { useQuery } from '@/db/use-query';
import { UserRole, JobSite, TimeEntry, ServiceDetails } from '@/lib/types';
import { GERMAN_MONTHS, normalizeMonth } from '@/ai/flows/parse-excel-plan-shared';

// ─── Service Info ─────────────────────────────────────────────────────────────

const SERVICE_INFO: Record<string, { label: string; Icon: React.ElementType; color: string; bg: string }> = {
  AR_Oeffen:      { label: 'Außengehwege', Icon: Building2,  color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
  AR_Hof:         { label: 'Hofbereich',   Icon: Building2,  color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
  Gullis:         { label: 'Gullis',       Icon: Waves,      color: 'text-slate-700',   bg: 'bg-slate-100 border-slate-300' },
  Ablaufrinnen:   { label: 'Ablaufrinnen', Icon: Waves,      color: 'text-slate-700',   bg: 'bg-slate-100 border-slate-300' },
  AR_Laub:        { label: 'Laub AR',      Icon: Leaf,       color: 'text-yellow-700',  bg: 'bg-yellow-50 border-yellow-200' },
  Rasen_Fl1:      { label: 'Rasen Fl. 1',  Icon: TreePine,   color: 'text-green-700',   bg: 'bg-green-50 border-green-200' },
  Rasen_Fl2:      { label: 'Rasen Fl. 2',  Icon: TreePine,   color: 'text-green-700',   bg: 'bg-green-50 border-green-200' },
  Gittersteine:   { label: 'Gittersteine', Icon: TreePine,   color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  Gartenpflege:   { label: 'Gartenpflege', Icon: TreePine,   color: 'text-red-700',     bg: 'bg-red-50 border-red-200' },
  Baeume_Pruefen: { label: 'Bäume prüfen', Icon: TreePine,   color: 'text-amber-900',   bg: 'bg-amber-100 border-amber-300' },
  VEG_Laub:       { label: 'Laub VEG',     Icon: Leaf,       color: 'text-yellow-700',  bg: 'bg-yellow-50 border-yellow-200' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatFrequency(freq: string | null | undefined): string {
  if (!freq) return '';
  if (/^\d+xJ$/i.test(freq)) return `${freq.replace(/xJ/i, '')}× / Jahr`;
  if (/^\d+xM$/i.test(freq)) return `${freq.replace(/xM/i, '')}× / Monat`;
  if (/^\d+xW$/i.test(freq)) return `${freq.replace(/xW/i, '')}× / Woche`;
  return freq;
}

function isServiceDue(details: ServiceDetails | undefined, month: string): boolean {
  if (!details?.isActive || !details.months?.length) return false;
  const norm = normalizeMonth(month);
  return details.months.some(m => normalizeMonth(m) === norm);
}

function formatElapsed(clockInDateTime: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(clockInDateTime).getTime()) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatRecording(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Map DB row (snake_case) → app TimeEntry (camelCase)
function dbRowToTimeEntry(row: any): TimeEntry & { jobAssignmentId: string } {
  return {
    id: row.id,
    employeeId: row.employee_id,
    jobAssignmentId: row.job_assignment_id,
    clockInDateTime: row.clock_in_datetime ?? undefined,
    clockOutDateTime: row.clock_out_datetime ?? undefined,
    actualWorkMinutes: row.actual_work_minutes ?? undefined,
    travelBonusMinutes: row.travel_bonus_minutes ?? 0,
    status: row.status,
    gpsVerified: row.gps_verified,
    location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : undefined,
    isManualEntry: row.is_manual_entry,
  };
}

// Map DB row → app JobSite
function dbRowToJobSite(row: any): JobSite {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    companyId: row.company_id,
    postalCode: row.postal_code ?? undefined,
    region: row.region ?? undefined,
    routeCode: row.route_code ?? undefined,
    isRemote: row.is_remote,
    distanceFromHQ: row.distance_from_hq ?? undefined,
    travelTimeFromHQ: row.travel_time_from_hq,
    estimatedTravelTimeMinutesFromHQ: row.estimated_travel_time_minutes_from_hq ?? undefined,
    location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : undefined,
    services: row.services ?? {},
  };
}

function isRemoteSite(site?: JobSite | null) {
  if (!site) return false;
  const distanceFromHQ = Number(site.distanceFromHQ ?? 0);
  const travelTimeFromHQ = Number(site.estimatedTravelTimeMinutesFromHQ ?? site.travelTimeFromHQ ?? 0);
  return site.isRemote || distanceFromHQ >= 50 || travelTimeFromHQ >= 60;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TrackingPage() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isProcessing, setIsProcessing] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [showClockOutConfirm, setShowClockOutConfirm] = useState(false);
  const justClockedInRef = useRef(false);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualClockIn, setManualClockIn] = useState('');
  const [manualClockOut, setManualClockOut] = useState('');


  const { toast } = useToast();
  const { userProfile, isUserLoading } = useAuth();
  const user = userProfile;

  const companyId       = userProfile?.companyId ?? '';
  const effectiveRole   = (userProfile?.role ?? 'WORKER') as UserRole;
  const effectiveUserName = userProfile?.name ?? 'Benutzer';
  const canManageTeam   = effectiveRole === 'LEADER' || effectiveRole === 'ADMIN';
  const hasContext      = !!userProfile && !!companyId;
  const today           = new Date().toISOString().split('T')[0];
  const currentMonth    = GERMAN_MONTHS[currentTime.getMonth()];

  // Tickers
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // GPS Tracking
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocationError('GPS wird nicht unterstützt.');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationError(null); },
      () => setLocationError('Standort konnte nicht ermittelt werden. Bitte aktivieren Sie GPS.'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // ── Assignments ────────────────────────────────────────────────────────────
  const [assignments, setAssignments] = useState<any[]>([]);
  const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(false);
  const [refreshAssignmentsTrigger, setRefreshAssignmentsTrigger] = useState(0);

  const triggerRefreshAssignments = () => setRefreshAssignmentsTrigger(prev => prev + 1);

  useEffect(() => {
    if (!hasContext || !user) return;
    setIsAssignmentsLoading(true);

    const fetchAssignments = () => fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'tracking_assignments',
        table: 'job_assignments',
        companyId: companyId,
        today: today,
        workerId: !canManageTeam ? user.id : undefined,
      }),
    }).then(async (res) => {
      const json = await res.json();
      const data = json.data ?? [];
      setAssignments(data.map((row: any) => ({
        id: row.id,
        companyId: row.company_id,
        jobSiteId: row.job_site_id,
        assignedWorkerIds: row.assigned_worker_ids ?? [],
        scheduledDate: row.scheduled_date,
        title: row.title,
        status: row.status,
        isPlanPublished: row.is_plan_published,
        categories: row.categories ?? [],
      })));
      setIsAssignmentsLoading(false);
    });

    void fetchAssignments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContext, companyId, today, canManageTeam, user?.id, refreshAssignmentsTrigger]);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);

  useEffect(() => {
    if (assignments.length > 0) {
      if (!selectedAssignmentId || !assignments.find(a => a.id === selectedAssignmentId && a.status !== 'COMPLETED')) {
        const inProgress = assignments.find(a => a.status === 'IN_PROGRESS');
        setSelectedAssignmentId(inProgress?.id ?? assignments.find(a => a.status !== 'COMPLETED')?.id ?? null);
      }
    }
  }, [assignments, selectedAssignmentId]);

  const activeAssignment = useMemo(
    () => assignments.find(a => a.id === selectedAssignmentId) ?? null,
    [assignments, selectedAssignmentId],
  );
  const isAllCompleted = !!assignments.length && assignments.every(a => a.status === 'COMPLETED');

  // ── Time Entries ───────────────────────────────────────────────────────────
  const [allTeamEntries, setAllTeamEntries] = useState<(TimeEntry & { jobAssignmentId: string })[]>([]);
  const [refreshEntriesTrigger, setRefreshEntriesTrigger] = useState(0);

  const triggerRefreshEntries = () => setRefreshEntriesTrigger(prev => prev + 1);

  useEffect(() => {
    if (!hasContext || !user || !activeAssignment?.id) return;

    const fetchEntries = async () => {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          table: 'time_entries',
          filters: {
            company_id: companyId,
            ...(canManageTeam
              ? { job_assignment_id: activeAssignment.id }
              : { employee_id: user.id }),
          },
        }),
      });
      const json = await res.json();
      const data = json.data ?? [];
      setAllTeamEntries(data.map(dbRowToTimeEntry));
    };

    void fetchEntries();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContext, companyId, activeAssignment?.id, canManageTeam, user?.id, refreshEntriesTrigger]);

  const openTeamEntries = useMemo(() => {
    const open = allTeamEntries.filter(e => e.status === 'OPEN');
    if (canManageTeam) return open;
    return open.filter(e => e.jobAssignmentId === activeAssignment?.id);
  }, [allTeamEntries, canManageTeam, activeAssignment?.id]);

  const isClockedIn = useMemo(() => {
    if (canManageTeam) return openTeamEntries.length > 0;
    return openTeamEntries.some(e => e.employeeId === user?.id);
  }, [openTeamEntries, canManageTeam, user?.id]);

  const myActiveEntry = useMemo(
    () => openTeamEntries.find(e => e.employeeId === user?.id) ?? null,
    [openTeamEntries, user?.id],
  );

  // ── Job Sites ──────────────────────────────────────────────────────────────
  const { data: jobSitesRaw } = useQuery({
    table: 'job_sites',
    filters: { company_id: companyId },
    enabled: hasContext,
  });

  const jobSites: JobSite[] = useMemo(
    () => (jobSitesRaw ?? []).map(dbRowToJobSite),
    [jobSitesRaw],
  );

  const site = activeAssignment ? jobSites.find(s => s.id === activeAssignment.jobSiteId) : null;

  const dueServices = useMemo(() => {
    if (!site?.services) return [];
    return Object.entries(site.services as Record<string, ServiceDetails>)
      .filter(([, d]) => isServiceDue(d, currentMonth));
  }, [site, currentMonth]);

  // ── Clock In/Out ───────────────────────────────────────────────────────────

  const handleClockIn = async () => {
    if (!activeAssignment || !user || isClockedIn) return;

    let gpsVerified = false;
    if (site?.location && userLocation) {
      const distance = getDistanceFromLatLonInMeters(
        userLocation.lat, userLocation.lng, site.location.lat, site.location.lng,
      );
      if (distance > 300 && !isRemoteSite(site)) {
        toast({ variant: 'destructive', title: 'Zu weit entfernt', description: `Sie sind ${Math.round(distance)}m vom Objekt entfernt.` });
        return;
      }
      gpsVerified = true;
    } else if (site?.location && !userLocation && !isRemoteSite(site)) {
      toast({ variant: 'destructive', title: 'GPS fehlt', description: 'Bitte aktivieren Sie GPS.' });
      return;
    }

    setIsProcessing(true);
    justClockedInRef.current = true;

    try {
      const now = new Date().toISOString();
      const assignedWorkerIds: string[] = Array.isArray(activeAssignment.assignedWorkerIds)
        ? activeAssignment.assignedWorkerIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      const workerIds = canManageTeam
        ? Array.from(new Set([...assignedWorkerIds, user.id]))
        : [user.id];

      if (workerIds.length === 0) {
        toast({ description: 'Keine Mitarbeiter für diesen Einsatz zugewiesen.' });
        return;
      }

      const existingOpenIds = new Set(openTeamEntries.map(e => e.employeeId));
      const newWorkerIds = workerIds.filter(id => !existingOpenIds.has(id));

      if (newWorkerIds.length === 0) {
        toast({ description: 'Das Team ist bereits eingestempelt.' });
        return;
      }

      // Insert time entries for each new worker
      const insertRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'insert',
          table: 'time_entries',
          data: newWorkerIds.map(workerId => ({
            id: `time-${crypto.randomUUID()}`,
            company_id: companyId,
            employee_id: workerId,
            job_assignment_id: activeAssignment.id,
            job_site_id: activeAssignment.jobSiteId ?? null,
            clock_in_datetime: now,
            status: 'OPEN',
            gps_verified: gpsVerified,
            lat: userLocation?.lat ?? null,
            lng: userLocation?.lng ?? null,
            travel_bonus_minutes: 0,
          })),
        }),
      });
      if (!insertRes.ok) { const j = await insertRes.json(); throw new Error(j?.error ?? 'Insert fehlgeschlagen'); }

      // Update assignment status
      const assignmentStatus = activeAssignment.status;
      if (assignmentStatus === 'PENDING' || (canManageTeam && assignmentStatus !== 'COMPLETED')) {
        await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', table: 'job_assignments', filters: { id: activeAssignment.id }, data: { status: 'IN_PROGRESS' } }),
        });
      }

      toast({
        title: canManageTeam ? 'Team eingestempelt' : 'Eingestempelt',
        description: canManageTeam ? `${newWorkerIds.length} Mitarbeiter wurden erfasst.` : 'Schicht gestartet.',
      });
      triggerRefreshEntries();
    } catch (err: any) {
      justClockedInRef.current = false;
      toast({ variant: 'destructive', title: 'Fehler', description: err.message });
    } finally {
      setIsProcessing(false);
      setCooldown(true);
      setTimeout(() => { justClockedInRef.current = false; setCooldown(false); }, 10000);
    }
  };

  const handleClockOutRequest = () => {
    if (justClockedInRef.current) return;
    setShowClockOutConfirm(true);
  };

  const calculateTravelBonus = (targetSite: JobSite | null | undefined) => {
    if (!isRemoteSite(targetSite)) return 0;
    const targetLocation = targetSite?.location;
    if (!targetLocation) return -60;
    const completedToday = assignments.filter(a => a.status === 'COMPLETED');
    for (const prev of completedToday) {
      if (prev.id === activeAssignment?.id) continue;
      const prevSite = jobSites.find(s => s.id === prev.jobSiteId);
      if (prevSite?.location) {
        if (getDistanceFromLatLonInMeters(
          targetLocation.lat, targetLocation.lng,
          prevSite.location.lat, prevSite.location.lng,
        ) <= 25000) return 0;
      }
    }
    return -60;
  };

  const handleClockOutConfirmed = async () => {
    setShowClockOutConfirm(false);
    if (!activeAssignment || !isClockedIn) return;
    setIsProcessing(true);

    try {
      const clockOutTime = new Date().toISOString();
      const entriesToClose = canManageTeam
        ? openTeamEntries
        : openTeamEntries.filter(e => e.employeeId === user?.id);

      const travelBonus = calculateTravelBonus(site);
      let maxMinutes = 0;

      // Update each time entry
      for (const entry of entriesToClose) {
        const start = entry.clockInDateTime ? new Date(entry.clockInDateTime).getTime() : Date.now();
        const mins = Math.round((Date.now() - start) / 60000);
        if (mins > maxMinutes) maxMinutes = mins;

        const updateRes = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            table: 'time_entries',
            filters: { id: entry.id },
            data: {
              clock_out_datetime: clockOutTime,
              actual_work_minutes: mins,
              travel_bonus_minutes: travelBonus,
              status: 'SUBMITTED',
              submission_datetime: new Date().toISOString(),
            },
          }),
        });
        if (!updateRes.ok) { const j = await updateRes.json(); throw new Error(j?.error ?? 'Update fehlgeschlagen'); }
      }

      const remainingOpen = canManageTeam ? [] : openTeamEntries.filter(e => e.employeeId !== user?.id);
      if (remainingOpen.length === 0) {
        await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', table: 'job_assignments', filters: { id: activeAssignment.id }, data: { status: 'COMPLETED' } }),
        });
      }

      toast({
        title: canManageTeam ? 'Schicht abgeschlossen' : 'Ausgestempelt',
        description: canManageTeam
          ? `${entriesToClose.length} Einträge erfasst — Dauer: ${maxMinutes} Min.`
          : `Ihre Schicht wurde erfasst — Dauer: ${maxMinutes} Min.`,
      });
      triggerRefreshEntries();
      triggerRefreshAssignments();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Fehler', description: err.message });
    } finally {
      setIsProcessing(false);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 2000);
    }
  };

  const handleManualEntry = async () => {
    if (!activeAssignment || !user || !manualClockIn || !manualClockOut) {
      toast({ variant: 'destructive', title: 'Fehler', description: 'Bitte füllen Sie Start- und Endzeit aus.' });
      return;
    }

    setIsProcessing(true);
    try {
      const start = new Date(manualClockIn);
      const end = new Date(manualClockOut);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error('Ungültiges Datumsformat.');
      if (end <= start) throw new Error('Das Ende der Schicht muss nach dem Beginn liegen.');
      const now = new Date();
      if (start > now || end > now) throw new Error('Zeiten in der Zukunft sind nicht erlaubt.');

      const mins = Math.round((end.getTime() - start.getTime()) / 60000);
      const assignedWorkerIds: string[] = Array.isArray(activeAssignment.assignedWorkerIds)
        ? activeAssignment.assignedWorkerIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      const workerIds = canManageTeam
        ? Array.from(new Set([...assignedWorkerIds, user.id]))
        : [user.id];

      if (workerIds.length === 0) throw new Error('Keine Mitarbeiter für diesen Eintrag gefunden.');

      const existingEntriesIds = new Set(
        allTeamEntries
          .filter(e => e.status !== 'REJECTED' && e.jobAssignmentId === activeAssignment.id)
          .map(e => e.employeeId),
      );
      const newWorkerIds = workerIds.filter(id => !existingEntriesIds.has(id));

      if (newWorkerIds.length === 0) throw new Error('Für diese Schicht wurden bereits Zeiteinträge erstellt.');

      const travelBonus = calculateTravelBonus(site);

      const manualInsertRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'insert',
          table: 'time_entries',
          data: newWorkerIds.map(workerId => ({
            id: `time-manual-${crypto.randomUUID()}`,
            company_id: companyId,
            employee_id: workerId,
            job_assignment_id: activeAssignment.id,
            job_site_id: activeAssignment.jobSiteId ?? null,
            clock_in_datetime: start.toISOString(),
            clock_out_datetime: end.toISOString(),
            actual_work_minutes: mins,
            travel_bonus_minutes: travelBonus,
            status: 'SUBMITTED',
            submission_datetime: new Date().toISOString(),
            gps_verified: false,
            is_manual_entry: true,
          })),
        }),
      });
      if (!manualInsertRes.ok) { const j = await manualInsertRes.json(); throw new Error(j?.error ?? 'Insert fehlgeschlagen'); }

      if (canManageTeam) {
        await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', table: 'job_assignments', filters: { id: activeAssignment.id }, data: { status: 'COMPLETED' } }),
        });
      }

      toast({
        title: 'Manueller Eintrag erfolgreich',
        description: `Für ${newWorkerIds.length} Mitarbeiter erfasst (${mins} Min. + ${travelBonus} Min. Bonus)`,
      });
      triggerRefreshEntries();
      triggerRefreshAssignments();
      setShowManualEntry(false);
      setManualClockIn('');
      setManualClockOut('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Eintrag fehlgeschlagen', description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Shell userRole={effectiveRole} userName={effectiveUserName}>
      <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-700">

        <div className="text-center space-y-2">
          <div className="text-7xl font-black tracking-tighter tabular-nums text-primary" suppressHydrationWarning>
            {currentTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            <span className="text-3xl opacity-30 ml-2" suppressHydrationWarning>
              :{currentTime.toLocaleTimeString('de-DE', { second: '2-digit' })}
            </span>
          </div>
          <p className="text-muted-foreground font-bold uppercase tracking-widest text-sm" suppressHydrationWarning>
            {currentTime.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>


        {assignments.filter(a => a.status !== 'COMPLETED').length > 1 && (
          <div className="flex gap-3 overflow-x-auto pb-4 snap-x">
            {assignments.filter(a => a.status !== 'COMPLETED').map(a => {
              const s = jobSites.find(site => site.id === a.jobSiteId);
              const isActive = a.id === selectedAssignmentId;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedAssignmentId(a.id)}
                  disabled={isClockedIn && !isActive}
                  className={`snap-center shrink-0 px-5 py-4 rounded-3xl border-2 text-left w-[240px] transition-all duration-300
                    ${isActive
                      ? 'bg-primary text-white border-primary shadow-xl shadow-primary/20 scale-100 ring-4 ring-primary/20'
                      : 'bg-white border-transparent shadow-sm text-foreground hover:bg-gray-50 scale-95 opacity-80'
                    } ${isClockedIn && !isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-white/80' : 'text-primary/60'}`}>
                      {a.status === 'IN_PROGRESS' ? 'Läuft' : 'Ausstehend'}
                    </p>
                    {a.status === 'IN_PROGRESS' && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
                  </div>
                  <p className="font-black text-lg truncate">{s?.name || s?.city || 'Unbekannt'}</p>
                  <p className={`text-xs font-medium truncate mt-1 ${isActive ? 'text-white/70' : 'text-muted-foreground'}`}>
                    {s?.address || 'Keine Adresse'}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        <Card className={`border-none shadow-2xl overflow-hidden transition-all duration-500 rounded-[2.5rem] ${isClockedIn ? 'ring-4 ring-primary bg-primary/5' : 'bg-white'}`}>
          <div className={`h-3 w-full ${isClockedIn ? 'bg-primary' : 'bg-gray-100'}`} />

          <CardHeader className="pb-4 px-8 pt-8">
            <div className="flex items-center justify-between mb-4">
              <Badge variant={isClockedIn ? 'default' : 'secondary'} className="px-4 py-1.5 font-black uppercase text-[10px] tracking-widest">
                {isClockedIn ? 'Im Dienst' : 'Bereit'}
              </Badge>
              {isClockedIn && myActiveEntry?.clockInDateTime && (
                <span className="flex items-center gap-2 text-primary font-black tabular-nums text-sm">
                  <Clock className="w-4 h-4" />
                  {formatElapsed(myActiveEntry.clockInDateTime)}
                </span>
              )}
            </div>
            <CardTitle className="text-3xl font-black text-foreground uppercase tracking-tight">Zeiterfassung</CardTitle>
            <CardDescription className="font-bold text-muted-foreground">
              {isClockedIn ? `Eingestempelt — ${site?.name || site?.city || ''}` : 'Starten Sie Ihre Schicht am Einsatzort.'}
            </CardDescription>
          </CardHeader>

          {isAssignmentsLoading || isUserLoading ? (
            <CardContent className="py-20 flex justify-center">
              <Loader2 className="animate-spin text-primary w-10 h-10" />
            </CardContent>
          ) : activeAssignment && site ? (
            <>
              <CardContent className="px-8 space-y-5">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-primary/8 space-y-5">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-primary/5 rounded-2xl shrink-0">
                      <MapPin className="text-primary w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-primary font-black uppercase tracking-widest mb-1">Aktuelles Objekt</p>
                      <p className="text-xl font-black">{site.name || site.city}</p>
                      <p className="text-xs text-muted-foreground font-medium mt-1">{site.address}, {site.city}</p>
                      {locationError && <p className="text-xs text-destructive font-bold mt-2">{locationError}</p>}
                    </div>
                  </div>

                  <div className="mt-4 rounded-3xl overflow-hidden border border-primary/10 shadow-sm h-48 bg-gray-50 relative">
                    <iframe
                      width="100%" height="100%" style={{ border: 0 }} loading="lazy" allowFullScreen
                      referrerPolicy="no-referrer-when-downgrade"
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(site.address + ', ' + site.city)}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                    />
                  </div>

                  {(activeAssignment.assignedWorkerIds?.length ?? 0) > 0 && (
                    <div className="flex items-center gap-3 px-4 py-3 bg-primary/5 rounded-2xl">
                      <Users className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Team-Einsatz</p>
                        <p className="text-xs font-bold text-muted-foreground">{activeAssignment.assignedWorkerIds.length} Mitarbeiter zugewiesen</p>
                      </div>
                      {openTeamEntries.length > 0 && (
                        <Badge className="text-[9px] font-black bg-green-100 text-green-700 border-none shrink-0">
                          {openTeamEntries.length} aktiv
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="border-t border-dashed pt-4">
                    <p className="text-[10px] text-primary font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                      <Hammer className="w-3.5 h-3.5" /> Zu erledigende Leistungen — {currentMonth.trim()}
                    </p>
                    {dueServices.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {dueServices.map(([key, details]) => {
                          const info = SERVICE_INFO[key];
                          const Icon = info?.Icon ?? Hammer;
                          return (
                            <div key={key} className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl border ${info?.bg ?? 'bg-gray-50 border-gray-200'}`}>
                              <div className={`p-1.5 rounded-xl bg-white/80 border ${info?.bg ?? 'border-gray-200'}`}>
                                <Icon className={`w-3.5 h-3.5 ${info?.color ?? 'text-gray-600'}`} />
                              </div>
                              <div className="min-w-0">
                                <p className={`text-[11px] font-black uppercase ${info?.color ?? 'text-gray-700'}`}>{info?.label ?? key}</p>
                                {formatFrequency((details as ServiceDetails).frequency) && (
                                  <p className="text-[9px] font-bold text-muted-foreground mt-0.5">{formatFrequency((details as ServiceDetails).frequency)}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground font-bold italic py-1">Keine fälligen Leistungen für {currentMonth.trim()}</p>
                    )}
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-4 px-8 pb-8 pt-2">
                <Button
                  size="lg"
                  disabled={isProcessing || cooldown || !hasContext}
                  className={`w-full h-20 text-xl font-black rounded-3xl shadow-xl transition-all active:scale-95 uppercase tracking-tighter
                    ${isClockedIn ? 'bg-destructive hover:bg-destructive/90 shadow-destructive/20' : 'bg-primary hover:bg-primary/90 shadow-primary/20'}`}
                  onClick={isClockedIn ? handleClockOutRequest : handleClockIn}
                >
                  {isProcessing
                    ? <Loader2 className="animate-spin w-8 h-8" />
                    : isClockedIn
                      ? <><Square className="mr-3 h-6 w-6 fill-current" />{canManageTeam ? 'Schicht beenden' : 'Ausgestempelt'}</>
                      : <><Play className="mr-3 h-6 w-6 fill-current" />Jetzt Einstempeln</>
                  }
                </Button>

                {!isClockedIn && (effectiveRole === 'ADMIN' || effectiveRole === 'LEADER') && (
                  <Button
                    variant="outline"
                    className="w-full h-12 rounded-2xl font-black text-primary border-primary/20 hover:bg-primary/5"
                    onClick={() => {
                      const now = new Date();
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const localStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                      setManualClockIn(localStr);
                      setManualClockOut(localStr);
                      setShowManualEntry(true);
                    }}
                  >
                    <Edit className="w-4 h-4 mr-2" /> Zeiteintrag manuell hinzufügen
                  </Button>
                )}

              </CardFooter>
            </>
          ) : (
            <CardContent>
              <div className="py-24 text-center flex flex-col items-center gap-6 bg-muted/20 rounded-[2rem]">
                <Ban className="w-20 h-20 text-muted-foreground/20" />
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-foreground/80 uppercase tracking-tight">Kein aktiver Einsatz</h3>
                  <p className="text-muted-foreground font-bold max-w-xs px-6 uppercase text-[10px] tracking-widest leading-relaxed">
                    Für heute ist kein Tourplan für Sie hinterlegt. Bitte kontaktieren Sie die Zentrale.
                  </p>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        {activeAssignment && (
          <div className="bg-white rounded-[2rem] shadow-xl border-none p-6">
            <NotesPanel
              assignmentId={activeAssignment.id}
              siteId={activeAssignment.jobSiteId ?? null}
              siteName={site?.name}
              companyId={companyId}
              userId={user?.id ?? ''}
              userName={effectiveUserName}
              canAddNotes={isClockedIn && !!myActiveEntry?.id}
              isAdmin={canManageTeam}
              timeEntryId={myActiveEntry?.id ?? null}
            />
          </div>
        )}

        {isAllCompleted && (
          <div className="bg-green-500/10 border-2 border-green-500/20 p-6 rounded-[2rem] flex items-center gap-4 animate-in slide-in-from-bottom-4">
            <CheckCircle2 className="w-10 h-10 text-green-500 shrink-0" />
            <div>
              <p className="font-black text-green-700 uppercase text-xs tracking-widest">Tagesziel erreicht</p>
              <p className="text-green-600/80 text-sm font-bold">Alle Einsätze für heute wurden erfolgreich abgeschlossen.</p>
            </div>
          </div>
        )}
      </div>


      <Dialog open={showManualEntry} onOpenChange={o => !o && setShowManualEntry(false)}>
        <DialogContent aria-describedby="manual-entry-description" className="rounded-[2rem] border-none shadow-2xl p-0 overflow-hidden sm:max-w-md">
          <div className="bg-primary p-6 text-white">
            <DialogTitle className="text-xl font-black uppercase flex items-center gap-3"><Edit className="w-5 h-5" /> Manueller Zeiteintrag</DialogTitle>
            <DialogDescription id="manual-entry-description" className="text-white/60 text-sm font-medium mt-1">Fügen Sie eine Schicht manuell für dieses Objekt hinzu.</DialogDescription>
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Startzeit</label>
              <input type="datetime-local" value={manualClockIn} onChange={e => setManualClockIn(e.target.value)} className="w-full h-12 px-4 rounded-xl border border-primary/20 bg-gray-50 focus:ring-2 focus:ring-primary/20 font-medium" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Endzeit</label>
              <input type="datetime-local" value={manualClockOut} onChange={e => setManualClockOut(e.target.value)} className="w-full h-12 px-4 rounded-xl border border-primary/20 bg-gray-50 focus:ring-2 focus:ring-primary/20 font-medium" />
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <Button variant="outline" onClick={() => { setShowManualEntry(false); setManualClockIn(''); setManualClockOut(''); }} className="rounded-xl font-black">Abbrechen</Button>
              <Button onClick={handleManualEntry} disabled={!manualClockIn || !manualClockOut || isProcessing} className="rounded-xl font-black">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> Speichern</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showClockOutConfirm} onOpenChange={setShowClockOutConfirm}>
        <AlertDialogContent className="rounded-[2rem] border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-black uppercase tracking-tight">
              {effectiveRole === 'LEADER' || effectiveRole === 'ADMIN' ? 'Schicht für alle beenden?' : 'Schicht beenden?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="font-medium text-muted-foreground">
              {effectiveRole === 'LEADER' || effectiveRole === 'ADMIN'
                ? `Dadurch wird die Schicht für ${openTeamEntries.length} Mitarbeiter abgeschlossen und die Aufgabe als erledigt markiert.`
                : 'Ihre Arbeitszeit wird erfasst und die Schicht beendet.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3">
            <AlertDialogCancel className="rounded-2xl font-black">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleClockOutConfirmed} className="rounded-2xl font-black bg-destructive hover:bg-destructive/90">
              <Square className="w-4 h-4 mr-2 fill-current" /> Ja, beenden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
