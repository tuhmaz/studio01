import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { COLORS, categoryLabel, GPS_RADIUS_METERS } from '@/utils/constants';
import { gpsDistance, formatDuration, formatTime, elapsedMinutes } from '@/utils/helpers';
import { ChecklistModal } from '@/components/Checklist';
import { fetchWinterSites, queuedEntries } from '@/api/winter';
import {
  clockIn as submitClockIn, clockOut as submitClockOut, loadChecklist, loadTracking,
  type Assignment, type JobSite, type TimeEntry,
} from '@/sync/field';
import { useSync } from '@/sync/SyncContext';

function isRemoteSite(site?: JobSite | null) {
  if (!site) return false;
  const distanceFromHQ = Number(site.distance_from_hq ?? 0);
  const travelTimeFromHQ = Number(site.estimated_travel_time_minutes_from_hq ?? site.travel_time_from_hq ?? 0);
  return !!site.is_remote || distanceFromHQ >= 50 || travelTimeFromHQ >= 60;
}

export default function TrackingScreen() {
  const { user } = useAuth();
  const { lastSyncAt } = useSync();

  const [assignments,  setAssignments]  = useState<Assignment[]>([]);
  const [sites,        setSites]        = useState<Record<string, JobSite>>({});
  const [activeEntry,  setActiveEntry]  = useState<TimeEntry | null>(null);
  const [activeAssign, setActiveAssign] = useState<Assignment | null>(null);
  const [elapsed,      setElapsed]      = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [clocking,     setClocking]     = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [gpsStatus,    setGpsStatus]    = useState<'idle' | 'checking' | 'ok' | 'far'>('idle');
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistProgress, setChecklistProgress] = useState<{ done: number; total: number } | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      // Online vom Server, sonst gespeicherter Stand – jeweils mit noch nicht
      // gesendeten Vorgängen (z. B. offline eingestempelt) überlagert.
      const data = await loadTracking(user);
      setSites(data.sites);
      setAssignments(data.assignments);
      setOfflineSince(data.offline ? data.savedAt : null);
      setActiveEntry(data.activeEntry);
      setActiveAssign(data.activeEntry
        ? data.assignments.find(x => x.id === data.activeEntry?.job_assignment_id) ?? null
        : null);
    } catch (e: any) {
      console.warn('Tracking load error', e);
      setErrorMsg(e.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Nach dem Senden des Postausgangs die echten Serverdaten zeigen.
  useEffect(() => { if (lastSyncAt) void load(true); }, [lastSyncAt, load]);

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

      // Ein Vorgang für das ganze Team; ohne Netz wartet er auf dem Handy
      // (mit der Uhrzeit von jetzt) und wird später gesendet.
      const result = await submitClockIn(user, assignment, site?.name ?? assignment.title, {
        lat: site ? lat : null,
        lng: site ? lng : null,
        verified: !!site,
      });
      if (result === 'queued') {
        Alert.alert('Offline eingestempelt', 'Kein Netz – die Einstempelzeit ist auf dem Handy gespeichert und wird automatisch gesendet.');
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (e: any) {
      Alert.alert('Fehler', e?.message || 'Einstempeln fehlgeschlagen');
    } finally {
      setClocking(false);
    }
  };

  /** Winterdienst-Einsatz ohne Eintrag im Streuprotokoll? (offline gespeicherte zählen mit) */
  const winterProtocolMissing = async (): Promise<boolean> => {
    const siteId = activeAssign?.job_site_id;
    if (!siteId || !activeAssign?.categories.includes('WINTERDIENST')) return false;
    const today = new Date().toDateString();
    const queued = (await queuedEntries()).some(e => e.siteId === siteId && new Date(e.performedAt).toDateString() === today);
    if (queued) return false;
    try {
      const winterSite = (await fetchWinterSites()).find(w => w.id === siteId);
      return !!winterSite && winterSite.entries_today === 0;
    } catch {
      return false; // offline: nicht blockieren
    }
  };

  const openWinterEntry = () => {
    if (activeAssign?.job_site_id) router.push({ pathname: '/(tabs)/winter', params: { siteId: activeAssign.job_site_id } });
  };

  /** Leistungen der Checkliste ohne Rückmeldung (offline: keine Warnung). */
  const openChecklistItems = async (): Promise<string[]> => {
    if (!activeAssign || !activeAssign.categories.some(c => c !== 'WINTERDIENST')) return [];
    try {
      if (!user) return [];
      const data = await loadChecklist(user, activeAssign.id);
      return data.items
        .filter(i => i.check?.status !== 'done' && i.check?.status !== 'not_possible')
        .map(i => i.label);
    } catch {
      return [];
    }
  };

  const clockOut = async () => {
    if (!user || !activeEntry || clocking) return;
    const open = await openChecklistItems();
    if (open.length) {
      Alert.alert(
        `${open.length} Leistung${open.length === 1 ? '' : 'en'} ohne Rückmeldung`,
        `${open.join(', ')}\n\nIm Leistungsnachweis steht sonst „keine Rückmeldung“.`,
        [
          { text: 'Zur Checkliste', onPress: () => setChecklistOpen(true) },
          { text: 'Trotzdem ausstempeln', style: 'destructive', onPress: () => { void clockOutAfterChecklist(); } },
        ],
      );
      return;
    }
    await clockOutAfterChecklist();
  };

  const clockOutAfterChecklist = async () => {
    if (await winterProtocolMissing()) {
      Alert.alert(
        'Winterdienst nicht protokolliert',
        'Für dieses Objekt gibt es heute noch keinen Eintrag im Streuprotokoll. Ohne Eintrag fehlt der Nachweis.',
        [
          { text: 'Jetzt erfassen', onPress: openWinterEntry },
          { text: 'Trotzdem ausstempeln', style: 'destructive', onPress: () => { void confirmClockOut(); } },
        ],
      );
      return;
    }
    await confirmClockOut();
  };

  const confirmClockOut = async () => {
    if (!user || !activeEntry) return;
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

    Alert.alert('Ausstempeln', 'Schicht für alle Mitarbeiter beenden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Ausstempeln', style: 'destructive', onPress: async () => {
        setClocking(true);
        try {
          // Server schließt alle offenen Einträge des Einsatzes und rechnet die
          // Minuten aus Ein- und Ausstempelzeit – auch wenn erst später gesendet.
          const result = await submitClockOut(user, activeEntry.job_assignment_id, site?.name ?? activeAssign?.title ?? 'Einsatz', travelBonus);
          if (result === 'queued') {
            Alert.alert('Offline ausgestempelt', 'Kein Netz – die Ausstempelzeit ist gespeichert und wird automatisch gesendet.');
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
        {errorMsg ? (
          <View style={{ backgroundColor: '#fee2e2', padding: 16, marginBottom: 16, borderRadius: 8 }}>
            <Text style={{ color: '#b91c1c', textAlign: 'center', fontWeight: 'bold' }}>
              Fehler beim Laden: {errorMsg}
            </Text>
            <TouchableOpacity onPress={() => load()} style={{ marginTop: 12, backgroundColor: '#b91c1c', padding: 8, borderRadius: 6 }}>
              <Text style={{ color: 'white', textAlign: 'center' }}>Erneut versuchen</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {offlineSince && (
          <View style={styles.offlineNote}>
            <Ionicons name="cloud-offline-outline" size={16} color="#92400e" />
            <Text style={styles.offlineNoteText}>
              Offline – gespeicherter Stand von {formatTime(offlineSince)}. Ein-/Ausstempeln, Checkliste und Notizen funktionieren und werden später gesendet.
            </Text>
          </View>
        )}

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
            {activeEntry.pending && (
              <View style={styles.timerRow}>
                <Ionicons name="cloud-upload-outline" size={16} color="#fde68a" />
                <Text style={[styles.timerText, { color: '#fde68a' }]}>Auf dem Handy gespeichert – wird gesendet, sobald Netz da ist</Text>
              </View>
            )}
            {activeAssign.categories.includes('WINTERDIENST') && activeAssign.job_site_id && (
              <TouchableOpacity style={styles.checklistBtn} onPress={openWinterEntry} activeOpacity={0.85}>
                <Ionicons name="snow-outline" size={20} color="#fff" />
                <Text style={styles.checklistText}>Winterdienst erfassen</Text>
              </TouchableOpacity>
            )}
            {activeAssign.categories.some(c => c !== 'WINTERDIENST') && (
              <TouchableOpacity style={styles.checklistBtn} onPress={() => setChecklistOpen(true)} activeOpacity={0.85}>
                <Ionicons name="list-circle-outline" size={20} color="#fff" />
                <Text style={styles.checklistText}>
                  Checkliste{checklistProgress ? ` (${checklistProgress.done}/${checklistProgress.total})` : ''}
                </Text>
              </TouchableOpacity>
            )}
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

        {checklistOpen && activeAssign && (
          <ChecklistModal
            assignmentId={activeAssign.id}
            onClose={(done, total) => { setChecklistOpen(false); if (total) setChecklistProgress({ done, total }); }}
          />
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
                          <Text style={styles.catText}>{categoryLabel(c)}</Text>
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
  checklistBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 12, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.18)' },
  checklistText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  container:    { flex: 1, backgroundColor: COLORS.bg },
  header:       {
    backgroundColor: COLORS.primary, paddingTop: 56, paddingBottom: 20,
    paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle:  { color: '#fff', fontSize: 22, fontWeight: '900' },
  offlineNote:  { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#fef3c7', borderRadius: 12, padding: 12, marginBottom: 14 },
  offlineNoteText: { flex: 1, color: '#92400e', fontSize: 12, fontWeight: '600', lineHeight: 17 },
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
