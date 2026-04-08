import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { apiData } from '@/api/client';
import { COLORS, CATEGORY_LABELS } from '@/utils/constants';
import { formatDate, formatDateFull, formatTime, elapsedMinutes, formatDuration } from '@/utils/helpers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assignment {
  id: string;
  title: string;
  status: string;
  scheduled_date: string;
  job_site_id: string | null;
  assigned_worker_ids: string[];
  categories: string[];
}

interface JobSite {
  id: string;
  name: string;
  address: string;
  city: string;
}

interface TimeEntry {
  id: string;
  clock_in_datetime: string;
  status: string;
  job_assignment_id: string;
  job_site_id: string | null;
}

interface Worker {
  id: string;
  name: string;
  role: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:     COLORS.warning,
  IN_PROGRESS: '#3b82f6',
  COMPLETED:   COLORS.success,
};
const STATUS_LABEL: Record<string, string> = {
  PENDING:     'Offen',
  IN_PROGRESS: 'Aktiv',
  COMPLETED:   'Fertig',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { user } = useAuth();
  const isManagement = user?.role === 'ADMIN' || user?.role === 'LEADER';

  // Live clock — updates every minute
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const today = now.toISOString().split('T')[0];

  // Timer for active shift
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── State ──
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sites,       setSites]       = useState<Record<string, JobSite>>({});
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [activeAssign, setActiveAssign] = useState<Assignment | null>(null);
  const [workers,     setWorkers]     = useState<Worker[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const resetHomeState = useCallback(() => {
    setAssignments([]);
    setSites({});
    setActiveEntry(null);
    setActiveAssign(null);
    setWorkers([]);
  }, []);

  // ── Load ──
  const load = useCallback(async (silent = false) => {
    if (!user) {
      resetHomeState();
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      if (isManagement) {
        // Compute yesterday (local) for overdue range query
        const [ty, tm, td] = today.split('-').map(Number);
        const yest = new Date(ty, tm - 1, td - 1);
        const yesterday = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;

        // LEADER/ADMIN: query all assignments directly — no is_plan_published filter
        const [todayRes, overdueRes, sRes, wRes] = await Promise.all([
          // Today's assignments (all, regardless of is_plan_published)
          apiData<Assignment[]>({
            action: 'query', table: 'job_assignments',
            filters: { company_id: user.companyId, scheduled_date: today },
          }),
          // Past assignments up to yesterday — filter COMPLETED client-side
          apiData<Assignment[]>({
            action: 'query_range', table: 'job_assignments',
            filters: { company_id: user.companyId },
            rangeFilters: [{ column: 'scheduled_date', lte: yesterday }],
          } as any),
          apiData<JobSite[]>({
            action: 'query', table: 'job_sites',
            filters: { company_id: user.companyId },
          }),
          apiData<Worker[]>({
            action: 'query', table: 'users',
            filters: { company_id: user.companyId },
          }),
        ]);
        const overdueOpen = (overdueRes.data ?? []).filter(a => a.status !== 'COMPLETED');
        setAssignments([...overdueOpen, ...(todayRes.data ?? [])]);
        const map: Record<string, JobSite> = {};
        (sRes.data ?? []).forEach(s => { map[s.id] = s; });
        setSites(map);
        setActiveEntry(null);
        setActiveAssign(null);
        setWorkers((wRes.data ?? []).filter((w: any) => w.role === 'WORKER' || w.role === 'LEADER'));
      } else {
        // WORKER: only their published assignments (today + overdue open)
        const [aRes, sRes, eRes] = await Promise.all([
          apiData<Assignment[]>({
            action:    'tracking_assignments',
            table:     'job_assignments',
            companyId: user.companyId,
            today,
            workerId:  user.id,       // filter to this worker only
          }),
          apiData<JobSite[]>({
            action: 'query', table: 'job_sites',
            filters: { company_id: user.companyId },
          }),
          apiData<TimeEntry[]>({
            action: 'query', table: 'time_entries',
            filters: { employee_id: user.id, status: 'OPEN' },
          }),
        ]);
        setAssignments(aRes.data ?? []);
        const map: Record<string, JobSite> = {};
        (sRes.data ?? []).forEach(s => { map[s.id] = s; });
        setSites(map);
        setWorkers([]);
        const open = (eRes.data ?? [])[0] ?? null;
        setActiveEntry(open);
        const currentAssignments = aRes.data ?? [];
        setActiveAssign(open ? currentAssignments.find(a => a.id === open.job_assignment_id) ?? null : null);
      }
    } catch (e) {
      resetHomeState();
      console.warn('Home load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, today, isManagement, resetHomeState]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(
    useCallback(() => {
      if (!loading) load(true);
    }, [load, loading])
  );

  // ── Active shift timer ──
  useEffect(() => {
    if (activeEntry) {
      setElapsed(elapsedMinutes(activeEntry.clock_in_datetime));
      timerRef.current = setInterval(
        () => setElapsed(elapsedMinutes(activeEntry.clock_in_datetime)),
        30_000,
      );
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeEntry]);

  // ── Derived stats ──
  const todayAssignments    = assignments.filter(a => a.scheduled_date === today);
  const overdueAssignments  = assignments.filter(a => a.scheduled_date < today);
  const completedToday      = todayAssignments.filter(a => a.status === 'COMPLETED').length;
  const inProgressToday     = todayAssignments.filter(a => a.status === 'IN_PROGRESS').length;
  const pendingToday        = todayAssignments.filter(a => a.status === 'PENDING').length;

  const activeSite = activeAssign
    ? sites[activeAssign.job_site_id ?? '']
    : activeEntry?.job_site_id
      ? sites[activeEntry.job_site_id]
      : null;

  // ─── Stats config ──────────────────────────────────────────────────────────
  const stats = isManagement
    ? [
        { label: 'Heute gesamt', value: todayAssignments.length, icon: 'calendar-outline',         color: COLORS.primary },
        { label: 'Abgeschlossen', value: completedToday,         icon: 'checkmark-circle-outline', color: COLORS.success },
        { label: 'Aktiv',         value: inProgressToday,        icon: 'time-outline',             color: '#3b82f6'      },
        { label: 'Überfällig',    value: overdueAssignments.length, icon: 'alert-circle-outline',  color: COLORS.accent  },
      ]
    : [
        { label: 'Meine Einsätze', value: todayAssignments.length, icon: 'list-outline',           color: COLORS.primary },
        { label: 'Erledigt',       value: completedToday,          icon: 'checkmark-circle-outline',color: COLORS.success },
        { label: 'Aktiv',          value: inProgressToday,         icon: 'time-outline',           color: '#3b82f6'      },
        { label: 'Offen',          value: pendingToday,            icon: 'ellipse-outline',        color: COLORS.warning },
      ];

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ══ Header ══ */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <View>
            <Text style={s.greetText}>{greeting()},</Text>
            <Text style={s.userName}>{user?.name?.split(' ')[0]}</Text>
          </View>
          <View style={s.dateChip}>
            <Ionicons name="calendar-outline" size={13} color="#fff" />
            <Text style={s.dateChipText}>{formatDate(today)}</Text>
          </View>
        </View>

        {/* ── Stats row (overlap card) ── */}
        <View style={s.statsRow}>
          {stats.map(st => (
            <View key={st.label} style={s.statCard}>
              <Ionicons name={st.icon as any} size={18} color={st.color} />
              <Text style={[s.statValue, { color: st.color }]}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={COLORS.primary}
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={COLORS.primary} size="large" style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* ══ WORKER: Active Shift card ══ */}
            {!isManagement && activeEntry && (
              <View style={s.activeShiftCard}>
                <View style={s.activeShiftTop}>
                  <View style={s.pulseDotWrap}>
                    <View style={s.pulseDot} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.activeShiftLabel}>AKTIVE SCHICHT</Text>
                    <Text style={s.activeShiftSite} numberOfLines={1}>
                      {activeSite?.name ?? activeAssign?.title ?? 'Unbekannter Einsatz'}
                    </Text>
                    {activeSite && (
                      <Text style={s.activeShiftAddr} numberOfLines={1}>
                        {activeSite.address}, {activeSite.city}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={s.activeShiftTimer}>
                  <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.7)" />
                  <Text style={s.activeShiftTimerText}>
                    Eingestempelt: {formatTime(activeEntry.clock_in_datetime)}
                    {'  ·  '}{formatDuration(elapsed)} gearbeitet
                  </Text>
                </View>
                <TouchableOpacity
                  style={s.goToTrackingBtn}
                  onPress={() => router.push('/(tabs)/tracking')}
                >
                  <Ionicons name="stop-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={s.goToTrackingText}>Ausstempeln →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ══ WORKER: No active shift — quick start ══ */}
            {!isManagement && !activeEntry && pendingToday + inProgressToday > 0 && (
              <TouchableOpacity
                style={s.quickStartCard}
                onPress={() => router.push('/(tabs)/tracking')}
                activeOpacity={0.85}
              >
                <View style={s.quickStartLeft}>
                  <Ionicons name="play-circle" size={32} color={COLORS.success} />
                  <View>
                    <Text style={s.quickStartTitle}>Schicht starten</Text>
                    <Text style={s.quickStartSub}>
                      {pendingToday + inProgressToday} Einsatz{pendingToday + inProgressToday !== 1 ? 'e' : ''} warten
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
              </TouchableOpacity>
            )}

            {/* ══ LEADER: Routen-Übersicht card ══ */}
            {isManagement && (
              <View style={s.leaderCard}>
                <View style={s.leaderCardHeader}>
                  <Ionicons name="bar-chart-outline" size={16} color="#fff" />
                  <Text style={s.leaderCardTitle}>ROUTEN-ÜBERSICHT — HEUTE</Text>
                </View>
                <View style={s.leaderStats}>
                  {[
                    { label: 'Abgeschlossen', value: completedToday,            color: '#4ade80' },
                    { label: 'In Bearbeitung', value: inProgressToday,          color: '#60a5fa' },
                    { label: 'Ausstehend',     value: pendingToday,             color: '#fbbf24' },
                    { label: 'Mitarbeiter',    value: workers.length,           color: '#c084fc' },
                  ].map(({ label, value, color }) => (
                    <View key={label} style={s.leaderStatRow}>
                      <Text style={s.leaderStatLabel}>{label}</Text>
                      <Text style={[s.leaderStatValue, { color }]}>{value}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  style={s.leaderActionBtn}
                  onPress={() => router.push('/(tabs)/planning')}
                >
                  <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                  <Text style={s.leaderActionText}>Einsatz planen</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ══ Overdue section ══ */}
            {overdueAssignments.length > 0 && (
              <>
                <SectionHeader
                  icon="alert-circle"
                  title={`ÜBERFÄLLIG (${overdueAssignments.length})`}
                  color={COLORS.accent}
                />
                {overdueAssignments.map(a => (
                  <AssignmentCard
                    key={a.id}
                    assignment={a}
                    site={sites[a.job_site_id ?? '']}
                    isManagement={isManagement}
                    workerCount={a.assigned_worker_ids?.length ?? 0}
                  />
                ))}
              </>
            )}

            {/* ══ Today's assignments ══ */}
            <SectionHeader
              icon="today-outline"
              title={`HEUTE — ${formatDateFull(today)}`}
              color={COLORS.primary}
            />
            {todayAssignments.length === 0 ? (
              <View style={s.emptyBox}>
                <Ionicons name="checkmark-done-circle-outline" size={52} color={COLORS.border} />
                <Text style={s.emptyTitle}>Keine Einsätze für heute</Text>
                {isManagement && (
                  <TouchableOpacity
                    style={s.emptyAction}
                    onPress={() => router.push('/(tabs)/planning')}
                  >
                    <Text style={s.emptyActionText}>Einsatz planen</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              todayAssignments.map(a => (
                <AssignmentCard
                  key={a.id}
                  assignment={a}
                  site={sites[a.job_site_id ?? '']}
                  isManagement={isManagement}
                  workerCount={a.assigned_worker_ids?.length ?? 0}
                  isActive={a.id === activeEntry?.job_assignment_id}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title, color }: { icon: string; title: string; color: string }) {
  return (
    <View style={s.sectionHeader}>
      <Ionicons name={icon as any} size={13} color={color} />
      <Text style={[s.sectionTitle, { color }]}>{title}</Text>
    </View>
  );
}

function AssignmentCard({
  assignment: a, site, isManagement, workerCount, isActive = false,
}: {
  assignment: Assignment;
  site?: JobSite;
  isManagement: boolean;
  workerCount: number;
  isActive?: boolean;
}) {
  const statusColor = STATUS_COLOR[a.status] ?? COLORS.textMuted;
  const isOverdue   = a.scheduled_date < new Date().toISOString().split('T')[0];

  return (
    <View style={[s.assignCard, isActive && s.assignCardActive]}>
      {/* Left status bar */}
      <View style={[s.assignBar, { backgroundColor: statusColor }]} />

      <View style={s.assignBody}>
        {/* Title + Status */}
        <View style={s.assignTitleRow}>
          <Text style={s.assignTitle} numberOfLines={1}>
            {site?.name ?? a.title}
          </Text>
          <View style={[s.statusBadge, { backgroundColor: `${statusColor}20` }]}>
            {isActive && (
              <View style={[s.activeDot, { backgroundColor: statusColor }]} />
            )}
            <Text style={[s.statusBadgeText, { color: statusColor }]}>
              {STATUS_LABEL[a.status] ?? a.status}
            </Text>
          </View>
        </View>

        {/* Address */}
        {site && (
          <View style={s.metaRow}>
            <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
            <Text style={s.metaText} numberOfLines={1}>
              {site.address}, {site.city}
            </Text>
          </View>
        )}

        {/* Date (if overdue) + worker count for management */}
        <View style={s.assignFooter}>
          {isOverdue && (
            <View style={s.overdueChip}>
              <Ionicons name="alert-circle" size={10} color={COLORS.accent} />
              <Text style={s.overdueText}>{formatDate(a.scheduled_date)}</Text>
            </View>
          )}
          {isManagement && workerCount > 0 && (
            <View style={s.workerCountChip}>
              <Ionicons name="people-outline" size={11} color={COLORS.textMuted} />
              <Text style={s.workerCountText}>{workerCount} Person{workerCount !== 1 ? 'en' : ''}</Text>
            </View>
          )}
          {/* Categories */}
          {a.categories?.length > 0 &&
            a.categories.slice(0, 2).map(c => (
              <View key={c} style={s.catChip}>
                <Text style={s.catText}>{CATEGORY_LABELS[c] ?? c}</Text>
              </View>
            ))}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll:    { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },

  // ── Header
  header: {
    backgroundColor: COLORS.primary,
    paddingTop: 56,
    paddingBottom: 52,        // extra space for the stats overlap
    paddingHorizontal: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 20,
  },
  greetText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  userName: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 2,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dateChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // ── Stats
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
    position: 'absolute',
    bottom: -36,
    left: 16,
    right: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, textAlign: 'center', textTransform: 'uppercase' },

  // ── Active shift
  activeShiftCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    padding: 18,
    marginTop: 44,
    marginBottom: 12,
    gap: 12,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  activeShiftTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pulseDotWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  pulseDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#4ade80' },
  activeShiftLabel: {
    fontSize: 9, fontWeight: '900', color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  activeShiftSite:  { fontSize: 16, fontWeight: '900', color: '#fff', marginTop: 2 },
  activeShiftAddr:  { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  activeShiftTimer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeShiftTimerText: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  goToTrackingBtn: {
    backgroundColor: '#fff', borderRadius: 12,
    height: 46, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  goToTrackingText: { color: COLORS.primary, fontWeight: '900', fontSize: 14 },

  // ── Quick start
  quickStartCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 44,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: `${COLORS.success}40`,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  quickStartLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quickStartTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  quickStartSub:   { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // ── Leader card
  leaderCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 44,
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  leaderCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
  },
  leaderCardTitle: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  leaderStats: { paddingHorizontal: 18, gap: 6, paddingBottom: 14 },
  leaderStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  leaderStatLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  leaderStatValue: { fontSize: 18, fontWeight: '900' },
  leaderActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    margin: 14,
    marginTop: 4,
    borderRadius: 12,
    paddingVertical: 13,
  },
  leaderActionText: { color: COLORS.primary, fontWeight: '900', fontSize: 13 },

  // ── Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // ── Assignment cards
  assignCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 10,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  assignCardActive: {
    borderWidth: 1.5,
    borderColor: `${COLORS.success}50`,
    shadowColor: COLORS.success,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  assignBar: { width: 5 },
  assignBody: { flex: 1, padding: 14 },
  assignTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  assignTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { fontSize: 10, fontWeight: '800' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  metaText: { fontSize: 11, color: COLORS.textMuted, flex: 1 },

  assignFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  overdueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${COLORS.accent}15`,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  overdueText: { fontSize: 9, fontWeight: '800', color: COLORS.accent },
  workerCountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  workerCountText: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted },
  catChip: {
    backgroundColor: `${COLORS.primary}15`,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  catText: { fontSize: 9, fontWeight: '700', color: COLORS.primary },

  // ── Empty state
  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  emptyAction: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  emptyActionText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
