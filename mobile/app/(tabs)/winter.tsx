/**
 * Winterdienst for workers: pick a site, record what was done.
 * Time and GPS are captured on save; without signal the entry waits on the
 * phone and is sent automatically later.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import {
  ACTIVITIES, MATERIALS, discardQueuedEntry, fetchWinterSites, flushWinterQueue, newRequestId,
  queuedEntries, submitWinterEntry,
  type Activity, type FlushResult, type Material, type WinterEntryInput, type WinterSite,
} from '@/api/winter';
import { COLORS } from '@/utils/constants';
import { formatTime } from '@/utils/helpers';

const NEEDS_MATERIAL: Activity[] = ['gritting', 'clearing_gritting'];

async function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 12000)),
    ]);
    const pos = fix ?? (await Location.getLastKnownPositionAsync());
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

export default function WinterScreen() {
  const [sites, setSites] = useState<WinterSite[] | null>(null);
  const [queue, setQueue] = useState<WinterEntryInput[]>([]);
  const [rejected, setRejected] = useState<FlushResult['rejected']>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [site, setSite] = useState<WinterSite | null>(null);

  const load = useCallback(async () => {
    try {
      const flush = await flushWinterQueue();
      setRejected(flush.rejected);
      setSites(await fetchWinterSites());
      setOffline(false);
    } catch {
      setOffline(true);
      setSites(prev => prev ?? []);
    } finally {
      setQueue(await queuedEntries());
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Winterdienst</Text>
        <Text style={styles.headerSub}>Objekt antippen, dann Einsatz eintragen</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {queue.length > 0 && (
          <View style={[styles.banner, { backgroundColor: '#fef3c7' }]}>
            <Ionicons name="cloud-upload-outline" size={18} color="#92400e" />
            <Text style={[styles.bannerText, { color: '#92400e' }]}>
              {queue.length} {queue.length === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf Verbindung und {queue.length === 1 ? 'wird' : 'werden'} automatisch gesendet.
            </Text>
          </View>
        )}
        {rejected.map(({ entry, message }) => (
          <View key={entry.clientRequestId} style={[styles.banner, { backgroundColor: '#fee2e2' }]}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerText, { color: COLORS.danger }]}>
                {entry.siteName}, {formatTime(entry.performedAt)}: {message}
              </Text>
              <TouchableOpacity onPress={async () => { await discardQueuedEntry(entry.clientRequestId); load(); }}>
                <Text style={styles.bannerAction}>Eintrag verwerfen</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {offline && (
          <View style={[styles.banner, { backgroundColor: '#e2e8f0' }]}>
            <Ionicons name="cloud-offline-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.bannerText}>Keine Verbindung. Einträge werden auf dem Handy gespeichert.</Text>
          </View>
        )}

        {sites === null && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />}
        {sites?.length === 0 && !offline && (
          <View style={styles.empty}>
            <Ionicons name="snow-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>Keine Winterdienst-Objekte</Text>
            <Text style={styles.emptyText}>Ihr Büro richtet die Objekte im Web unter „Winterdienst“ ein.</Text>
          </View>
        )}
        {sites?.map(s => {
          const done = s.entries_today > 0;
          return (
            <TouchableOpacity key={s.id} style={styles.siteCard} onPress={() => setSite(s)} activeOpacity={0.8}>
              <View style={[styles.statusDot, { backgroundColor: done ? COLORS.success : COLORS.warning }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.siteName}>{s.name}</Text>
                <Text style={styles.siteAddress}>{[s.address, s.city].filter(Boolean).join(', ')}</Text>
                <Text style={[styles.siteStatus, { color: done ? COLORS.success : COLORS.warning }]}>
                  {done && s.last_activity
                    ? `${ACTIVITIES[s.last_activity]} · ${formatTime(s.last_performed_at!)} · ${s.last_employee_name}`
                    : 'Heute noch kein Eintrag'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {site && <EntryForm site={site} onClose={() => setSite(null)} onSaved={() => { setSite(null); load(); }} />}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function EntryForm({ site, onClose, onSaved }: { site: WinterSite; onClose: () => void; onSaved: () => void }) {
  const [activity, setActivity] = useState<Activity>('clearing_gritting');
  const [material, setMaterial] = useState<Material | null>('salt');
  const [amount, setAmount] = useState('');
  const [areas, setAreas] = useState<string[]>(site.winter_areas);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const needsMaterial = NEEDS_MATERIAL.includes(activity);

  const toggleArea = (area: string) =>
    setAreas(prev => (prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]));

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Berechtigung fehlt', 'Bitte Kamerazugriff erlauben.'); return; }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 });
    if (!result.canceled && result.assets[0].base64) {
      setPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const save = async () => {
    if (needsMaterial && !material) { Alert.alert('Streumittel fehlt', 'Bitte das Streumittel wählen.'); return; }
    const parsedAmount = amount.trim() ? Number(amount.replace(',', '.')) : null;
    if (parsedAmount != null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      Alert.alert('Menge ungültig', 'Bitte eine Zahl in kg eingeben.');
      return;
    }
    setSaving(true);
    // Time of work is now, even if the entry is sent later.
    const performedAt = new Date().toISOString();
    const position = await currentPosition();
    try {
      const result = await submitWinterEntry({
        clientRequestId: newRequestId(),
        siteId: site.id,
        siteName: site.name,
        activity,
        gritMaterial: needsMaterial ? material : null,
        gritAmountKg: needsMaterial ? parsedAmount : null,
        areas,
        notes: notes.trim() || null,
        performedAt,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        gpsAccuracyM: position?.accuracy ?? null,
        photo,
      });
      Alert.alert(
        result === 'sent' ? 'Gespeichert' : 'Offline gespeichert',
        result === 'sent'
          ? `${ACTIVITIES[activity]} für ${site.name} eingetragen.`
          : 'Keine Verbindung. Der Eintrag wird automatisch gesendet, sobald wieder Netz da ist.',
      );
      onSaved();
    } catch (error: any) {
      Alert.alert('Nicht gespeichert', error?.message ?? 'Unbekannter Fehler');
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{site.name}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{[site.address, site.city].filter(Boolean).join(', ')}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {site.winter_notes ? (
            <View style={[styles.banner, { backgroundColor: '#e0f2fe' }]}>
              <Ionicons name="information-circle-outline" size={18} color="#075985" />
              <Text style={[styles.bannerText, { color: '#075985' }]}>{site.winter_notes}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Tätigkeit</Text>
          <View style={styles.chips}>
            {(Object.keys(ACTIVITIES) as Activity[]).map(a => (
              <Chip key={a} label={ACTIVITIES[a]} active={activity === a} onPress={() => setActivity(a)} />
            ))}
          </View>

          {needsMaterial && (
            <>
              <Text style={styles.label}>Streumittel</Text>
              <View style={styles.chips}>
                {(Object.keys(MATERIALS) as Material[]).map(m => (
                  <Chip key={m} label={MATERIALS[m]} active={material === m} onPress={() => setMaterial(m)} />
                ))}
              </View>
              <Text style={styles.label}>Menge in kg (optional)</Text>
              <TextInput style={styles.input} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="z. B. 5" placeholderTextColor={COLORS.textLight} />
            </>
          )}

          {site.winter_areas.length > 0 && (
            <>
              <Text style={styles.label}>Flächen</Text>
              <View style={styles.chips}>
                {site.winter_areas.map(a => <Chip key={a} label={a} active={areas.includes(a)} onPress={() => toggleArea(a)} />)}
              </View>
            </>
          )}

          <Text style={styles.label}>Foto (empfohlen)</Text>
          {photo ? (
            <View>
              <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
              <TouchableOpacity onPress={() => setPhoto(null)}><Text style={styles.bannerAction}>Foto entfernen</Text></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
              <Ionicons name="camera-outline" size={22} color={COLORS.primary} />
              <Text style={styles.photoBtnText}>Foto aufnehmen</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.label}>Notiz (optional)</Text>
          <TextInput style={[styles.input, { minHeight: 70 }]} multiline value={notes} onChangeText={setNotes} placeholder="z. B. Eisglätte am Eingang" placeholderTextColor={COLORS.textLight} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
                <Text style={styles.saveText}>Einsatz speichern</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>Uhrzeit und GPS-Position werden beim Speichern automatisch erfasst.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.bg },
  header:      { backgroundColor: COLORS.primary, paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  headerSub:   { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  banner:      { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 12, padding: 12, marginBottom: 12 },
  bannerText:  { flex: 1, fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  bannerAction:{ fontSize: 12, fontWeight: '800', color: COLORS.primary, marginTop: 6 },
  empty:       { alignItems: 'center', gap: 10, paddingTop: 60, paddingHorizontal: 24 },
  emptyTitle:  { fontSize: 17, fontWeight: '800', color: COLORS.text },
  emptyText:   { fontSize: 13, color: COLORS.textMuted, textAlign: 'center' },
  siteCard:    {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16,
    padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  statusDot:   { width: 12, height: 12, borderRadius: 6 },
  siteName:    { fontSize: 15, fontWeight: '800', color: COLORS.text },
  siteAddress: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  siteStatus:  { fontSize: 12, fontWeight: '700', marginTop: 6 },
  label:       { fontSize: 11, fontWeight: '800', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  chips:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border },
  chipActive:  { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText:    { fontSize: 13, fontWeight: '700', color: COLORS.text },
  chipTextActive: { color: '#fff' },
  input:       { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: COLORS.text },
  photoBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: 'dashed', paddingVertical: 18 },
  photoBtnText:{ fontSize: 14, fontWeight: '800', color: COLORS.primary },
  photo:       { width: '100%', height: 200, borderRadius: 12 },
  saveBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.success, borderRadius: 14, paddingVertical: 16, marginTop: 28 },
  saveText:    { color: '#fff', fontSize: 16, fontWeight: '900' },
  hint:        { textAlign: 'center', fontSize: 11, color: COLORS.textMuted, marginTop: 10 },
});
