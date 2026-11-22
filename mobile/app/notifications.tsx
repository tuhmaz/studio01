/** Benachrichtigungen: Liste in der App-Sprache, Antippen öffnet die passende Seite. */
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/api/client';
import { COLORS } from '@/utils/constants';
import { currentLang, dateLocale, rtlFlip, t } from '@/i18n';
import { routeFor, useNotifications, type AppNotification } from '@/notifications/NotificationsContext';

function ago(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return t('notif.justNow');
  if (min < 60) return t('notif.minAgo', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('notif.hoursAgo', { n: h });
  return new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' });
}

const ICONS: Record<string, string> = {
  'assignment.new': 'calendar',
  'assignment.moved': 'swap-horizontal',
  'assignment.cancelled': 'close-circle',
  'clockout.reminder': 'time',
  'clockout.office': 'time',
  'defect.new': 'warning',
};

export default function NotificationsScreen() {
  const { setUnread, permission } = useNotifications();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: AppNotification[]; unread: number }>(`/api/notifications?limit=100&lang=${currentLang()}`);
      setItems(res.data);
      setUnread(res.unread);
      setError(null);
    } catch {
      setError(t('notif.offline'));
    } finally {
      setRefreshing(false);
    }
  }, [setUnread]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markRead = async (body: { ids?: string[]; all?: true }) => {
    setItems(prev => prev?.map(i => (body.all || body.ids?.includes(i.id) ? { ...i, read: true } : i)) ?? prev);
    try {
      await apiFetch('/api/notifications', { method: 'POST', body });
    } catch { /* offline */ }
    load();
  };

  const open = (item: AppNotification) => {
    if (!item.read) markRead({ ids: [item.id] });
    const target = routeFor(item.kind, item.link);
    if (target !== '/notifications') router.push(target as never);
  };

  const unread = items?.some(i => !i.read);

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))} style={s.back}>
          <Ionicons name="chevron-back" size={24} color="#fff" style={rtlFlip} />
        </TouchableOpacity>
        <Text style={s.title}>{t('notif.title')}</Text>
        {unread ? (
          <TouchableOpacity onPress={() => markRead({ all: true })} style={s.markAll}>
            <Ionicons name="checkmark-done" size={16} color="#fff" />
            <Text style={s.markAllText}>{t('notif.markAll')}</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
      </View>

      {permission === 'denied' && (
        <TouchableOpacity style={s.permission} onPress={() => Linking.openSettings()}>
          <Ionicons name="notifications-off-outline" size={18} color={"#b45309"} />
          <View style={{ flex: 1 }}>
            <Text style={s.permissionText}>{t('notif.permissionOff')}</Text>
            <Text style={s.permissionLink}>{t('notif.openSettings')}</Text>
          </View>
        </TouchableOpacity>
      )}

      {items === null && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name={error ? 'cloud-offline-outline' : 'notifications-outline'} size={42} color={COLORS.textLight} />
              <Text style={s.emptyText}>{error ?? t('notif.empty')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={[s.card, !item.read && s.cardUnread]} onPress={() => open(item)}>
              <View style={[s.icon, !item.read && s.iconUnread]}>
                <Ionicons name={(ICONS[item.kind] ?? 'notifications') as any} size={18} color={item.read ? COLORS.textLight : COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.cardTitle, !item.read && { fontWeight: '800' }]}>{item.title}</Text>
                <Text style={s.cardBody}>{item.body}</Text>
                <Text style={s.cardTime}>{ago(item.created_at)}</Text>
              </View>
              {!item.read && <View style={s.dot} />}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    backgroundColor: COLORS.primary, paddingTop: 56, paddingBottom: 16, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', flex: 1, textAlign: 'center' },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  markAllText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  permission: {
    flexDirection: 'row', gap: 10, margin: 16, marginBottom: 0, padding: 12, borderRadius: 12,
    backgroundColor: '#fef3c7',
  },
  permissionText: { color: '#78350f', fontSize: 13 },
  permissionLink: { color: '#92400e', fontSize: 13, fontWeight: '800', marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },
  card: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: '#fff',
    borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  cardUnread: { borderColor: COLORS.primary + '55', backgroundColor: '#f5f8ff' },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  iconUnread: { backgroundColor: COLORS.primary + '18' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  cardBody: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  cardTime: { fontSize: 11, color: COLORS.textLight, marginTop: 6, opacity: 0.8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 6 },
});
