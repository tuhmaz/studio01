/**
 * Checklist of one visit (Leistungsnachweis).
 *
 * One row per service: tap the camera for a before photo, tap ✓ when done
 * (or take the after photo, which also marks it done), or ✗ with a short
 * reason when it was not possible. Every tap is saved right away – on the
 * server, or without signal on the phone (sent later, with the time of the tap).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { MediaImage } from '@/components/MediaImage';
import { hasKey, t, type Key } from '@/i18n';
import { de } from '@/i18n/locales/de';

const QUICK_REASONS = ['check.reason.noAccess', 'check.reason.parked', 'check.reason.weather', 'check.reason.noMaterial'] as const;
import { useAuth } from '@/context/AuthContext';
import { COLORS } from '@/utils/constants';
import { checkService, loadChecklist, type ChecklistData, type ChecklistItem as Item } from '@/sync/field';

async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(t('common.permissionMissing'), t('common.allowCamera'));
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 });
  if (result.canceled || !result.assets[0].base64) return null;
  return `data:image/jpeg;base64,${result.assets[0].base64}`;
}

export function ChecklistModal({ assignmentId, onClose }: { assignmentId: string; onClose: (done: number, total: number) => void }) {
  const { user } = useAuth();
  const [data, setData] = useState<ChecklistData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setData(await loadChecklist(user, assignmentId));
    } catch (e: any) {
      Alert.alert(t('check.unavailable'), e?.message ?? t('check.checkConnection'));
      onClose(0, 0);
    }
  }, [assignmentId, onClose, user]);

  useEffect(() => { load(); }, [load]);

  const send = async (code: string, body: Parameters<typeof checkService>[3]) => {
    const item = data?.items.find(i => i.code === code);
    if (!user || !item) return;
    setBusy(code);
    try {
      await checkService(user, assignmentId, item, body);
      await load();
    } catch (e: any) {
      Alert.alert(t('common.notSaved'), e?.message ?? t('check.tryAgain'));
    } finally {
      setBusy(null);
    }
  };

  const before = async (item: Item) => {
    const photo = await takePhoto();
    if (photo) await send(item.code, { status: 'started', beforePhoto: photo });
  };

  const after = async (item: Item) => {
    const photo = await takePhoto();
    if (photo) await send(item.code, { status: 'done', afterPhoto: photo });
  };

  const toggleDone = (item: Item) =>
    send(item.code, { status: item.check?.status === 'done' ? 'open' : 'done' });

  const submitReason = async () => {
    if (!reasonFor || reason.trim().length < 3) return;
    const code = reasonFor;
    setReasonFor(null);
    await send(code, { status: 'not_possible', reason: reason.trim() });
    setReason('');
  };

  const items = data?.items ?? [];
  const finished = items.filter(i => i.check?.status === 'done' || i.check?.status === 'not_possible').length;

  return (
    <Modal visible animationType="slide" onRequestClose={() => onClose(finished, items.length)}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => onClose(finished, items.length)} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{t('check.title')}</Text>
            <Text style={s.sub} numberOfLines={1}>{data?.assignment.site?.name ?? data?.assignment.title ?? ''}</Text>
          </View>
          {data && <Text style={s.counter}>{finished}/{items.length}</Text>}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {!data && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />}
          {data?.offline && (
            <Text style={s.offline}>{t('check.offline')}</Text>
          )}
          {data && items.length === 0 && (
            <Text style={s.empty}>{t('check.empty')}</Text>
          )}
          {items.map(item => {
            const status = item.check?.status;
            const isBusy = busy === item.code;
            return (
              <View key={item.code} style={[s.card, status === 'done' && s.cardDone, status === 'not_possible' && s.cardFailed]}>
                <View style={s.row}>
                  <Text style={s.label}>{hasKey(`svc.${item.code}`) ? t(`svc.${item.code}` as Key) : item.label}</Text>
                  {isBusy && <ActivityIndicator color={COLORS.primary} />}
                </View>
                {status === 'not_possible' && <Text style={s.reason}>{t('check.notPossible', { reason: item.check?.reason ?? '' })}</Text>}
                {item.check?.pending && <Text style={s.pending}>{t('check.pending')}</Text>}

                <View style={s.photos}>
                  {item.check?.before_url
                    ? <MediaImage content={item.check.before_url} style={s.thumb} resizeMode="cover" />
                    : null}
                  {item.check?.after_url
                    ? <MediaImage content={item.check.after_url} style={s.thumb} resizeMode="cover" />
                    : null}
                </View>

                <View style={s.actions}>
                  <TouchableOpacity style={s.btn} onPress={() => before(item)} disabled={isBusy}>
                    <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
                    <Text style={s.btnText}>{t('check.before')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btn} onPress={() => after(item)} disabled={isBusy}>
                    <Ionicons name="camera" size={18} color={COLORS.primary} />
                    <Text style={s.btnText}>{t('check.after')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.iconBtn, status === 'not_possible' && { backgroundColor: COLORS.danger }]}
                    onPress={() => (status === 'not_possible' ? send(item.code, { status: 'open' }) : setReasonFor(item.code))}
                    disabled={isBusy}
                  >
                    <Ionicons name="close" size={22} color={status === 'not_possible' ? '#fff' : COLORS.danger} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.iconBtn, status === 'done' && { backgroundColor: COLORS.success }]}
                    onPress={() => toggleDone(item)}
                    disabled={isBusy}
                  >
                    <Ionicons name="checkmark" size={22} color={status === 'done' ? '#fff' : COLORS.success} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          {data && items.length > 0 && (
            <Text style={s.hint}>{t('check.hint')}</Text>
          )}
        </ScrollView>

        <Modal visible={reasonFor !== null} transparent animationType="fade" onRequestClose={() => setReasonFor(null)}>
          <View style={s.overlay}>
            <View style={s.dialog}>
              <Text style={s.dialogTitle}>{t('check.whyNot')}</Text>
              <View style={s.quickReasons}>
                {/* Anzeige in der Sprache des Mitarbeiters, gespeichert auf Deutsch –
                    der Grund steht im Leistungsnachweis der Hausverwaltung. */}
                {QUICK_REASONS.map(key => (
                  <TouchableOpacity key={key} style={s.quick} onPress={() => setReason(de[key])}>
                    <Text style={s.quickText}>{t(key)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder={t('check.reason')} placeholderTextColor={COLORS.textLight} />
              <Text style={s.hint}>{t('check.reasonHint')}</Text>
              <View style={s.dialogActions}>
                <TouchableOpacity onPress={() => { setReasonFor(null); setReason(''); }}>
                  <Text style={s.cancel}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={submitReason} disabled={reason.trim().length < 3}>
                  <Text style={[s.confirm, reason.trim().length < 3 && { opacity: 0.4 }]}>{t('common.save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: COLORS.bg },
  header:     { backgroundColor: COLORS.primary, paddingTop: 56, paddingBottom: 18, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title:      { color: '#fff', fontSize: 20, fontWeight: '900' },
  sub:        { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  counter:    { color: '#fff', fontSize: 18, fontWeight: '900' },
  empty:      { textAlign: 'center', color: COLORS.textMuted, marginTop: 40 },
  card:       { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 2, borderColor: 'transparent' },
  cardDone:   { borderColor: '#bbf7d0' },
  cardFailed: { borderColor: '#fecaca' },
  row:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label:      { fontSize: 15, fontWeight: '800', color: COLORS.text, flex: 1 },
  reason:     { fontSize: 12, color: COLORS.danger, marginTop: 4, fontWeight: '600' },
  pending:    { fontSize: 11, color: '#b45309', marginTop: 4, fontWeight: '700' },
  offline:    { fontSize: 12, color: '#92400e', backgroundColor: '#fef3c7', borderRadius: 10, padding: 10, marginBottom: 12, fontWeight: '600' },
  photos:     { flexDirection: 'row', gap: 8, marginTop: 8 },
  thumb:      { width: 72, height: 54, borderRadius: 8 },
  actions:    { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  btn:        { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 10, paddingVertical: 8 },
  btnText:    { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  iconBtn:    { marginLeft: 'auto', width: 44, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  hint:       { textAlign: 'center', fontSize: 11, color: COLORS.textMuted, marginTop: 8 },
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  dialog:     { backgroundColor: '#fff', borderRadius: 18, padding: 18 },
  dialogTitle:{ fontSize: 16, fontWeight: '900', color: COLORS.text, marginBottom: 12 },
  quickReasons:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  quick:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.bg },
  quickText:  { fontSize: 12, fontWeight: '700', color: COLORS.text },
  input:      { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: COLORS.text },
  dialogActions:{ flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 16 },
  cancel:     { fontSize: 14, fontWeight: '700', color: COLORS.textMuted },
  confirm:    { fontSize: 14, fontWeight: '900', color: COLORS.primary },
});
