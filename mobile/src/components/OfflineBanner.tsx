import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';

/**
 * Bottom overlay that appears when the device loses connectivity.
 * Renders nothing while online, so it never shifts the layout.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const check = async () => {
      try {
        const net = await Network.getNetworkStateAsync();
        if (mounted.current) setOffline(net?.isConnected === false);
      } catch {
        // Ignore — assume online if the state can't be read.
      }
    };
    check();
    const id = setInterval(check, 4000);
    return () => { mounted.current = false; clearInterval(id); };
  }, []);

  if (!offline) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.pill}>
        <Ionicons name="cloud-offline-outline" size={15} color="#fff" />
        <Text style={styles.text}>Keine Verbindung</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'ios' ? 92 : 78,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#dc2626',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
});
