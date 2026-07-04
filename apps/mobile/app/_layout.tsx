import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getSession, isSessionValid } from '@/session';
import { isBiometricEnabled } from '@/biometric';

export default function RootLayout() {
  const appState = useRef(AppState.currentState);

  // Endurecimiento (historia 15): al volver a primer plano, re-evaluar la sesión.
  // Si la biometría está activa o la ventana de inactividad (8h) venció → volver al
  // splash, que fuerza desbloqueo / re-login.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasBackground = /inactive|background/.test(appState.current);
      appState.current = next;
      if (!wasBackground || next !== 'active') return;
      void (async () => {
        const session = await getSession();
        if (!session) return; // sin sesión → ya está en login
        if (!isSessionValid(session) || (await isBiometricEnabled())) {
          router.replace('/');
        }
      })();
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8F9FB' } }} />
    </SafeAreaProvider>
  );
}
