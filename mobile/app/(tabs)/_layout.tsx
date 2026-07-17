import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/utils/constants';
import { useAuth } from '@/context/AuthContext';
import { isManagement } from '@/utils/roles';

export default function TabLayout() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isLeader = isManagement(user?.role);

  return (
    <Tabs
      screenOptions={{
        headerShown:         false,
        tabBarActiveTintColor:   COLORS.primary,
        tabBarInactiveTintColor: COLORS.textLight,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth:  1,
          borderTopColor:  COLORS.border,
          // Add the bottom safe-area inset (Android nav bar / gesture area) so
          // the tabs aren't hidden behind the system navigation in edge-to-edge.
          height:          64 + insets.bottom,
          paddingBottom:   8 + insets.bottom,
          paddingTop:      6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Heute',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: 'Stempeln',
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
          tabBarBadge: undefined,
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Notizen',
          tabBarIcon: ({ color, size }) => <Ionicons name="camera-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="planning"
        options={{
          title: 'Planung',
          href: isLeader ? '/planning' : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
