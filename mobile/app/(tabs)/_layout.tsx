import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/utils/constants';
import { useAuth } from '@/context/AuthContext';

export default function TabLayout() {
  const { user } = useAuth();
  const isLeader = user?.role === 'LEADER' || user?.role === 'ADMIN';

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
          height:          64,
          paddingBottom:   8,
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
