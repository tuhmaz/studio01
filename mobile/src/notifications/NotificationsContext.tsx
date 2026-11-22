/**
 * Benachrichtigungen in der App.
 *
 *  - Nach der Anmeldung: Erlaubnis fragen, Expo-Push-Token holen und mit der
 *    App-Sprache beim Server anmelden (bei Sprachwechsel erneut, damit Pushes in
 *    der neuen Sprache kommen). Beim Abmelden wird das Token entfernt.
 *  - Zähler „ungelesen“ für die Glocke: beim Start, bei jedem eintreffenden
 *    Push und wenn die App wieder in den Vordergrund kommt.
 *  - Antippen eines Pushes öffnet die passende Seite.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { apiFetch } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { currentLang, useI18n } from '@/i18n';
import { registerDevice, type PushPermission } from '@/notifications/device';

export type { PushPermission };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

/** Seite in der App zu einem Link des Servers. */
export function routeFor(kind: string | undefined, link: string | null | undefined): string {
  if (kind?.startsWith('clockout.') || link === '/tracking') return '/(tabs)/tracking';
  return '/notifications';
}

interface State {
  unread: number;
  permission: PushPermission;
  refresh: () => Promise<void>;
  setUnread: (n: number) => void;
}

const Ctx = createContext<State>({ unread: 0, permission: 'unknown', refresh: async () => {}, setUnread: () => {} });

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [unread, setUnread] = useState(0);
  const [permission, setPermission] = useState<PushPermission>('unknown');
  const handled = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch<{ unread: number }>(`/api/notifications?limit=1&lang=${currentLang()}`);
      setUnread(res.unread ?? 0);
    } catch {
      // offline – Zähler bleibt
    }
  }, [user]);

  // Gerät anmelden – nach Login und bei Sprachwechsel.
  useEffect(() => {
    if (!user) return;
    registerDevice().then(setPermission, () => setPermission('unknown'));
  }, [user?.id, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) { setUnread(0); return; }
    refresh();
    const received = Notifications.addNotificationReceivedListener(() => refresh());
    const app = AppState.addEventListener('change', s => s === 'active' && refresh());
    return () => { received.remove(); app.remove(); };
  }, [user, refresh]);

  // Push angetippt – auch wenn die App dadurch erst gestartet wurde.
  useEffect(() => {
    if (!user) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const data = response.notification.request.content.data as { id?: string; kind?: string; link?: string } | undefined;
      if (data?.id) apiFetch('/api/notifications', { method: 'POST', body: { ids: [data.id] } }).then(refresh, () => {});
      router.push(routeFor(data?.kind, data?.link) as never);
    };
    Notifications.getLastNotificationResponseAsync().then(open, () => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [user, refresh]);

  return <Ctx.Provider value={{ unread, permission, refresh, setUnread }}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  return useContext(Ctx);
}
