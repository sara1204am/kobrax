import { useEffect } from 'react';
import { View } from 'react-native';
import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { OfflineIndicator } from '@/ui';
import { subscribeConnectivity } from '@/store/net';
import { authService } from '@/auth-service';
import { hydrate } from '@/sync/hydrate';
import { startSync } from '@/sync/sync.service';
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

  // Hidratación de oficina (P6): al entrar al shell se baja la jornada a la base local, para que
  // después opere sin señal. Va acá y no en `routeAfterAuth` a propósito — es un efecto, no una
  // decisión de ruteo, y **nunca se espera**: si no hay red, falla en silencio y se reintenta al
  // volver a entrar. El cobrador no mira una pantalla de carga por esto.
  useEffect(() => {
    let stopSync: (() => void) | undefined;
    void (async () => {
      const me = await authService.me();
      if (me.status !== 'ok') return;
      // El motor de sync arranca ANTES de hidratar: lo que el cobrador hizo ayer sin señal sube
      // primero, y recién después se baja lo nuevo. Al revés, una hidratación lenta retrasaría
      // un pago que ya está esperando.
      stopSync = startSync(me.me.userId);
      await hydrate(me.me.userId);
    })();
    return () => stopSync?.();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <OfflineIndicator onPressPending={() => router.push('/pendientes')} />
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
