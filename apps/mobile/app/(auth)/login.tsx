import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorBanner, Field, TextLink } from '@/components';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { authService } from '@/auth-service';
import { goToStep } from '@/route-step';
import { biometricLabel, isBiometricEnabled } from '@/biometric';
import { getSession, isSessionValid } from '@/session';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Botón biométrico: solo si hay sesión local vigente + biometría activada.
  // La biometría solo desbloquea el token guardado (biometric.ts), no hace login fresco,
  // así que reutiliza la pantalla /unlock existente en vez de reimplementar el prompt.
  const [bio, setBio] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const session = await getSession();
      if (isSessionValid(session) && (await isBiometricEnabled())) {
        setBio(await biometricLabel());
      }
    })();
  }, []);

  async function submit() {
    setError(null);
    setLoading(true);
    const res = await authService.login(email.trim(), password);
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    goToStep(res.step);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Header navy con marca y encabezado */}
        <View style={s.header}>
          <View style={s.brandRow}>
            <View style={s.logoBadge}>
              <Text style={s.logoText}>K</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.brand}>Kobrax</Text>
              <Text style={s.brandSub}>Gestión de cobranzas en campo</Text>
            </View>
          </View>
          <Text style={s.title}>Inicia sesión</Text>
        </View>

        {/* Cuerpo con esquinas redondeadas superpuesto al header */}
        <View style={s.body}>
          <View style={s.welcomePill}>
            <View style={s.welcomeDot} />
            <Text style={s.welcomeText}>¡Bienvenido de vuelta!</Text>
          </View>

          <ErrorBanner message={error} />

          <Field
            label="Correo electrónico"
            value={email}
            onChangeText={setEmail}
            placeholder="ejemplo@empresa.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={!!error}
          />
          <Field
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            placeholder="Ingresa tu contraseña"
            secureTextEntry
            autoCapitalize="none"
            error={!!error}
          />

          <TextLink
            label="¿Olvidaste tu contraseña?"
            onPress={() => router.push('/(auth)/forgot-password')}
          />

          <Button label="Iniciar sesión" onPress={submit} loading={loading} disabled={!email || !password} />

          <TextLink label="Crear una cuenta" onPress={() => router.push('/(auth)/registro')} />

          {bio && (
            <>
              <View style={s.dividerRow}>
                <View style={s.divider} />
                <Text style={s.dividerText}>o continúa con</Text>
                <View style={s.divider} />
              </View>
              <Button label={`Face ID / ${bio}`} variant="ghost" onPress={() => router.replace('/(auth)/unlock')} />
            </>
          )}

          {/* Card de marketing (estática, fiel al diseño) */}
          <View style={s.promo}>
            <Text style={s.promoTitle}>Cobranzas más simples, resultados reales</Text>
            <View style={s.promoGrid}>
              {['Rutas optimizadas', 'Cobro en campo', 'Gestión de clientes', 'Reportes en tiempo real'].map((f) => (
                <View key={f} style={s.promoFeature}>
                  <View style={s.promoDot} />
                  <Text style={s.promoFeatureText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={s.footerPill}>
            <Text style={s.footerText}>Acceso seguro · SSL 256-bit</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: { backgroundColor: COLORS.navy, paddingTop: 48, paddingBottom: 56, paddingHorizontal: SPACING.xl, gap: SPACING.xxl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  logoBadge: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.button,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  brand: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  brandSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  title: { color: COLORS.white, fontSize: 30, fontWeight: '700' },

  body: {
    marginTop: -40,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    gap: SPACING.lg,
  },

  welcomePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.lightBg,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 6,
  },
  welcomeDot: { width: 8, height: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.navy },
  welcomeText: { color: COLORS.navy, fontSize: 14, fontWeight: '500' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  divider: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { color: COLORS.muted, fontSize: 12 },

  promo: { backgroundColor: COLORS.navy, borderRadius: RADIUS.card, padding: SPACING.xl, gap: SPACING.sm, overflow: 'hidden' },
  promoTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', lineHeight: 28 },
  promoGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: SPACING.sm },
  promoFeature: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, width: '50%', paddingVertical: SPACING.xs },
  promoDot: { width: 6, height: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.periwinkle },
  promoFeatureText: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },

  footerPill: {
    alignSelf: 'center',
    backgroundColor: COLORS.highlight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 6,
    marginTop: SPACING.sm,
  },
  footerText: { color: COLORS.text2, fontSize: 11, fontWeight: '500' },
});
