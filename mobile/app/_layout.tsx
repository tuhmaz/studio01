import { Stack, router } from 'expo-router';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SyncProvider } from '@/sync/SyncContext';
import { I18nProvider } from '@/i18n';
import { NotificationsProvider } from '@/notifications/NotificationsContext';
import { COLORS } from '@/utils/constants';

function RootLayoutNav() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (user) router.replace('/(tabs)/home');
      else       router.replace('/login');
    }
  }, [user, loading]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" />
      </Stack>
      <OfflineBanner />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <AuthProvider>
            <NotificationsProvider>
              <SyncProvider>
                <RootLayoutNav />
              </SyncProvider>
            </NotificationsProvider>
          </AuthProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
