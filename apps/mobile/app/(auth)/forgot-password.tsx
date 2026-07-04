import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Button, Card, ErrorBanner, Field, Hero, SecurityFooter, TextLink, styles } from '@/components';
import { authService } from '@/auth-service';

const RESEND_SECONDS = 30;

/** Enmascara el correo para confirmar sin revelarlo: juan@banco.com → j***@banco.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Countdown de reenvío.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit() {
    setError(null);
    setLoading(true);
    const res = await authService.forgotPassword(email.trim().toLowerCase());
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setSent(true);
    setCooldown(RESEND_SECONDS);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Recupera el acceso a tu cuenta" />
        <Card>
          {!sent ? (
            <>
              <Text style={styles.title}>Recuperar contraseña</Text>
              <Text style={styles.subtitle}>
                Ingresa tu correo y te enviaremos un enlace para restablecerla.
              </Text>
              <ErrorBanner message={error} />
              <Field
                label="Correo"
                value={email}
                onChangeText={setEmail}
                placeholder="tu@empresa.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                error={!!error}
              />
              <Button label="Enviar enlace" onPress={submit} loading={loading} disabled={!email} />
              <TextLink label="Volver a iniciar sesión" onPress={() => router.replace('/(auth)/login')} />
            </>
          ) : (
            <>
              <Text style={styles.title}>Revisa tu correo</Text>
              <Text style={styles.subtitle}>
                Si <Text style={{ fontWeight: '600' }}>{maskEmail(email.trim().toLowerCase())}</Text> está
                registrado, te enviamos un enlace para restablecer tu contraseña. Ábrelo en este dispositivo
                para continuar.
              </Text>
              <ErrorBanner message={error} />
              <Button
                label={cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Reenviar enlace'}
                onPress={submit}
                loading={loading}
                disabled={cooldown > 0}
              />
              <TextLink label="Volver a iniciar sesión" onPress={() => router.replace('/(auth)/login')} />
            </>
          )}
        </Card>
        <SecurityFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
