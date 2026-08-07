import { useEffect, useRef } from 'react';
import { AppState, View, type AppStateStatus } from 'react-native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getSession, shouldRelock } from '@/session';
import { isBiometricEnabled } from '@/biometric';
import { OfflineIndicator } from '@/ui';
import { COLORS } from '@/theme';

const AWAY = /inactive|background/;

export default function RootLayout() {
  const appState = useRef(AppState.currentState);
  const leftAt = useRef<number | null>(null);

  // Endurecimiento (historia 15): al volver a primer plano, re-evaluar la sesión.
  // Se mide CUÁNTO estuvo afuera, no sólo que volvió: un permiso de GPS, la cámara o un salto a
  // WhatsApp pausan la Activity y llegan acá como un background cualquiera. La política vive en
  // `shouldRelock` (session.ts); acá sólo se cronometra la ausencia.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasAway = AWAY.test(appState.current);
      appState.current = next;
      // Android suele encadenar active → inactive → background: sólo el primer salto marca la hora.
      if (!wasAway) {
        if (AWAY.test(next)) leftAt.current = Date.now();
        return;
      }
      if (next !== 'active') return;
      const awayMs = leftAt.current == null ? 0 : Date.now() - leftAt.current;
      leftAt.current = null;
      void (async () => {
        const session = await getSession();
        if (shouldRelock({ session, awayMs, biometricEnabled: await isBiometricEnabled() })) {
          router.replace('/');
        }
      })();
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/* El aviso de sin-conexión / pendientes vive acá y no sobre las tabs: se encolan pagos y
          visitas desde la ficha del deudor y desde el resultado de una parada, que son pantallas
          fuera del shell. Montado ahí, el cobrador cobraba sin señal y no veía ninguna señal de
          que eso quedó guardado hasta volver a una tab. Se oculta solo cuando no hay nada que decir. */}
      <View style={{ flex: 1 }}>
        <OfflineIndicator onPressPending={() => router.push('/pendientes')} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }} />
      </View>
    </SafeAreaProvider>
  );
}
