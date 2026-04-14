import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, PanResponder, Modal,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { apiData, apiFetch } from '@/api/client';
import { SERVER_KEY, DEFAULT_URL } from '@/api/client';
import { COLORS } from '@/utils/constants';
import { formatDuration, formatDate } from '@/utils/helpers';

interface MonthEntry {
  actual_work_minutes: number;
  clock_in_datetime: string;
  clock_out_datetime?: string | null;
  travel_bonus_minutes: number | null;
  status: string;
  job_site_id: string | null;
  job_assignment_id?: string | null;
}
interface SiteInfo { id: string; is_remote: boolean; distance_from_hq: number | null; }
interface AssignmentInfo { id: string; job_site_id: string | null; }
type Point = { x: number; y: number };

// ─── SVG-Konvertierung ────────────────────────────────────────────────────────

const PAD_W = 340;
const PAD_H = 160;

/** Weighted 3-point average to reduce jitter */
function smoothPoints(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push({
      x: (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4,
      y: (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4,
    });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function getSvgPathFromStroke(stroke: Point[]) {
  if (!stroke || stroke.length === 0) return '';
  if (stroke.length === 1) {
    const p = stroke[0];
    return `M${p.x.toFixed(1)},${p.y.toFixed(1)} L${(p.x + 0.5).toFixed(1)},${p.y.toFixed(1)}`;
  }
  const pts = smoothPoints(stroke);
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let p0 = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i];
    const mx = ((p0.x + p1.x) / 2).toFixed(1);
    const my = ((p0.y + p1.y) / 2).toFixed(1);
    d += ` Q ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} ${mx} ${my}`;
    p0 = p1;
  }
  d += ` L ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`;
  return d;
}

function strokesToSvg(strokes: Point[][]): string {
  const paths = strokes
    .filter(s => s.length > 0)
    .map(getSvgPathFromStroke)
    .join(' ');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAD_W}" height="${PAD_H}" ` +
    `viewBox="0 0 ${PAD_W} ${PAD_H}">` +
    `<rect width="${PAD_W}" height="${PAD_H}" fill="white"/>` +
    `<path d="${paths}" fill="none" stroke="#000000" stroke-width="3" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

function svgToDataUrl(svg: string): string {
  // btoa is available as a global in React Native
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// ─── Signature Pad Modal ──────────────────────────────────────────────────────

function SignaturePadModal({
  visible,
  onSave,
  onCancel,
}: {
  visible: boolean;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const [strokes,    setStrokes]    = useState<Point[][]>([]);
  const [current,    setCurrent]    = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: PAD_W, h: PAD_H });
  const lastPt = useRef<Point | null>(null);

  const allPoints = [...strokes, current];

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        lastPt.current = { x, y };
        setCurrent([{ x, y }]);
      },
      onPanResponderMove: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        const last = lastPt.current;
        if (last) {
          const dx = x - last.x, dy = y - last.y;
          if (dx * dx + dy * dy < 9) return; // skip points < 3 px apart
        }
        lastPt.current = { x, y };
        setCurrent(prev => [...prev, { x, y }]);
      },
      onPanResponderRelease: () => {
        lastPt.current = null;
        setCurrent(prev => {
          if (prev.length > 0) setStrokes(s => [...s, prev]);
          return [];
        });
      },
    })
  ).current;

  const handleClear = () => { setStrokes([]); setCurrent([]); lastPt.current = null; };

  const handleSave = () => {
    const allStrokes = strokes.filter(s => s.length > 0);
    if (allStrokes.length === 0) {
      Alert.alert('Keine Unterschrift', 'Bitte zuerst unterschreiben.');
      return;
    }
    // Normalize touch coords → PAD_W × PAD_H for consistent PDF output
    const sx = PAD_W / canvasSize.w;
    const sy = PAD_H / canvasSize.h;
    const normalized = allStrokes.map(s => s.map(p => ({ x: p.x * sx, y: p.y * sy })));
    onSave(svgToDataUrl(strokesToSvg(normalized)));
  };

  useEffect(() => {
    if (visible) { setStrokes([]); setCurrent([]); lastPt.current = null; }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={pad.overlay}>
        <View style={pad.sheet}>

          {/* Header */}
          <View style={pad.header}>
            <Text style={pad.title}>Unterschrift</Text>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <Text style={pad.hint}>Unterschreiben Sie im weißen Feld unten</Text>

          {/* Drawing area */}
          <View
            style={pad.canvas}
            {...panResponder.panHandlers}
            collapsable={false}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              if (w > 0 && h > 0) setCanvasSize({ w, h });
            }}
          >
            {/* viewBox matches actual canvas pixel size — no distortion */}
            <Svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
              pointerEvents="none"
            >
              {allPoints.filter(s => s.length > 0).map((stroke, i) => (
                <Path
                  key={i}
                  d={getSvgPathFromStroke(stroke)}
                  fill="none"
                  stroke="#1a1a2e"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>

            {strokes.length === 0 && current.length === 0 && (
              <Text style={[pad.placeholder, { pointerEvents: 'none' }]}>Hier unterschreiben ↓</Text>
            )}
          </View>

          {/* Actions */}
          <View style={pad.actions}>
            <TouchableOpacity style={pad.clearBtn} onPress={handleClear}>
              <Ionicons name="refresh-outline" size={16} color={COLORS.textMuted} />
              <Text style={pad.clearText}>Löschen</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pad.saveBtn} onPress={handleSave}>
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={pad.saveBtnText}>Speichern</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

// ─── Profile Screen ───────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [entries,       setEntries]       = useState<MonthEntry[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [serverUrl,     setServerUrl]     = useState('');
  const [editServer,    setEditServer]    = useState(false);
  const [tempUrl,       setTempUrl]       = useState('');
  const [hasSig,        setHasSig]        = useState(false);
  const [sigPadOpen,    setSigPadOpen]    = useState(false);
  const [savingSig,     setSavingSig]     = useState(false);
  const [siteMap,       setSiteMap]       = useState<Map<string, SiteInfo>>(new Map());
  const [assignmentSiteMap, setAssignmentSiteMap] = useState<Map<string, string>>(new Map());
  const [rolloverMinutes, setRolloverMinutes] = useState(0); // Übertrag aus letzter Abrechnung

  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    const url = await SecureStore.getItemAsync(SERVER_KEY) || DEFAULT_URL;
    setServerUrl(url);
    if (!silent) setLoading(true);
    try {
      // Load time entries
      const prevM = month === 0 ? 11 : month - 1;
      const prevY = month === 0 ? year - 1 : year;
      const start = `${prevY}-${String(prevM + 1).padStart(2, '0')}-21T00:00:00.000Z`;
      const end   = `${year}-${String(month + 1).padStart(2, '0')}-20T23:59:59.999Z`;
      const periodStart = `${prevY}-${String(prevM + 1).padStart(2, '0')}-21`;
      const [entriesRes, userRes, sitesRes, assignmentsRes, rolloverRes] = await Promise.all([
        apiData<MonthEntry[]>({
          action: 'query_range', table: 'time_entries',
          filters: { employee_id: user.id, company_id: user.companyId },
          rangeFilters: [{ column: 'clock_in_datetime', gte: start, lte: end }],
          orderBy: { column: 'clock_in_datetime', ascending: false },
        }),
        apiData<{ signature_data: string | null }[]>({
          action: 'query', table: 'users',
          filters: { id: user.id },
          select: 'signature_data',
        }),
        apiData<SiteInfo[]>({
          action: 'query', table: 'job_sites',
          filters: { company_id: user.companyId },
          select: 'id,is_remote,distance_from_hq',
        }),
        apiData<AssignmentInfo[]>({
          action: 'query', table: 'job_assignments',
          filters: { company_id: user.companyId },
          select: 'id,job_site_id',
        }),
        apiFetch<{ data: { rollover_minutes: number } | null }>('/api/payroll', {
          method: 'POST',
          body: { action: 'prev_rollover', companyId: user.companyId, employeeId: user.id, beforePeriodStart: periodStart },
        }).catch(() => ({ data: null })),
      ]);
      const siteMap = new Map<string, SiteInfo>();
      (sitesRes.data ?? []).forEach((s: SiteInfo) => siteMap.set(s.id, s));
      const assignmentMap = new Map<string, string>();
      (assignmentsRes.data ?? []).forEach((a: AssignmentInfo) => {
        if (a.id && a.job_site_id) assignmentMap.set(a.id, a.job_site_id);
      });
      setEntries(
        (entriesRes.data ?? []).filter((e: MonthEntry) =>
          !!e.clock_in_datetime &&
          (e.status === 'SUBMITTED' || e.status === 'APPROVED')
        )
      );
      setSiteMap(siteMap);
      setAssignmentSiteMap(assignmentMap);
      setRolloverMinutes(rolloverRes.data?.rollover_minutes ?? 0);
      const sigData = (userRes.data ?? [])[0]?.signature_data;
      setHasSig(!!sigData);
    } finally { setLoading(false); }
  }, [user, month, year]);

  useFocusEffect(
    useCallback(() => { load(true); }, [load])
  );

  // Same logic as web computeMonthlyStats
  const entryMinutes = (entry: MonthEntry): number => {
    if (typeof entry.actual_work_minutes === 'number' && Number.isFinite(entry.actual_work_minutes)) {
      return Math.max(0, Math.round(entry.actual_work_minutes));
    }
    if (entry.clock_in_datetime && entry.clock_out_datetime) {
      const start = new Date(entry.clock_in_datetime).getTime();
      const end = new Date(entry.clock_out_datetime).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return Math.round((end - start) / 60000);
      }
    }
    return 0;
  };
  const totalMinutes  = entries.reduce((s, e) => s + entryMinutes(e), 0);
  const bonusPerDay = new Map<string, number>();
  entries.forEach(e => {
    const day    = e.clock_in_datetime.split('T')[0];
    const stored = e.travel_bonus_minutes ?? 0;
    const resolvedSiteId =
      e.job_site_id ??
      (e.job_assignment_id ? assignmentSiteMap.get(e.job_assignment_id) ?? null : null);
    const site = resolvedSiteId ? siteMap.get(resolvedSiteId) : null;
    const isFar  = stored !== 0
      ? true
      : ((site?.is_remote ?? false) || Number(site?.distance_from_hq ?? 0) >= 95);
    if (!isFar) return;
    const prev = bonusPerDay.get(day) ?? 0;
    bonusPerDay.set(day, Math.max(-60, prev + (stored !== 0 ? stored : -60)));
  });
  const totalBonusMin = Array.from(bonusPerDay.values()).reduce((s, v) => s + v, 0);

  const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const prevMonth   = month === 0 ? 11 : month - 1;
  const prevYear    = month === 0 ? year - 1 : year;
  const periodLabel = `21. ${MONTH_NAMES[prevMonth]} – 20. ${MONTH_NAMES[month]} ${year}`;

  const handleSaveServer = async () => {
    await SecureStore.setItemAsync(SERVER_KEY, tempUrl.trim());
    setServerUrl(tempUrl.trim());
    setEditServer(false);
    Alert.alert('Gespeichert', 'Server-URL wurde aktualisiert. Bitte neu anmelden.');
  };

  const handleLogout = () => {
    Alert.alert('Abmelden', 'Wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: logout },
    ]);
  };

  const handleSaveSignature = async (dataUrl: string) => {
    if (!user) return;
    setSigPadOpen(false);
    setSavingSig(true);
    try {
      await apiData({
        action: 'update', table: 'users',
        filters: { id: user.id },
        data: { signature_data: dataUrl },
      });
      setHasSig(true);
      Alert.alert('Gespeichert', 'Ihre Unterschrift wurde erfolgreich gespeichert.');
    } catch {
      Alert.alert('Fehler', 'Unterschrift konnte nicht gespeichert werden.');
    } finally {
      setSavingSig(false);
    }
  };

  const handleDeleteSignature = () => {
    Alert.alert(
      'Unterschrift löschen',
      'Möchten Sie Ihre Unterschrift wirklich löschen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen', style: 'destructive',
          onPress: async () => {
            setSavingSig(true);
            try {
              await apiData({
                action: 'update', table: 'users',
                filters: { id: user!.id },
                data: { signature_data: null },
              });
              setHasSig(false);
            } finally { setSavingSig(false); }
          },
        },
      ]
    );
  };

  const roleLabel = user?.role === 'ADMIN' ? 'Administrator' : user?.role === 'LEADER' ? 'Teamleiter' : 'Mitarbeiter';
  const initials  = user?.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) ?? '?';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
        <View>
          <Text style={styles.userName}>{user?.name}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{roleLabel}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        {/* Monthly summary */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="bar-chart-outline" size={16} color={COLORS.primary} />
            <Text style={styles.cardTitle}>{periodLabel}</Text>
          </View>
          {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} /> : (
            <React.Fragment>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{entries.length}</Text>
                  <Text style={styles.statLabel}>Einsätze</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{formatDuration(totalMinutes + totalBonusMin)}</Text>
                  <Text style={styles.statLabel}>Vergütete Zeit</Text>
                  {totalBonusMin < 0 && (
                    <Text style={styles.statSub}>-{formatDuration(-totalBonusMin)} Fahrzeit</Text>
                  )}
                </View>
                {rolloverMinutes > 0 && (
                  <View style={styles.statDivider} />
                )}
                {rolloverMinutes > 0 && (
                  <View style={styles.stat}>
                    <Text style={[styles.statValue, { color: '#d97706' }]}>
                      +{formatDuration(rolloverMinutes)}
                    </Text>
                    <Text style={styles.statLabel}>Übertrag</Text>
                    <Text style={styles.statSub}>aus Vormonat</Text>
                  </View>
                )}
              </View>
              {rolloverMinutes > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, backgroundColor: '#fef3c7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Ionicons name="refresh-circle-outline" size={15} color="#d97706" />
                  <Text style={{ fontSize: 12, color: '#92400e', fontWeight: '600' }}>
                    {formatDuration(rolloverMinutes)} werden auf diesen Monat übertragen
                  </Text>
                </View>
              )}
            </React.Fragment>
          )}

          {/* Recent entries */}
          {entries.slice(0, 5).map((e, i) => (
            <View key={i} style={styles.entryRow}>
              <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
              <Text style={styles.entryDate}>{formatDate(e.clock_in_datetime)}</Text>
              <Text style={styles.entryDur}>{formatDuration(entryMinutes(e))}</Text>
            </View>
          ))}
        </View>

        {/* ── Digitale Unterschrift ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="create-outline" size={16} color={COLORS.primary} />
            <Text style={styles.cardTitle}>Digitale Unterschrift</Text>
          </View>

          <Text style={styles.sigDesc}>
            Ihre Unterschrift wird automatisch auf dem Arbeitszeitnachweis gedruckt.
          </Text>

          {savingSig ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
          ) : hasSig ? (
            <View style={styles.sigStatusRow}>
              <View style={styles.sigBadge}>
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                <Text style={styles.sigBadgeText}>Unterschrift gespeichert</Text>
              </View>
              <View style={styles.sigBtns}>
                <TouchableOpacity style={styles.sigEditBtn} onPress={() => setSigPadOpen(true)}>
                  <Ionicons name="pencil-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.sigEditText}>Ändern</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sigDeleteBtn} onPress={handleDeleteSignature}>
                  <Ionicons name="trash-outline" size={14} color="#ef4444" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.sigAddBtn} onPress={() => setSigPadOpen(true)}>
              <Ionicons name="add-circle-outline" size={17} color="#fff" />
              <Text style={styles.sigAddText}>Unterschrift hinzufügen</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Server URL */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="server-outline" size={16} color={COLORS.primary} />
            <Text style={styles.cardTitle}>Server-Verbindung</Text>
            <TouchableOpacity onPress={() => { setTempUrl(serverUrl); setEditServer(v => !v); }} style={{ marginLeft: 'auto' }}>
              <Ionicons name={editServer ? 'close' : 'pencil-outline'} size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          {editServer ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              <TextInput
                style={styles.urlInput}
                value={tempUrl}
                onChangeText={setTempUrl}
                placeholder="http://152.53.31.61:9002"
                placeholderTextColor={COLORS.textLight}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveServer}>
                <Text style={styles.saveBtnText}>Speichern</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.urlText}>{serverUrl || DEFAULT_URL}</Text>
          )}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.accent} />
          <Text style={styles.logoutText}>Abmelden</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Hausmeister Pro v1.0.0</Text>
      </ScrollView>

      {/* Signature Pad Modal */}
      <SignaturePadModal
        visible={sigPadOpen}
        onSave={handleSaveSignature}
        onCancel={() => setSigPadOpen(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },
  header:       {
    backgroundColor: COLORS.primary, paddingTop: 56, paddingBottom: 28,
    paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  avatar:       {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center',
  },
  avatarText:   { color: '#fff', fontSize: 20, fontWeight: '900' },
  userName:     { color: '#fff', fontSize: 18, fontWeight: '900' },
  roleBadge:    { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4, alignSelf: 'flex-start' },
  roleText:     { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  card:         {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardHeader:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle:    { fontSize: 13, fontWeight: '800', color: COLORS.text },
  statsRow:     { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, marginBottom: 12 },
  stat:         { alignItems: 'center', gap: 4 },
  statValue:    { fontSize: 24, fontWeight: '900', color: COLORS.primary },
  statLabel:    { fontSize: 10, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase' },
  statSub:      { fontSize: 9, fontWeight: '600', color: COLORS.accent, marginTop: 2 },
  statDivider:  { width: 1, backgroundColor: COLORS.border },
  entryRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: COLORS.border },
  entryDate:    { flex: 1, fontSize: 12, color: COLORS.textMuted },
  entryDur:     { fontSize: 12, fontWeight: '700', color: COLORS.text },

  // Signature card
  sigDesc:       { fontSize: 11, color: COLORS.textMuted, marginBottom: 12, lineHeight: 16 },
  sigStatusRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sigBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sigBadgeText:  { fontSize: 12, fontWeight: '700', color: '#22c55e' },
  sigBtns:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sigEditBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${COLORS.primary}15`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  sigEditText:   { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  sigDeleteBtn:  { padding: 6, backgroundColor: '#fef2f2', borderRadius: 8 },
  sigAddBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 12 },
  sigAddText:    { color: '#fff', fontWeight: '800', fontSize: 13 },

  // Server card
  urlText:      { fontSize: 12, color: COLORS.textMuted, fontFamily: 'monospace' },
  urlInput:     { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: COLORS.text },
  saveBtn:      { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  saveBtnText:  { color: '#fff', fontWeight: '800', fontSize: 13 },
  logoutBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: `${COLORS.accent}15`, borderRadius: 16, paddingVertical: 16, marginTop: 4 },
  logoutText:   { color: COLORS.accent, fontWeight: '800', fontSize: 15 },
  version:      { textAlign: 'center', color: COLORS.textLight, fontSize: 11, marginTop: 20 },
});

const pad = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 40 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title:       { fontSize: 17, fontWeight: '900', color: COLORS.text },
  hint:        { fontSize: 11, color: COLORS.textMuted, marginBottom: 12 },
  canvas:      {
    width: '100%', height: 200,
    backgroundColor: '#fafafa',
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  placeholder: {
    position: 'absolute', bottom: 14, left: 0, right: 0,
    textAlign: 'center', fontSize: 13, color: COLORS.textLight, fontStyle: 'italic',
  },
  actions:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 12 },
  clearBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, flex: 1, justifyContent: 'center' },
  clearText:   { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  saveBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, flex: 2, justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
