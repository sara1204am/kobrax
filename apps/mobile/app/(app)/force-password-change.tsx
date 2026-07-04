import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { isPasswordValid } from '@kobrax/shared';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Hero,
  PasswordChecklist,
  SecurityFooter,
  TextLink,
  styles,
} from '@/components';
import { COLORS } from '@/theme';
import { authService } from '@/auth-service';

/**
 * Cambio de contraseña (historia 12). Por defecto es **forzado** (se llega vía
 * `routeAfterAuth` cuando `requiresPasswordChange` es true, sin escape). Con `?voluntary=1`
 * permite volver. El backend revoca todas las sesiones → al terminar se fuerza re-login.
 */
export default function ForcePasswordChangeScreen() {
  const { voluntary } = useLocalSearchParams<{ voluntary?: string }>();
  const isVoluntary = voluntary === '1';

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !!current && isPasswordValid(next) && next === confirm;

  async function submit() {
    setError(null);
    setLoading(true);
    const res = await authService.changePassword(current, next);
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setDone(true);
    // La sesión local ya se limpió; mandamos al login.
    setTimeout(() => router.replace('/(auth)/login'), 1600);
  }

  if (done) {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Seguridad de la cuenta" />
        <Card>
          <Text style={styles.title}>Contraseña actualizada</Text>
          <Text style={styles.subtitle}>
            Por seguridad cerramos todas tus sesiones. Inicia sesión de nuevo…
          </Text>
        </Card>
        <SecurityFooter />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Seguridad de la cuenta" />
        <Card>
          <Text style={styles.title}>{isVoluntary ? 'Cambiar contraseña' : 'Actualiza tu contraseña'}</Text>
          <Text style={styles.subtitle}>
            {isVoluntary
              ? 'Elige una nueva contraseña para tu cuenta.'
              : 'Debes establecer una nueva contraseña antes de continuar.'}
          </Text>
          <ErrorBanner message={error} />
          <Field
            label="Contraseña actual"
            value={current}
            onChangeText={setCurrent}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            error={!!error}
          />
          <Field
            label="Nueva contraseña"
            value={next}
            onChangeText={setNext}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
          />
          <PasswordChecklist password={next} />
          <Field
            label="Confirmar nueva contraseña"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            error={mismatch}
          />
          {mismatch && (
            <Text style={{ ...styles.subtitle, color: COLORS.danger }}>Las contraseñas no coinciden.</Text>
          )}
          <Button label="Actualizar contraseña" onPress={submit} loading={loading} disabled={!canSubmit} />
          {isVoluntary && <TextLink label="Cancelar" onPress={() => router.back()} />}
        </Card>
        <SecurityFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
