import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { apiData } from '@/api/client';
import { SERVER_KEY, DEFAULT_URL } from '@/api/client';
import { COLORS } from '@/utils/constants';
import { formatDuration, formatDate } from '@/utils/helpers';

interface MonthEntry { actual_work_minutes: number; clock_in_datetime: string; }

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [entries,     setEntries]     = useState<MonthEntry[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [serverUrl,   setServerUrl]   = useState('');
  const [editServer,  setEditServer]  = useState(false);
  const [tempUrl,     setTempUrl]     = useState('');

  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    const url = await SecureStore.getItemAsync(SERVER_KEY) || DEFAULT_URL;
    setServerUrl(url);
    if (!silent) setLoading(true);
    try {
      const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const end   = `${year}-${String(month + 1).padStart(2, '0')}-31`;
      const res = await apiData<MonthEntry[]>({
        action: 'query_range', table: 'time_entries',
        filters: { employee_id: user.id, company_id: user.companyId },
        rangeFilters: [{ column: 'clock_in_datetime', gte: start, lte: end }],
        orderBy: { column: 'clock_in_datetime', ascending: false },
      });
      setEntries((res.data ?? []).filter(e => e.actual_work_minutes != null));
    } finally { setLoading(false); }
  }, [user, month, year]);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load])
  );

  const totalMinutes = entries.reduce((s, e) => s + (e.actual_work_minutes ?? 0), 0);

  const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

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
            <Text style={styles.cardTitle}>{MONTH_NAMES[month]} {year}</Text>
          </View>
          {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} /> : (
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{entries.length}</Text>
                <Text style={styles.statLabel}>Einsätze</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatDuration(totalMinutes)}</Text>
                <Text style={styles.statLabel}>Arbeitszeit</Text>
              </View>
            </View>
          )}

          {/* Recent entries */}
          {entries.slice(0, 5).map((e, i) => (
            <View key={i} style={styles.entryRow}>
              <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
              <Text style={styles.entryDate}>{formatDate(e.clock_in_datetime)}</Text>
              <Text style={styles.entryDur}>{formatDuration(e.actual_work_minutes)}</Text>
            </View>
          ))}
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
    </View>
  );
}

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
  statDivider:  { width: 1, backgroundColor: COLORS.border },
  entryRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: COLORS.border },
  entryDate:    { flex: 1, fontSize: 12, color: COLORS.textMuted },
  entryDur:     { fontSize: 12, fontWeight: '700', color: COLORS.text },
  urlText:      { fontSize: 12, color: COLORS.textMuted, fontFamily: 'monospace' },
  urlInput:     {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: COLORS.text,
  },
  saveBtn:      { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  saveBtnText:  { color: '#fff', fontWeight: '800', fontSize: 13 },
  logoutBtn:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: `${COLORS.accent}15`, borderRadius: 16, paddingVertical: 16, marginTop: 4,
  },
  logoutText:   { color: COLORS.accent, fontWeight: '800', fontSize: 15 },
  version:      { textAlign: 'center', color: COLORS.textLight, fontSize: 11, marginTop: 20 },
});
