import { useEffect } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { OfflineIndicator } from '@/ui';
import { subscribeConnectivity } from '@/store/net';
import { COLORS } from '@/theme';

/**
 * Shell de campo (F10 Slice 0, H0.3). 5 tabs tal cual Figma `42:3069`:
 * Inicio · Agenda · Rutas · Cobranza · Más. El tab bar nativo de expo-router
 * cubre el TabBar del diseño; se tiñe con tokens (navy activo).
 */
type IconName = keyof typeof Ionicons.glyphMap;

function tab(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => <Ionicons name={name} size={size} color={color} />;
}

export default function TabsLayout() {
  useEffect(subscribeConnectivity, []);
  return (
    <View style={{ flex: 1 }}>
      <OfflineIndicator />
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.navy,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarStyle: { backgroundColor: COLORS.white, borderTopColor: COLORS.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: tab('grid-outline') }} />
      <Tabs.Screen name="agenda" options={{ title: 'Agenda', tabBarIcon: tab('calendar-outline') }} />
      <Tabs.Screen name="rutas" options={{ title: 'Rutas', tabBarIcon: tab('map-outline') }} />
      <Tabs.Screen name="cobranza" options={{ title: 'Cobranza', tabBarIcon: tab('document-text-outline') }} />
      <Tabs.Screen name="mas" options={{ title: 'Más', tabBarIcon: tab('ellipsis-horizontal') }} />
      </Tabs>
    </View>
  );
}
