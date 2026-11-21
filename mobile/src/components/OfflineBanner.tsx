import { View, Text, StyleSheet, Platform, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '@/sync/SyncContext';

/**
 * Hinweis unten über der Tab-Leiste:
 *  - rot    "Keine Verbindung · 3 warten"   (alles bleibt gespeichert)
 *  - orange "Wird gesendet … 3"              (Netz da, Postausgang läuft)
 *  - rot    "2 nicht gespeichert – antippen" (Server hat abgelehnt)
 * Nichts zu tun → keine Anzeige, das Layout verschiebt sich nicht.
 */
export function OfflineBanner() {
  const { online, pending, failed, syncNow, retry, discard } = useSync();

  const showFailed = () => {
    const list = failed.map(f => `• ${f.label}\n  ${f.error}`).join('\n\n');
    Alert.alert(
      `${failed.length} Vorgang${failed.length === 1 ? '' : 'e'} nicht gespeichert`,
      `${list}\n\nBitte ggf. das Büro informieren.`,
      [
        { text: 'Schließen', style: 'cancel' },
        { text: 'Erneut versuchen', onPress: () => { failed.forEach(f => { void retry(f); }); } },
        {
          text: 'Verwerfen',
          style: 'destructive',
          onPress: () => Alert.alert('Wirklich verwerfen?', 'Diese Vorgänge werden vom Handy gelöscht.', [
            { text: 'Abbrechen', style: 'cancel' },
            { text: 'Verwerfen', style: 'destructive', onPress: () => { failed.forEach(f => { void discard(f); }); } },
          ]),
        },
      ],
    );
  };

  if (failed.length > 0) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <TouchableOpacity style={[styles.pill, { backgroundColor: '#b91c1c' }]} onPress={showFailed} activeOpacity={0.85}>
          <Ionicons name="alert-circle-outline" size={15} color="#fff" />
          <Text style={styles.text}>{failed.length} nicht gespeichert – antippen</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!online) {
    return (
      <View style={styles.wrap} pointerEvents="none">
        <View style={[styles.pill, { backgroundColor: '#dc2626' }]}>
          <Ionicons name="cloud-offline-outline" size={15} color="#fff" />
          <Text style={styles.text}>
            Keine Verbindung{pending > 0 ? ` · ${pending} wartet${pending === 1 ? '' : 'en'} (gespeichert)` : ''}
          </Text>
        </View>
      </View>
    );
  }

  if (pending > 0) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <TouchableOpacity style={[styles.pill, { backgroundColor: '#d97706' }]} onPress={() => { void syncNow(); }} activeOpacity={0.85}>
          <Ionicons name="cloud-upload-outline" size={15} color="#fff" />
          <Text style={styles.text}>Wird gesendet … {pending}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
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
