import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Button, Card, ErrorBanner, Field, Hero, SecurityFooter, TextLink, styles } from '@/components';
import { authService } from '@/auth-service';
import { clearForgotDraft, loadForgotDraft, resendSecondsLeft, saveForgotDraft } from '@/auth-draft';

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
  // El reenvío se cuenta contra el instante ABSOLUTO del envío (no restando 1 por tick): si la app
  // pasó al fondo, los timers se congelan, y al volver el reloj ya dice cuánto falta de verdad.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cooldown = resendSecondsLeft(sentAt, now);

  // Recupera lo que había si Android recreó la app (M-FOR-29): correo y paso "Revisa tu correo".
  useEffect(() => {
    let alive = true;
    void loadForgotDraft().then((d) => {
      if (!alive || !d) return;
      setEmail((cur) => cur || d.email);
      if (d.sentAt != null) {
        setSentAt(d.sentAt);
        setSent(true);
        setNow(Date.now());
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Countdown de reenvío.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [cooldown, now]);

  // Al volver del fondo se recalcula ya, sin esperar al próximo tick.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  function backToLogin() {
    void clearForgotDraft(); // si no, el login volvería a abrir esta pantalla
    router.replace('/(auth)/login');
  }

  async function submit() {
    setError(null);
    setLoading(true);
    const res = await authService.forgotPassword(email.trim().toLowerCase());
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    const at = Date.now();
    setSentAt(at);
    setNow(at);
    setSent(true);
    void saveForgotDraft(email.trim().toLowerCase(), at);
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
                onChangeText={(v) => {
                  setEmail(v);
                  void saveForgotDraft(v.trim().toLowerCase(), null);
                }}
                placeholder="tu@empresa.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                error={!!error}
              />
              <Button label="Enviar enlace" onPress={submit} loading={loading} disabled={!email} />
              <TextLink label="Volver a iniciar sesión" onPress={backToLogin} />
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
              <TextLink label="Volver a iniciar sesión" onPress={backToLogin} />
            </>
          )}
        </Card>
        <SecurityFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
