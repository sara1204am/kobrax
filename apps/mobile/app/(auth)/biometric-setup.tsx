import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, ErrorBanner, Hero, SecurityFooter, TextLink, styles } from '@/components';
import {
  authenticateBiometric,
  biometricLabel,
  markBiometricPromptShown,
  setBiometricEnabled,
} from '@/biometric';

/**
 * Oferta única para activar el desbloqueo biométrico tras el login (historia 13).
 * Solo se muestra si hay hardware enrolado (lo decide `shouldOfferBiometricSetup`).
 */
export default function BiometricSetupScreen() {
  const [label, setLabel] = useState('biometría');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void biometricLabel().then(setLabel);
  }, []);

  async function enable() {
    setError(null);
    setBusy(true);
    // Confirmamos con un prompt real antes de activar (evita activar sin que funcione).
    const ok = await authenticateBiometric(`Confirma para activar ${label}`);
    if (!ok) {
      setBusy(false);
      setError('No se pudo verificar. Inténtalo de nuevo o configúralo más tarde.');
      return;
    }
    await setBiometricEnabled(true);
    await markBiometricPromptShown();
    router.replace('/(tabs)');
  }

  async function skip() {
    await markBiometricPromptShown();
    router.replace('/(tabs)');
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Hero subtitle="Acceso más rápido y seguro" />
      <Card>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 40 }}>👆</Text>
          <Text style={styles.title}>Activa {label}</Text>
          <Text style={[styles.subtitle, { textAlign: 'center' }]}>
            Desbloquea Kobrax con tu {label} en vez de escribir tu contraseña cada vez. Solo se usa en
            este dispositivo.
          </Text>
        </View>
        <ErrorBanner message={error} />
        <Button label={`Activar ${label}`} onPress={enable} loading={busy} />
        <TextLink label="Ahora no" onPress={skip} />
      </Card>
      <SecurityFooter />
    </ScrollView>
  );
}
