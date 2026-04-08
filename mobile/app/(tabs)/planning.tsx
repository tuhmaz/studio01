/**
 * Einsatzplanung — mobile version mirroring the web deployment page.
 * Flow: pick date → pick site (shows monthly due services) → pick team → save
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Modal, FlatList, RefreshControl, TextInput,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useAuth } from '@/context/AuthContext';
import { apiData } from '@/api/client';
import { COLORS } from '@/utils/constants';
import { randomId, gpsDistance } from '@/utils/helpers';

// ─── Constants (mirrored from web parse-excel-plan-shared) ───────────────────

const GERMAN_MONTHS = [
  'Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.',
  'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.',
] as const;

function normalizeMonth(m: string): string | null {
  if (!m) return null;
  const cleaned = m.trim().toLowerCase();
  for (const month of GERMAN_MONTHS) {
    if (month.toLowerCase().startsWith(cleaned.substring(0, 3))) return month;
  }
  return null;
}

// Service display config (mirrors web SERVICE_LABELS)
const SERVICE_META: Record<string, { label: string; icon: string; bg: string; text: string; border: string }> = {
  AR_Oeffen:      { label: 'Außengehwege',  icon: 'walk-outline',         bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  AR_Hof:         { label: 'Hofbereich',     icon: 'home-outline',         bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  Gullis:         { label: 'Gullis',         icon: 'water-outline',        bg: '#f8fafc', text: '#334155', border: '#cbd5e1' },
  Ablaufrinnen:   { label: 'Ablaufrinnen',   icon: 'git-branch-outline',   bg: '#f8fafc', text: '#334155', border: '#cbd5e1' },
  AR_Laub:        { label: 'Laub AR',        icon: 'leaf-outline',         bg: '#fefce8', text: '#a16207', border: '#fde68a' },
  Rasen_Fl1:      { label: 'Rasen Fl. 1',   icon: 'leaf',                 bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  Rasen_Fl2:      { label: 'Rasen Fl. 2',   icon: 'leaf',                 bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  Gittersteine:   { label: 'Gittersteine',   icon: 'grid-outline',         bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
  Gartenpflege:   { label: 'Gartenpflege',   icon: 'flower-outline',       bg: '#fff1f2', text: '#be123c', border: '#fecdd3' },
  Baeume_Pruefen: { label: 'Bäume Prüfen',  icon: 'analytics-outline',    bg: '#fffbeb', text: '#92400e', border: '#fcd34d' },
  VEG_Laub:       { label: 'Laub VEG',       icon: 'leaf-outline',         bg: '#fefce8', text: '#a16207', border: '#fde68a' },
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Offen', IN_PROGRESS: 'Aktiv', COMPLETED: 'Fertig',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: '#f59e0b', IN_PROGRESS: '#3b82f6', COMPLETED: '#16a34a',
};

// ─── Types ───────────────────────────────────────────────────────────────────

type ServiceDetails = {
  isActive?: boolean;
  frequency?: string | null;
  months?: string[];
};

interface JobSite {
  id: string;
  name: string;
  address: string;
  city: string;
  lat?: number | null;
  lng?: number | null;
  services?: Record<string, ServiceDetails>;
}

interface Worker {
  id: string;
  name: string;
  role: string;
}

interface Deployment {
  id: string;
  jobSiteId: string | null;
  assignedWorkerIds: string[];
  status: string;
  title: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isServiceDue(details: ServiceDetails | undefined, currentMonth: string): boolean {
  if (!details?.isActive || !details.months?.length) return false;
  const norm = normalizeMonth(currentMonth);
  return details.months.some(m => normalizeMonth(m) === norm);
}

function addDays(dateStr: string, n: number): string {
  const [y, mo, day] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, day + n);          // local time — no UTC offset issue
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PlanningScreen() {
  const { user } = useAuth();
  const todayStr = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate]     = useState(todayStr);
  const [selectedSite, setSelectedSite]     = useState('');
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);

  const [sites, setSites]           = useState<JobSite[]>([]);
  const [workers, setWorkers]       = useState<Worker[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);

  // ── Sonderauftrag mode ──
  const [mode, setMode]               = useState<'regular' | 'sonder'>('regular');
  const [sonderTitle, setSonderTitle] = useState('');
  const [sonderAddress, setSonderAddress] = useState('');

  // ── Derived ──
  const currentMonth = GERMAN_MONTHS[new Date(selectedDate + 'T00:00:00').getMonth()];
  const currentSite  = sites.find(s => s.id === selectedSite);

  const dueServices = useMemo(() => {
    if (!currentSite?.services) return [];
    return Object.entries(currentSite.services)
      .filter(([, det]) => isServiceDue(det, currentMonth));
  }, [currentSite, currentMonth]);

  const sortedWorkers = useMemo(
    () => [...workers].sort((a, b) => {
      if (a.role === 'LEADER' && b.role !== 'LEADER') return -1;
      if (a.role !== 'LEADER' && b.role === 'LEADER') return 1;
      return a.name.localeCompare(b.name);
    }),
    [workers],
  );

  const todayDeployments = useMemo(
    () => deployments.filter(d => true), // already filtered by date in query
    [deployments],
  );

  const suggestedSites = useMemo(() => {
    if (!currentSite || currentSite.lat == null || currentSite.lng == null || sites.length === 0) return [];
    
    return sites.filter(site => {
      if (site.id === currentSite.id) return false;
      if (site.lat == null || site.lng == null) return false;
      
      // Check if already scheduled today
      if (deployments.some(d => d.jobSiteId === site.id)) return false;

      // Check if has due services this month
      const hasDue = site.services ? Object.values(site.services).some((s: any) => isServiceDue(s, currentMonth)) : false;
      if (!hasDue) return false;

      // Distance <= 25km
      const dist = gpsDistance(currentSite.lat!, currentSite.lng!, site.lat, site.lng);
      return dist <= 25000;
    }).sort((a, b) => {
      const distA = gpsDistance(currentSite.lat!, currentSite.lng!, a.lat!, a.lng!);
      const distB = gpsDistance(currentSite.lat!, currentSite.lng!, b.lat!, b.lng!);
      return distA - distB;
    }).slice(0, 5); // top 5 closest
  }, [currentSite, sites, deployments, currentMonth]);

  // ── Load ──
  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const [sRes, wRes, dRes] = await Promise.all([
        apiData<JobSite[]>({ action: 'query', table: 'job_sites', filters: { company_id: user.companyId } }),
        apiData<Worker[]>({ action: 'query', table: 'users', filters: { company_id: user.companyId } }),
        apiData<any[]>({
          action: 'query', table: 'job_assignments',
          filters: { company_id: user.companyId, scheduled_date: selectedDate },
        }),
      ]);
      setSites(sRes.data ?? []);
      setWorkers((wRes.data ?? []).filter((w: any) => w.role === 'WORKER' || w.role === 'LEADER'));
      setDeployments(
        (dRes.data ?? []).map((r: any) => ({
          id: r.id,
          jobSiteId: r.job_site_id,
          assignedWorkerIds: r.assigned_worker_ids ?? [],
          status: r.status,
          title: r.title,
        })),
      );
    } catch (e) {
      console.warn('Planning load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, selectedDate]);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load])
  );

  // ── Save ──
  const handleSave = async () => {
    if (!selectedSite || selectedWorkers.length === 0) {
      Alert.alert('Fehlende Informationen', 'Bitte wählen Sie einen Standort und mindestens einen Mitarbeiter aus.');
      return;
    }
    const existing = deployments.find(d => d.jobSiteId === selectedSite);
    if (existing) {
      Alert.alert('Bereits eingeplant', 'Für diesen Standort existiert bereits ein Einsatz am selben Tag.');
      return;
    }
    setSaving(true);
    try {
      await apiData({
        action: 'insert',
        table: 'job_assignments',
        data: {
          id: `assign-${randomId()}`,
          company_id: user?.companyId,
          job_site_id: selectedSite,
          assigned_worker_ids: selectedWorkers,
          scheduled_date: selectedDate,
          title: currentSite?.name || 'Tageseinsatz',
          status: 'PENDING',
          is_plan_published: true,
          categories: dueServices.map(([code]) => code),
        },
      });
      Alert.alert('Tagesplan gespeichert', `${selectedWorkers.length} Mitarbeiter wurden zugewiesen.`);
      setSelectedSite('');
      setSelectedWorkers([]);
      await load(true);
    } catch (e: any) {
      Alert.alert('Fehler', e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  const toggleWorker = (id: string) =>
    setSelectedWorkers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // ── Sonderauftrag save ──
  const handleSaveSonder = async () => {
    if (!sonderTitle.trim()) {
      Alert.alert('Fehlende Informationen', 'Bitte geben Sie eine Beschreibung ein.');
      return;
    }
    if (selectedWorkers.length === 0) {
      Alert.alert('Fehlende Informationen', 'Bitte wählen Sie mindestens einen Mitarbeiter aus.');
      return;
    }
    setSaving(true);
    try {
      const fullTitle = sonderAddress.trim()
        ? `${sonderTitle.trim()} — ${sonderAddress.trim()}`
        : sonderTitle.trim();
      await apiData({
        action: 'insert',
        table: 'job_assignments',
        data: {
          id: `sonder-${randomId()}`,
          company_id: user?.companyId,
          job_site_id: null,                   // kein fester Standort
          assigned_worker_ids: selectedWorkers,
          scheduled_date: selectedDate,
          title: fullTitle,
          status: 'PENDING',
          is_plan_published: true,
          categories: [],
        },
      });
      Alert.alert('Sonderauftrag gespeichert', `${selectedWorkers.length} Mitarbeiter wurden zugewiesen.`);
      setSonderTitle('');
      setSonderAddress('');
      setSelectedWorkers([]);
      setMode('regular');
      await load(true);
    } catch (e: any) {
      Alert.alert('Fehler', e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  // ── Access guard ──
  if (!user || (user.role !== 'LEADER' && user.role !== 'ADMIN')) {
    return (
      <View style={s.center}>
        <Ionicons name="lock-closed" size={44} color={COLORS.textMuted} />
        <Text style={s.lockText}>Keine Berechtigung</Text>
      </View>
    );
  }

  const isToday = selectedDate === todayStr;
  const formattedDate = format(new Date(selectedDate + 'T00:00:00'), 'EEEE, d. MMMM yyyy', { locale: de });

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* ══ Header ══ */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Einsatzplanung</Text>
          <Text style={s.headerSub}>Teilen Sie das Team und die Aufgaben ein.</Text>
        </View>

        {/* Date navigator */}
        <View style={s.dateNav}>
          <TouchableOpacity style={s.dateNavBtn} onPress={() => setSelectedDate(d => addDays(d, -1))}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={s.dateNavCenter}>
            <Text style={s.dateNavDay}>{formattedDate.split(',')[0]}</Text>
            <Text style={s.dateNavFull}>
              {format(new Date(selectedDate + 'T00:00:00'), 'd. MMM yyyy', { locale: de })}
            </Text>
          </View>
          <TouchableOpacity style={s.dateNavBtn} onPress={() => setSelectedDate(d => addDays(d, 1))}>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        {!isToday && (
          <TouchableOpacity style={s.todayBtn} onPress={() => setSelectedDate(todayStr)}>
            <Ionicons name="today-outline" size={13} color={COLORS.primary} />
            <Text style={s.todayBtnText}>Heute</Text>
          </TouchableOpacity>
        )}

        {/* ── Mode toggle ── */}
        <View style={s.modeToggle}>
          <TouchableOpacity
            style={[s.modeBtn, mode === 'regular' && s.modeBtnActive]}
            onPress={() => setMode('regular')}
          >
            <Ionicons name="business-outline" size={14} color={mode === 'regular' ? COLORS.primary : 'rgba(255,255,255,0.7)'} />
            <Text style={[s.modeBtnText, mode === 'regular' && s.modeBtnTextActive]}>Regulärer Einsatz</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeBtn, mode === 'sonder' && s.modeBtnSonderActive]}
            onPress={() => setMode('sonder')}
          >
            <Ionicons name="flash-outline" size={14} color={mode === 'sonder' ? '#92400e' : 'rgba(255,255,255,0.7)'} />
            <Text style={[s.modeBtnText, mode === 'sonder' && s.modeBtnSonderText]}>Sonderauftrag</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
        >

          {/* ══ Step 1 — Standort / Sonderauftrag ══ */}
          <View style={[s.card, mode === 'sonder' && s.cardSonder]}>
            <View style={[s.cardHeader, mode === 'sonder' && s.cardHeaderSonder]}>
              <View style={[s.cardHeaderIcon, mode === 'sonder' && s.cardHeaderIconSonder]}>
                <Ionicons name={mode === 'sonder' ? 'flash' : 'location'} size={14}
                  color={mode === 'sonder' ? '#92400e' : COLORS.primary} />
              </View>
              <Text style={[s.cardHeaderText, mode === 'sonder' && s.cardHeaderTextSonder]}>
                {mode === 'sonder' ? '1. BESCHREIBUNG & ORT' : '1. STANDORT & AUFGABEN WÄHLEN'}
              </Text>
            </View>

            {mode === 'sonder' ? (
              /* ── Sonderauftrag fields ── */
              <View style={s.sonderFields}>
                <Text style={s.sonderFieldLabel}>BESCHREIBUNG *</Text>
                <TextInput
                  style={s.sonderInput}
                  placeholder="z.B. Ölfleck-Reinigung, Winterdienst..."
                  placeholderTextColor={COLORS.textLight}
                  value={sonderTitle}
                  onChangeText={setSonderTitle}
                  returnKeyType="next"
                />
                <Text style={s.sonderFieldLabel}>ORT / ADRESSE (optional)</Text>
                <TextInput
                  style={s.sonderInput}
                  placeholder="z.B. Hauptstraße 12, Musterstadt"
                  placeholderTextColor={COLORS.textLight}
                  value={sonderAddress}
                  onChangeText={setSonderAddress}
                  returnKeyType="done"
                />
                <View style={s.sonderHint}>
                  <Ionicons name="information-circle-outline" size={14} color="#92400e" />
                  <Text style={s.sonderHintText}>
                    Einmaliger Einsatz — kein fester Standort. Erscheint im Kschf als Sonderauftrag.
                  </Text>
                </View>
              </View>
            ) : (
              /* ── Regular site picker ── */
              <TouchableOpacity style={s.sitePicker} onPress={() => setShowSiteModal(true)}>
                {currentSite ? (
                  <View style={s.sitePickerSelected}>
                    <View style={s.sitePickerIcon}>
                      <Ionicons name="business" size={18} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sitePickerName}>{currentSite.name}</Text>
                      <Text style={s.sitePickerSub}>{currentSite.city} · {currentSite.id}</Text>
                    </View>
                    <Ionicons name="chevron-down" size={18} color={COLORS.textLight} />
                  </View>
                ) : (
                  <View style={s.sitePickerPlaceholder}>
                    <Ionicons name="business-outline" size={20} color={COLORS.textLight} />
                    <Text style={s.sitePickerPlaceholderText}>Standort auswählen...</Text>
                    <Ionicons name="chevron-down" size={18} color={COLORS.textLight} />
                  </View>
                )}
              </TouchableOpacity>
            )}

            {/* Site details + due services */}
            {currentSite && (
              <View style={s.siteDetails}>
                <View style={s.siteInfoBox}>
                  <Text style={s.siteInfoLabel}>ADRESSE</Text>
                  <Text style={s.siteInfoValue}>{currentSite.address}, {currentSite.city}</Text>
                </View>

                <View style={s.servicesBox}>
                  <View style={s.servicesBoxHeader}>
                    <Ionicons name="hammer-outline" size={13} color={COLORS.primary} />
                    <Text style={s.servicesBoxTitle}>
                      FÄLLIGE LEISTUNGEN — {currentMonth.toUpperCase()}
                    </Text>
                  </View>
                  <View style={s.serviceChips}>
                    {dueServices.length > 0 ? (
                      dueServices.map(([key]) => {
                        const meta = SERVICE_META[key];
                        if (!meta) return null;
                        return (
                          <View
                            key={key}
                            style={[s.serviceChip, { backgroundColor: meta.bg, borderColor: meta.border }]}
                          >
                            <Ionicons name={meta.icon as any} size={11} color={meta.text} />
                            <Text style={[s.serviceChipText, { color: meta.text }]}>{meta.label}</Text>
                          </View>
                        );
                      })
                    ) : (
                      <Text style={s.noServices}>
                        Keine fälligen Leistungen für {currentMonth}
                      </Text>
                    )}
                  </View>
                </View>

                {suggestedSites.length > 0 && (
                  <View style={[s.servicesBox, { backgroundColor: '#fffbeb', borderColor: '#fde68a', marginTop: 10 }]}>
                    <View style={s.servicesBoxHeader}>
                      <Ionicons name="bulb-outline" size={14} color="#d97706" />
                      <Text style={[s.servicesBoxTitle, { color: '#d97706' }]}>
                        VORSCHLÄGE (IN DER NÄHE)
                      </Text>
                    </View>
                    <View style={{ gap: 8 }}>
                      {suggestedSites.map(site => (
                        <TouchableOpacity
                          key={site.id}
                          style={{
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                            backgroundColor: '#fff', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#fef3c7'
                          }}
                          onPress={() => setSelectedSite(site.id)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: '#451a03' }}>{site.name}</Text>
                            <Text style={{ fontSize: 10, color: '#92400e', marginTop: 2 }}>
                              {Math.round(gpsDistance(currentSite.lat!, currentSite.lng!, site.lat!, site.lng!) / 1000)} km entfernt
                            </Text>
                          </View>
                          <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: '#b45309' }}>Wählen</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* ══ Step 2 — Team zusammenstellen ══ */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.cardHeaderIcon}>
                <Ionicons name="people" size={14} color={COLORS.primary} />
              </View>
              <Text style={s.cardHeaderText}>2. TEAM ZUSAMMENSTELLEN</Text>
            </View>

            <View style={s.workerGrid}>
              {sortedWorkers.map(worker => {
                const isSelected = selectedWorkers.includes(worker.id);
                return (
                  <TouchableOpacity
                    key={worker.id}
                    style={[s.workerCard, isSelected && s.workerCardSelected]}
                    onPress={() => toggleWorker(worker.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[s.workerCheckbox, isSelected && s.workerCheckboxSelected]}>
                      {isSelected && <Ionicons name="checkmark" size={13} color="#fff" />}
                    </View>
                    <View style={s.workerAvatar}>
                      <Text style={s.workerAvatarText}>
                        {worker.name.split(' ').map((p: string) => p[0]).slice(0, 2).join('')}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={s.workerNameRow}>
                        <Text style={s.workerName} numberOfLines={1}>{worker.name}</Text>
                        {worker.role === 'LEADER' && (
                          <View style={s.leiterBadge}>
                            <Text style={s.leiterBadgeText}>LEITER</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.workerRole}>{worker.role}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ══ Zusammenfassung ══ */}
          <View style={[s.summaryCard, mode === 'sonder' && s.summaryCardSonder]}>
            <Text style={s.summaryTitle}>ZUSAMMENFASSUNG</Text>
            <Text style={s.summarySub}>
              {mode === 'sonder' ? 'Sonderauftrag prüfen' : 'Zuweisung prüfen'}
            </Text>

            <View style={s.summaryDivider} />

            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>DATUM</Text>
              <View style={s.summaryValueRow}>
                <Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.8)" />
                <Text style={s.summaryValue}>
                  {format(new Date(selectedDate + 'T00:00:00'), 'dd.MM.yyyy', { locale: de })}
                </Text>
              </View>
            </View>

            {mode === 'sonder' ? (
              <>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabel}>BESCHREIBUNG</Text>
                  <Text style={s.summaryValue} numberOfLines={2}>
                    {sonderTitle.trim() || '—'}
                  </Text>
                </View>
                {sonderAddress.trim() !== '' && (
                  <View style={s.summaryRow}>
                    <Text style={s.summaryLabel}>ORT</Text>
                    <Text style={s.summaryValue} numberOfLines={1}>{sonderAddress.trim()}</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabel}>OBJEKT</Text>
                  <Text style={s.summaryValue} numberOfLines={1}>
                    {currentSite ? currentSite.name : 'Keines gewählt'}
                  </Text>
                </View>
                {dueServices.length > 0 && (
                  <View style={s.summaryRow}>
                    <Text style={s.summaryLabel}>AUFGABEN ({dueServices.length})</Text>
                    <Text style={s.summaryValue}>
                      {dueServices.map(([k]) => SERVICE_META[k]?.label ?? k).join(', ')}
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>TEAM ({selectedWorkers.length})</Text>
              <View style={s.summaryTeamChips}>
                {selectedWorkers.length > 0 ? (
                  selectedWorkers.map(id => {
                    const w = workers.find(x => x.id === id);
                    return w ? (
                      <View key={id} style={s.summaryTeamChip}>
                        <Text style={s.summaryTeamChipText}>{w.name.split(' ')[0]}</Text>
                      </View>
                    ) : null;
                  })
                ) : (
                  <Text style={s.summaryEmpty}>Keine Mitarbeiter gewählt</Text>
                )}
              </View>
            </View>

            <View style={s.summaryDivider} />

            {mode === 'sonder' ? (
              <TouchableOpacity
                style={[s.saveBtn, s.saveBtnSonder,
                  (saving || !sonderTitle.trim() || selectedWorkers.length === 0) && s.saveBtnDisabled]}
                onPress={handleSaveSonder}
                disabled={saving || !sonderTitle.trim() || selectedWorkers.length === 0}
              >
                {saving ? (
                  <ActivityIndicator color="#92400e" />
                ) : (
                  <>
                    <Ionicons name="flash-outline" size={18} color="#92400e" />
                    <Text style={[s.saveBtnText, { color: '#92400e' }]}>SONDERAUFTRAG SPEICHERN</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.saveBtn, (saving || !selectedSite || selectedWorkers.length === 0) && s.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving || !selectedSite || selectedWorkers.length === 0}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.primary} />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={18} color={COLORS.primary} />
                    <Text style={s.saveBtnText}>EINSATZ SPEICHERN</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* ══ Aktive Einsätze ══ */}
          {todayDeployments.length > 0 && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <View style={s.cardHeaderIcon}>
                  <Ionicons name="list" size={14} color={COLORS.primary} />
                </View>
                <Text style={s.cardHeaderText}>
                  AKTIVE EINSÄTZE — {format(new Date(selectedDate + 'T00:00:00'), 'd. MMM', { locale: de }).toUpperCase()}
                </Text>
              </View>

              <View style={s.deploymentList}>
                {todayDeployments.map(dep => {
                  const site = sites.find(s => s.id === dep.jobSiteId);
                  const isSonder = !dep.jobSiteId;
                  const statusColor = STATUS_COLOR[dep.status] ?? COLORS.textMuted;
                  return (
                    <View key={dep.id} style={[s.deploymentItem, isSonder && { backgroundColor: '#fffbeb' }]}>
                      <View style={[s.deploymentBar, { backgroundColor: isSonder ? '#f59e0b' : statusColor }]} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          {isSonder && (
                            <Ionicons name="flash" size={12} color="#92400e" />
                          )}
                          <Text style={[s.deploymentName, isSonder && { color: '#92400e' }]} numberOfLines={1}>
                            {isSonder ? dep.title : (site?.name ?? dep.title)}
                          </Text>
                        </View>
                        <Text style={s.deploymentMeta}>
                          {isSonder ? 'Sonderauftrag · ' : ''}{dep.assignedWorkerIds.length} Person{dep.assignedWorkerIds.length !== 1 ? 'en' : ''}
                        </Text>
                      </View>
                      <View style={[s.deploymentBadge, { backgroundColor: `${statusColor}20`, borderColor: `${statusColor}40` }]}>
                        <Text style={[s.deploymentBadgeText, { color: statusColor }]}>
                          {STATUS_LABEL[dep.status] ?? dep.status}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ══ Site Selection Modal ══ */}
      <Modal visible={showSiteModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <View style={s.modalHeaderRow}>
              <Text style={s.modalHeaderTitle}>Standort auswählen</Text>
              <TouchableOpacity onPress={() => setShowSiteModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={sites}
              keyExtractor={i => i.id}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedSite;
                // count due services for this site for the current month
                const due = item.services
                  ? Object.entries(item.services).filter(([, d]) => isServiceDue(d, currentMonth)).length
                  : 0;
                return (
                  <TouchableOpacity
                    style={[s.modalItem, isSelected && s.modalItemSelected]}
                    onPress={() => { setSelectedSite(item.id); setShowSiteModal(false); }}
                  >
                    <View style={[s.modalItemIcon, isSelected && { backgroundColor: `${COLORS.primary}20` }]}>
                      <Ionicons name="business" size={20} color={isSelected ? COLORS.primary : COLORS.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.modalItemTitle, isSelected && { color: COLORS.primary }]}>{item.name}</Text>
                      <Text style={s.modalItemSub}>{item.address}, {item.city}</Text>
                      {due > 0 && (
                        <Text style={s.modalItemDue}>{due} Leistung{due !== 1 ? 'en' : ''} fällig in {currentMonth}</Text>
                      )}
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f0f4f8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  lockText: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600' },

  // ── Header
  header: {
    backgroundColor: COLORS.primary,
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: 16,
  },

  // Date navigator
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    padding: 6,
    gap: 8,
  },
  dateNavBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNavCenter: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dateNavDay: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dateNavFull: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 1,
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 10,
  },
  todayBtnText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '800',
  },

  // ── Scroll & Cards
  scroll: { padding: 16, gap: 14 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${COLORS.primary}0d`,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  cardHeaderIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: `${COLORS.primary}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: {
    fontSize: 11,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1,
  },

  // ── Site picker
  sitePicker: {
    margin: 16,
    borderWidth: 1.5,
    borderColor: `${COLORS.primary}30`,
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 52,
  },
  sitePickerSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  sitePickerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${COLORS.primary}12`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sitePickerName: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  sitePickerSub: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  sitePickerPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  sitePickerPlaceholderText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textLight,
  },

  // ── Site details
  siteDetails: {
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 10,
  },
  siteInfoBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${COLORS.primary}30`,
    padding: 14,
  },
  siteInfoLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  siteInfoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  servicesBox: {
    backgroundColor: `${COLORS.primary}07`,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${COLORS.primary}15`,
    padding: 14,
  },
  servicesBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  servicesBoxTitle: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  serviceChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  serviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  serviceChipText: {
    fontSize: 10,
    fontWeight: '900',
  },
  noServices: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },

  // ── Workers
  workerGrid: {
    padding: 14,
    gap: 8,
  },
  workerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  workerCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}07`,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  workerCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerCheckboxSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  workerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: `${COLORS.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerAvatarText: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.primary,
    textTransform: 'uppercase',
  },
  workerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  workerName: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    flex: 1,
  },
  leiterBadge: {
    backgroundColor: '#3b82f6',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  leiterBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
  },
  workerRole: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
  },

  // ── Summary card (dark)
  summaryCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 24,
    padding: 22,
    marginBottom: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  summaryTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  summarySub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: 4,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: 14,
  },
  summaryRow: {
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryTeamChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  summaryTeamChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  summaryTeamChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    textTransform: 'uppercase',
  },
  summaryEmpty: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontStyle: 'italic',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },

  // ── Active deployments
  deploymentList: {
    padding: 14,
    gap: 10,
  },
  deploymentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${COLORS.primary}10`,
    overflow: 'hidden',
    gap: 12,
  },
  deploymentBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  deploymentName: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.text,
    paddingVertical: 12,
  },
  deploymentMeta: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  deploymentBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 12,
  },
  deploymentBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },

  // ── Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    paddingBottom: 32,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#e2e8f0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  modalItemSelected: {
    backgroundColor: `${COLORS.primary}08`,
  },
  modalItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalItemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalItemSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  modalItemDue: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
    marginTop: 3,
  },

  // ── Mode toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 12,
    padding: 4,
    marginTop: 12,
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 9,
  },
  modeBtnActive: {
    backgroundColor: '#fff',
  },
  modeBtnSonderActive: {
    backgroundColor: '#fef3c7',
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
  },
  modeBtnTextActive: {
    color: COLORS.primary,
  },
  modeBtnSonderText: {
    color: '#92400e',
  },

  // ── Sonder card
  cardSonder: {
    borderWidth: 1.5,
    borderColor: '#fcd34d',
  },
  cardHeaderSonder: {
    backgroundColor: '#fffbeb',
  },
  cardHeaderIconSonder: {
    backgroundColor: '#fde68a',
  },
  cardHeaderTextSonder: {
    color: '#92400e',
  },

  // ── Sonder form fields
  sonderFields: {
    padding: 16,
    gap: 4,
  },
  sonderFieldLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: '#92400e',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sonderInput: {
    backgroundColor: '#fffbeb',
    borderWidth: 1.5,
    borderColor: '#fcd34d',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 14,
  },
  sonderHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
  },
  sonderHintText: {
    fontSize: 11,
    color: '#92400e',
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },

  // ── Summary sonder
  summaryCardSonder: {
    backgroundColor: '#92400e',
  },
  saveBtnSonder: {
    backgroundColor: '#fef3c7',
  },
});
