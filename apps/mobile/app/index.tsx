import { useEffect } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/theme';
import { getSession, isSessionValid } from '@/session';
import { isBiometricEnabled } from '@/biometric';
import { routeAfterAuth } from '@/post-login';

/**
 * Splash/bootstrap: decide destino según la sesión guardada (SecureStore).
 * - Sin sesión o ventana de inactividad vencida → login.
 * - Biometría activada → pantalla de desbloqueo (solo desbloquea el token local).
 * - Si no → routeAfterAuth (revalida con la API; offline / cambio forzado / home).
 */
export default function Bootstrap() {
  useEffect(() => {
    void (async () => {
      const session = await getSession();
      if (!isSessionValid(session)) {
        router.replace('/(auth)/login');
        return;
      }
      if (await isBiometricEnabled()) {
        router.replace('/(auth)/unlock');
        return;
      }
      await routeAfterAuth();
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>KOBRAX</Text>
      <ActivityIndicator color={COLORS.white} style={{ marginTop: 16 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.navy },
  brand: { fontSize: 28, fontWeight: '700', color: COLORS.white, letterSpacing: 1 },
});
