import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, ErrorBanner, Hero, SecurityFooter, TextLink, styles } from '@/components';
import { COLORS } from '@/theme';
import { authenticateBiometric, biometricLabel, clearBiometric } from '@/biometric';
import { clearSession } from '@/session';
import { routeAfterAuth } from '@/post-login';

/**
 * Desbloqueo biométrico (EPIC-F2b historia 13). La biometría SOLO desbloquea el token
 * local ya guardado; no llama a la API. Si el usuario no puede/quiere, cae a re-login.
 */
export default function UnlockScreen() {
  const [label, setLabel] = useState('biometría');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryUnlock = useCallback(async () => {
    setError(null);
    setBusy(true);
    const ok = await authenticateBiometric('Desbloquea Kobrax');
    setBusy(false);
    if (ok) {
      await routeAfterAuth();
      return;
    }
    setError('No pudimos verificar tu identidad. Intenta de nuevo o usa tu contraseña.');
  }, []);

  useEffect(() => {
    void biometricLabel().then(setLabel);
    void tryUnlock(); // lanza el prompt automáticamente al abrir
  }, [tryUnlock]);

  async function usePassword() {
    // Volver al login limpia la sesión local y desactiva la biometría guardada.
    await Promise.all([clearSession(), clearBiometric()]);
    router.replace('/(auth)/login');
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Hero subtitle="Sesión protegida" />
      <Card>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 40 }}>🔐</Text>
          <Text style={styles.title}>Desbloquea Kobrax</Text>
          <Text style={[styles.subtitle, { textAlign: 'center' }]}>
            Usa tu {label} para volver a tu sesión.
          </Text>
        </View>
        <ErrorBanner message={error} />
        <Button label="Desbloquear" onPress={tryUnlock} loading={busy} />
        <TextLink label="Usar contraseña" onPress={usePassword} />
        <Text style={{ ...styles.subtitle, textAlign: 'center', color: COLORS.muted }}>
          La biometría solo desbloquea este dispositivo; nunca sustituye tu contraseña.
        </Text>
      </Card>
      <SecurityFooter />
    </ScrollView>
  );
}
