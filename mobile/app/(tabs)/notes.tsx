import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioRecorder, RecordingPresets, AudioModule, setAudioModeAsync,
} from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { MediaImage } from '@/components/MediaImage';
import { COLORS } from '@/utils/constants';
import { formatTime } from '@/utils/helpers';
import { addNote, loadNotes, loadTracking, type NoteEntry, type TimeEntry } from '@/sync/field';
import { useSync } from '@/sync/SyncContext';
import { t } from '@/i18n';

type ActiveEntry = TimeEntry;

export default function NotesScreen() {
  const { user } = useAuth();
  const { lastSyncAt } = useSync();
  const [offline, setOffline] = useState(false);

  const [activeEntry,  setActiveEntry]  = useState<ActiveEntry | null>(null);
  const [notes,        setNotes]        = useState<NoteEntry[]>([]);
  const [textInput,    setTextInput]    = useState('');
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording,  setIsRecording]  = useState(false);
  const [recSeconds,   setRecSeconds]   = useState(0);
  const [recTimer,     setRecTimer]     = useState<ReturnType<typeof setInterval> | null>(null);
  const [activeTab,    setActiveTab]    = useState<'all' | 'photo' | 'voice' | 'text'>('all');

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      // Offline: Schicht und Notizen aus dem gespeicherten Stand + wartende Vorgänge.
      const tracking = await loadTracking(user);
      const entry = tracking.activeEntry;
      setActiveEntry(entry);
      if (entry) {
        const { notes: list, offline: off } = await loadNotes(user, entry.job_assignment_id);
        setNotes(list);
        setOffline(off || tracking.offline);
      } else {
        setNotes([]);
        setOffline(tracking.offline);
      }
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message);
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { if (lastSyncAt) void load(true); }, [lastSyncAt, load]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(
    useCallback(() => {
      if (!loading) load(true);
    }, [load, loading])
  );

  const saveNote = async (type: 'photo' | 'voice' | 'text', content: string, duration?: number) => {
    if (!user || !activeEntry) return;
    setSaving(true);
    try {
      await addNote(user, activeEntry, { type, content, duration });
      await load(true);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message);
    } finally { setSaving(false); }
  };

  const handlePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert(t('common.permissionMissing'), t('notes.cameraPerm')); return; }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
    if (!result.canceled && result.assets[0].base64) {
      await saveNote('photo', `data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const handleGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6 });
    if (!result.canceled && result.assets[0].base64) {
      await saveNote('photo', `data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const startRecording = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { Alert.alert(t('common.permissionMissing'), t('notes.micPerm')); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
    setIsRecording(true);
    setRecSeconds(0);
    const timer = setInterval(() => setRecSeconds(s => s + 1), 1000);
    setRecTimer(timer);
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    if (recTimer) { clearInterval(recTimer); setRecTimer(null); }
    await audioRecorder.stop();
    const uri  = audioRecorder.uri;
    const secs = recSeconds;
    setIsRecording(false);
    setRecSeconds(0);
    if (!uri) return;
    const res  = await fetch(uri);
    const blob = await res.blob();
    const b64: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror   = reject;
      reader.readAsDataURL(blob);
    });
    await saveNote('voice', b64, secs);
  };

  const handleText = async () => {
    if (!textInput.trim()) return;
    await saveNote('text', textInput.trim());
    setTextInput('');
  };

  const filtered = activeTab === 'all' ? notes : notes.filter(n => n.type === activeTab);

  if (!activeEntry) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.header}><Text style={styles.headerTitle}>{t('notes.title')}</Text></View>
        <View style={styles.emptyBox}>
          <Ionicons name="time-outline" size={52} color={COLORS.border} />
          <Text style={styles.emptyTitle}>{t('notes.notClockedIn')}</Text>
          <Text style={styles.emptyText}>{t('notes.clockInFirst')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}><Text style={styles.headerTitle}>{t('notes.titleMedia')}</Text></View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#059669' }]} onPress={handlePhoto} disabled={saving}>
          <Ionicons name="camera" size={20} color="#fff" />
          <Text style={styles.actionText}>{t('notes.photo')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#6366f1' }]} onPress={handleGallery} disabled={saving}>
          <Ionicons name="images" size={20} color="#fff" />
          <Text style={styles.actionText}>{t('notes.gallery')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: isRecording ? COLORS.accent : '#3b82f6' }]}
          onPress={isRecording ? stopRecording : startRecording}
          disabled={saving}
        >
          <Ionicons name={isRecording ? 'stop-circle' : 'mic'} size={20} color="#fff" />
          <Text style={styles.actionText}>{isRecording ? `${recSeconds}s` : t('notes.audio')}</Text>
        </TouchableOpacity>
      </View>

      {/* Text input */}
      <View style={styles.textRow}>
        <TextInput
          style={styles.textInput}
          placeholder={t('notes.placeholder')}
          placeholderTextColor={COLORS.textLight}
          value={textInput}
          onChangeText={setTextInput}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!textInput.trim() || saving) && { opacity: 0.4 }]}
          onPress={handleText}
          disabled={!textInput.trim() || saving}
        >
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['all','photo','voice','text'] as const).map(tab => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {t(`notes.tab.${tab}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Notes list */}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />}
        {!loading && filtered.length === 0 && (
          <Text style={styles.emptyHint}>{t('notes.empty')}</Text>
        )}
        {offline && (
          <Text style={styles.offlineNote}>{t('notes.offline')}</Text>
        )}
        {filtered.map(n => (
          <View key={n.id} style={styles.noteCard}>
            <View style={styles.noteMeta}>
              <Ionicons
                name={n.type === 'photo' ? 'image-outline' : n.type === 'voice' ? 'mic-outline' : 'document-text-outline'}
                size={14} color={COLORS.textMuted}
              />
              <Text style={styles.noteAuthor}>{n.author_name}</Text>
              <Text style={styles.noteTime}>{formatTime(n.created_at)}</Text>
              {n.pending && <Ionicons name="cloud-upload-outline" size={14} color="#b45309" />}
            </View>
            {n.type === 'photo' && (
              <MediaImage content={n.content} style={styles.noteImage} resizeMode="cover" />
            )}
            {n.type === 'text' && (
              <Text style={styles.noteText}>{n.content}</Text>
            )}
            {n.type === 'voice' && (
              <View style={styles.audioRow}>
                <Ionicons name="musical-notes-outline" size={18} color={COLORS.primary} />
                <Text style={styles.audioDur}>{n.duration ? `${n.duration}s` : '—'}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  offlineNote: { fontSize: 12, color: '#92400e', backgroundColor: '#fef3c7', borderRadius: 10, padding: 10, marginBottom: 12, fontWeight: '600' },
  container:   { flex: 1, backgroundColor: COLORS.bg },
  header:      { backgroundColor: COLORS.primary, paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  emptyBox:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  emptyTitle:  { fontSize: 18, fontWeight: '800', color: COLORS.text },
  emptyText:   { fontSize: 13, color: COLORS.textMuted, textAlign: 'center' },
  actions:     { flexDirection: 'row', gap: 10, padding: 16 },
  actionBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, paddingVertical: 14 },
  actionText:  { color: '#fff', fontWeight: '800', fontSize: 13 },
  textRow:     { flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: 16, marginBottom: 12, gap: 10 },
  textInput:   {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: COLORS.text, maxHeight: 100,
  },
  sendBtn:     {
    backgroundColor: COLORS.primary, width: 44, height: 44, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  tabs:        { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 4 },
  tab:         { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff' },
  tabActive:   { backgroundColor: COLORS.primary },
  tabText:     { fontSize: 11, fontWeight: '700', color: COLORS.textMuted },
  tabTextActive:{ color: '#fff' },
  emptyHint:   { textAlign: 'center', color: COLORS.textMuted, marginTop: 32, fontSize: 13 },
  noteCard:    { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  noteMeta:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  noteAuthor:  { fontSize: 11, fontWeight: '700', color: COLORS.text, flex: 1 },
  noteTime:    { fontSize: 10, color: COLORS.textMuted },
  noteImage:   { width: '100%', height: 180, borderRadius: 10 },
  noteText:    { fontSize: 13, color: COLORS.text, lineHeight: 20 },
  audioRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioDur:    { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
});
