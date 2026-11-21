/** Push-Anmeldung des Geräts beim Server (Expo-Push-Token + App-Sprache). */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { apiFetch } from '@/api/client';
import { currentLang, t } from '@/i18n';

const PUSH_TOKEN_KEY = 'hp_push_token';

export type PushPermission = 'granted' | 'denied' | 'unavailable' | 'unknown';

export async function registerDevice(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: t('notif.channel'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';

  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await apiFetch('/api/push/register', {
    method: 'POST',
    body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android', lang: currentLang() },
  });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  return 'granted';
}

/** Beim Abmelden: Gerät beim Server abmelden (solange das Login-Token noch gilt). */
export async function unregisterDevice(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (token) await apiFetch('/api/push/register', { method: 'DELETE', body: { token } }, 5000);
  } catch {
    // Offline: Der Server entfernt das Token spätestens, wenn sich jemand anderes anmeldet.
  } finally {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => {});
  }
}
