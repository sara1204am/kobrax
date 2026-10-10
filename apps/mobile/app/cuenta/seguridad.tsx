import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING, TYPE } from '@/theme';
import { Header, ListRow, OfflineIndicator, SectionLabel, StatusBadge } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { authService, type Me } from '@/auth-service';

/**
 * Seguridad de la cuenta (U1–U3): contraseña, segundo factor y dispositivos. Todo exige señal (son credenciales: no se
 * encolan) y nada de acá se guarda en el teléfono.
 */
export default function SeguridadScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const res = await authService.me();
    if (res.status === 'ok') setMe(res.me);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const disable = async () => {
    setBusy(true);
    setError(null);
    const res = await authService.mfaDisable(password);
    setBusy(false);
    if ('error' in res) return setError(res.error);
    setDisabling(false);
    setPassword('');
    await load();
  };

  const regenerate = () => {
    Alert.alert('Generar códigos nuevos', 'Los códigos de respaldo anteriores dejan de servir. ¿Continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Generar',
        onPress: async () => {
          setBusy(true);
          setError(null);
          const res = await authService.mfaRegenerate();
          setBusy(false);
          if ('error' in res) return setError(res.error);
          setCodes(res.backupCodes);
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Seguridad" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />

        <SectionLabel>Contraseña</SectionLabel>
        <ListRow
          title="Cambiar contraseña"
          subtitle="Al cambiarla se cierran tus sesiones y volvés a entrar"
          icon="key-outline"
          onPress={() => router.push('/(app)/force-password-change?voluntary=1')}
        />

        <SectionLabel>Verificación en dos pasos</SectionLabel>
        <ListRow
          title="Segundo factor (MFA)"
          subtitle={me?.mfaEnabled ? 'Activado' : 'Desactivado'}
          icon="shield-checkmark-outline"
          right={<StatusBadge label={me?.mfaEnabled ? 'Activo' : 'Inactivo'} tone={me?.mfaEnabled ? 'success' : 'warning'} />}
        />
        {me && !me.mfaEnabled && (
          <Button label="Activar verificación en dos pasos" onPress={() => router.push('/(auth)/mfa-setup?authed=1')} />
        )}
        {me?.mfaEnabled && !disabling && !codes && (
          <View style={{ gap: SPACING.sm }}>
            <Button label="Generar códigos de respaldo nuevos" variant="ghost" onPress={regenerate} loading={busy} />
            <Button label="Desactivar" variant="ghost" onPress={() => setDisabling(true)} />
          </View>
        )}
        {me?.mfaEnabled && disabling && (
          <View style={{ gap: SPACING.sm }}>
            <Text style={TYPE.secondary}>Confirmá con tu contraseña para desactivar el segundo factor.</Text>
            <Field
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              error={!!error}
            />
            <Button label="Desactivar" onPress={() => void disable()} loading={busy} disabled={busy || !password} />
            <Button label="Volver" variant="ghost" onPress={() => { setDisabling(false); setPassword(''); setError(null); }} disabled={busy} />
          </View>
        )}
        {codes && (
          <View style={{ gap: SPACING.sm }}>
            <Text style={TYPE.secondary}>
              Guardá estos códigos en un lugar seguro. Cada uno sirve una sola vez y no se vuelven a mostrar.
            </Text>
            {codes.map((c) => (
              <Text key={c} selectable style={{ ...TYPE.body, fontFamily: 'monospace', color: COLORS.navy }}>
                {c}
              </Text>
            ))}
            <Button label="Ya los guardé" onPress={() => setCodes(null)} />
          </View>
        )}

        <SectionLabel>Dispositivos</SectionLabel>
        <ListRow
          title="Sesiones activas"
          subtitle="Dónde tenés la cuenta abierta"
          icon="phone-portrait-outline"
          onPress={() => router.push('/cuenta/sesiones')}
        />
      </ScrollView>
    </View>
  );
}
