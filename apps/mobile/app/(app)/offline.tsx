import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, Hero, SecurityFooter, TextLink, styles } from '@/components';
import { COLORS, SPACING } from '@/theme';
import { clearSession, getSession, isSessionValid } from '@/session';
import { clearBiometric } from '@/biometric';
import { routeAfterAuth } from '@/post-login';

/** "2h 15min" a partir de los milisegundos restantes. */
function formatRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/**
 * Modo sin conexión (EPIC-F2b historia 14). Se entra aquí cuando la API es inalcanzable
 * pero la ventana offline (`sessionValidUntil`) sigue vigente. Si la ventana venció sin red,
 * se exige reconexión (→ login).
 */
export default function OfflineScreen() {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    void (async () => {
      const session = await getSession();
      if (!isSessionValid(session)) {
        // La ventana offline venció: sin red no se puede continuar.
        router.replace('/(auth)/login');
        return;
      }
      setRemainingMs(session.validUntil - Date.now());
    })();
  }, []);

  async function retry() {
    setRetrying(true);
    // routeAfterAuth reintenta /me: si hay red → home; si no → vuelve aquí.
    await routeAfterAuth();
    setRetrying(false);
  }

  async function logout() {
    await Promise.all([clearSession(), clearBiometric()]);
    router.replace('/(auth)/login');
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Hero subtitle="Trabaja sin conexión" />
      <Card>
        <View
          style={{
            backgroundColor: COLORS.warningBg,
            borderLeftWidth: 3,
            borderLeftColor: COLORS.warning,
            borderRadius: 6,
            padding: SPACING.md,
            gap: 4,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.warningText }}>
            Sin conexión a internet
          </Text>
          <Text style={{ fontSize: 13, color: COLORS.warningText }}>
            {remainingMs !== null
              ? `Tu sesión offline sigue activa por ${formatRemaining(remainingMs)}.`
              : 'Verificando tu sesión local…'}
          </Text>
        </View>
        <Text style={styles.subtitle}>
          Puedes seguir trabajando; tus cambios se sincronizarán al recuperar la señal. Cuando vuelvas a
          tener internet, reintenta para revalidar tu sesión.
        </Text>
        <Button label="Reintentar conexión" onPress={retry} loading={retrying} />
        <TextLink label="Cerrar sesión" onPress={logout} />
      </Card>
      <SecurityFooter />
    </ScrollView>
  );
}
