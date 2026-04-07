import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { apiData } from '@/api/client';
import { COLORS, CATEGORY_LABELS, GPS_RADIUS_METERS } from '@/utils/constants';
import { gpsDistance, formatDuration, formatTime, elapsedMinutes, randomId } from '@/utils/helpers';

interface Assignment { id: string; title: string; status: string; scheduled_date: string; job_site_id: string | null; categories: string[]; }
interface JobSite    {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
  is_remote?: boolean;
  distance_from_hq?: number | null;
  travel_time_from_hq?: number | null;
  estimated_travel_time_minutes_from_hq?: number | null;
}
interface TimeEntry  { id: string; clock_in_datetime: string; status: string; job_assignment_id: string; }

function isRemoteSite(site?: JobSite | null) {
  if (!site) return false;
  const distanceFromHQ = Number(site.distance_from_hq ?? 0);
  const travelTimeFromHQ = Number(site.estimated_travel_time_minutes_from_hq ?? site.travel_time_from_hq ?? 0);
  return !!site.is_remote || distanceFromHQ >= 50 || travelTimeFromHQ >= 60;
}

export default function TrackingScreen() {
  const { user } = useAuth();
  const today    = new Date().toISOString().split('T')[0];

  const [assignments,  setAssignments]  = useState<Assignment[]>([]);
  const [sites,        setSites]        = useState<Record<string, JobSite>>({});
  const [activeEntry,  setActiveEntry]  = useState<TimeEntry | null>(null);
  const [activeAssign, setActiveAssign] = useState<Assignment | null>(null);
  const [elapsed,      setElapsed]      = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [clocking,     setClocking]     = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [gpsStatus,    setGpsStatus]    = useState<'idle' | 'checking' | 'ok' | 'far'>('idle');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const [aRes, sRes, eRes] = await Promise.all([
        apiData<Assignment[]>({ action: 'tracking_assignments', table: 'job_assignments', companyId: user.companyId, today, workerId: user.id }),
        apiData<JobSite[]>({ action: 'query', table: 'job_sites', filters: { company_id: user.companyId } }),
        apiData<TimeEntry[]>({ action: 'query', table: 'time_entries', filters: { employee_id: user.id, status: 'OPEN' } }),
      ]);
      const siteMap: Record<string, JobSite> = {};
      (sRes.data ?? []).forEach(s => { siteMap[s.id] = s; });
      setSites(siteMap);
      setAssignments(aRes.data ?? []);

      const open = (eRes.data ?? [])[0] ?? null;
      setActiveEntry(open);
      if (open) {
        const a = (aRes.data ?? []).find(x => x.id === open.job_assignment_id) ?? null;
        setActiveAssign(a);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, today]);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load])
  );

  // Live timer
  useEffect(() => {
    if (activeEntry) {
      setElapsed(elapsedMinutes(activeEntry.clock_in_datetime));
      timerRef.current = setInterval(() => setElapsed(elapsedMinutes(activeEntry.clock_in_datetime)), 30000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeEntry]);

  const verifyGps = async (site: JobSite): Promise<{ ok: boolean; lat: number; lng: number }> => {
    setGpsStatus('checking');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setGpsStatus('idle');
      return { ok: false, lat: 0, lng: 0 };
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const { latitude: lat, longitude: lng } = pos.coords;
    if (site.lat != null && site.lng != null && !isRemoteSite(site)) {
      const dist = gpsDistance(lat, lng, site.lat, site.lng);
      if (dist > GPS_RADIUS_METERS) {
        setGpsStatus('far');
        Alert.alert('Zu weit entfernt', `Sie sind ${Math.round(dist)}m vom Objekt entfernt. Erlaubt: ${GPS_RADIUS_METERS}m.`);
        return { ok: false, lat, lng };
      }
    }
    setGpsStatus('ok');
    return { ok: true, lat, lng };
  };

  const clockIn = async (assignment: Assignment) => {
    if (!user || clocking) return;
    const site = sites[assignment.job_site_id ?? ''];
    setClocking(true);
    try {
      let lat = 0, lng = 0;
      if (site) {
        const gps = await verifyGps(site);
        if (!gps.ok) return;
        lat = gps.lat; lng = gps.lng;
      }
      const entryId = `te-${randomId()}`;
      await apiData({ action: 'insert', table: 'time_entries', data: {
        id: entryId, company_id: user.companyId, employee_id: user.id,
        job_assignment_id: assignment.id, job_site_id: assignment.job_site_id,
        clock_in_datetime: new Date().toISOString(), status: 'OPEN',
        gps_verified: !!site, lat, lng, travel_bonus_minutes: 0,
      }});
      if (assignment.status === 'PENDING') {
        await apiData({ action: 'update', table: 'job_assignments', filters: { id: assignment.id }, data: { status: 'IN_PROGRESS' } });
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (e: any) {
      Alert.alert('Fehler', e?.message || 'Einstempeln fehlgeschlagen');
    } finally {
      setClocking(false);
    }
  };

  const clockOut = async () => {
    if (!user || !activeEntry || clocking) return;
    const site = sites[activeAssign?.job_site_id ?? ''];
    let travelBonus = 0;
    if (isRemoteSite(site)) {
      const completedToday = assignments.filter(a => a.status === 'COMPLETED');
      let foundNearby = false;
      for (const prev of completedToday) {
        if (prev.id === activeAssign?.id) continue;
        const prevSite = sites[prev.job_site_id ?? ''];
        if (prevSite?.lat != null && prevSite?.lng != null && site.lat != null && site.lng != null) {
          if (gpsDistance(site.lat, site.lng, prevSite.lat, prevSite.lng) <= 25000) {
            foundNearby = true;
            break;
          }
        }
      }
      if (!foundNearby) travelBonus = -60;
    }

    Alert.alert('Ausstempeln', 'Schicht jetzt beenden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Ausstempeln', style: 'destructive', onPress: async () => {
        setClocking(true);
        try {
          const now     = new Date().toISOString();
          const minutes = elapsedMinutes(activeEntry.clock_in_datetime);
          await apiData({ action: 'update', table: 'time_entries', filters: { id: activeEntry.id }, data: {
            clock_out_datetime: now, actual_work_minutes: minutes,
            travel_bonus_minutes: travelBonus,
            status: 'SUBMITTED', submission_datetime: now,
          }});
          
          // Check if there are other open entries for this assignment
          const openEntriesRes = await apiData<TimeEntry[]>({
            action: 'query',
            table: 'time_entries',
            filters: { job_assignment_id: activeEntry.job_assignment_id, status: 'OPEN' }
          });
          const otherOpenEntries = (openEntriesRes.data ?? []).filter(e => e.id !== activeEntry.id);
          
          // If no other workers are currently clocked in, mark assignment as COMPLETED
          if (otherOpenEntries.length === 0) {
            await apiData({
              action: 'update',
              table: 'job_assignments',
              filters: { id: activeEntry.job_assignment_id },
              data: { status: 'COMPLETED' }
            });
          }

          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await load();
        } catch (e: any) {
          Alert.alert('Fehler', e?.message);
        } finally {
          setClocking(false);
        }
      }},
    ]);
  };

  const pendingAssignments = assignments.filter(a => a.status !== 'COMPLETED');

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Zeiterfassung</Text>
        {gpsStatus === 'checking' && <ActivityIndicator color="#fff" size="small" />}
        {gpsStatus === 'ok'  && <Ionicons name="location" size={18} color="#4ade80" />}
        {gpsStatus === 'far' && <Ionicons name="location-outline" size={18} color={COLORS.accent} />}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
      >
        {/* Active shift card */}
        {activeEntry && activeAssign && (
          <View style={styles.activeCard}>
            <View style={styles.activeTop}>
              <View style={styles.pulseOuter}>
                <View style={styles.pulseDot} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.activeLabel}>AKTIVE SCHICHT</Text>
                <Text style={styles.activeSite} numberOfLines={1}>
                  {sites[activeAssign.job_site_id ?? '']?.name ?? activeAssign.title}
                </Text>
                <Text style={styles.activeAddr} numberOfLines={1}>
                  {sites[activeAssign.job_site_id ?? '']?.address}
                </Text>
              </View>
            </View>
            <View style={styles.timerRow}>
              <Ionicons name="time-outline" size={16} color="rgba(255,255,255,0.7)" />
              <Text style={styles.timerText}>
                Eingestempelt: {formatTime(activeEntry.clock_in_datetime)} — {formatDuration(elapsed)} gearbeitet
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.clockOutBtn, clocking && { opacity: 0.6 }]}
              onPress={clockOut}
              disabled={clocking}
              activeOpacity={0.85}
            >
              {clocking
                ? <ActivityIndicator color={COLORS.primary} />
                : <>
                    <Ionicons name="stop-circle-outline" size={20} color={COLORS.primary} />
                    <Text style={styles.clockOutText}>AUSSTEMPELN</Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* Assignment list to clock in */}
        {!activeEntry && (
          <>
            <Text style={styles.sectionTitle}>
              {loading ? 'Laden…' : `${pendingAssignments.length} Einsätze verfügbar`}
            </Text>
            {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />}
            {!loading && pendingAssignments.length === 0 && (
              <View style={styles.emptyBox}>
                <Ionicons name="checkmark-done-circle-outline" size={48} color={COLORS.border} />
                <Text style={styles.emptyText}>Alle Einsätze abgeschlossen</Text>
              </View>
            )}
            {pendingAssignments.map(a => {
              const site = sites[a.job_site_id ?? ''];
              return (
                <View key={a.id} style={styles.assignCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assignName} numberOfLines={1}>{site?.name ?? a.title}</Text>
                    {site && <Text style={styles.assignAddr} numberOfLines={1}>{site.address}, {site.city}</Text>}
                    <View style={styles.catRow}>
                      {a.categories.slice(0, 3).map(c => (
                        <View key={c} style={styles.catChip}>
                          <Text style={styles.catText}>{CATEGORY_LABELS[c] ?? c}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.clockInBtn, clocking && { opacity: 0.6 }]}
                    onPress={() => clockIn(a)}
                    disabled={clocking}
                    activeOpacity={0.85}
                  >
                    {clocking
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <><Ionicons name="play-circle" size={18} color="#fff" /><Text style={styles.clockInText}>START</Text></>
                    }
                  </TouchableOpacity>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },
  header:       {
    backgroundColor: COLORS.primary, paddingTop: 56, paddingBottom: 20,
    paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle:  { color: '#fff', fontSize: 22, fontWeight: '900' },
  activeCard:   {
    backgroundColor: COLORS.primary, borderRadius: 20, padding: 20,
    marginBottom: 20, gap: 14,
    shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  activeTop:    { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pulseOuter:   {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center',
  },
  pulseDot:     { width: 14, height: 14, borderRadius: 7, backgroundColor: '#4ade80' },
  activeLabel:  { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 1.5 },
  activeSite:   { fontSize: 16, fontWeight: '900', color: '#fff', marginTop: 2 },
  activeAddr:   { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  timerRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timerText:    { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  clockOutBtn:  {
    backgroundColor: '#fff', borderRadius: 14, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  clockOutText: { color: COLORS.primary, fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  emptyBox:     { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText:    { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  assignCard:   {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  assignName:   { fontSize: 14, fontWeight: '800', color: COLORS.text },
  assignAddr:   { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  catRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  catChip:      { backgroundColor: `${COLORS.primary}15`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  catText:      { fontSize: 9, fontWeight: '700', color: COLORS.primary },
  clockInBtn:   {
    backgroundColor: COLORS.success, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  clockInText:  { color: '#fff', fontWeight: '900', fontSize: 12 },
});
