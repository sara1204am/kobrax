import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, ErrorBanner, Field, TextLink } from '@/components';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { authService } from '@/auth-service';
import { goToStep } from '@/route-step';
import { biometricLabel, isBiometricEnabled } from '@/biometric';
import { getSession, isSessionValid } from '@/session';
import { API_BASE } from '@/api';
import { clearLoginEmail, loadForgotDraft, loadLoginEmail, saveLoginEmail } from '@/auth-draft';
import { validateLogin, type LoginFieldErrors } from '@/auth-validation';

export default function LoginScreen() {
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Errores por campo (cliente y, si la API los manda, servidor): se pintan bajo su campo.
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [loading, setLoading] = useState(false);
  // Botón biométrico: solo si hay sesión local vigente + biometría activada.
  // La biometría solo desbloquea el token guardado (biometric.ts), no hace login fresco,
  // así que reutiliza la pantalla /unlock existente en vez de reimplementar el prompt.
  const [bio, setBio] = useState<string | null>(null);

  // Si Android recreó la app estando en "Revisa tu correo" o con el correo a medio escribir
  // (M-FOR-29 / M-LOG-12), vuelve a donde estaba. `forgot-password` limpia su borrador al salir, así
  // que esto no re-abre la pantalla después de "Volver a iniciar sesión".
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [saved, forgot] = await Promise.all([loadLoginEmail(), loadForgotDraft()]);
      if (!alive) return;
      if (saved) setEmail((cur) => cur || saved);
      if (forgot?.sentAt != null) router.push('/(auth)/forgot-password');
    })();
    return () => {
      alive = false;
    };
  }, []);

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
    const invalid = validateLogin(email, password);
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) return; // sin llamar a la API: el mensaje ya dice qué corregir
    setLoading(true);
    const res = await authService.login(email.trim(), password);
    setLoading(false);
    if ('error' in res) {
      if (res.fieldErrors) setFieldErrors(res.fieldErrors); // la API marcó el campo: aviso bajo el campo
      else setError(res.error);
      return;
    }
    void clearLoginEmail(); // ya entró (o avanzó al MFA): el borrador cumplió
    goToStep(res.step);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Header navy con marca y encabezado */}
        <View style={s.header}>
          <View style={s.brandRow}>
            {/* `logo.png` y no `icon.png`: el del ícono son 1242 px y React Native decodifica el
                PNG entero aunque se dibuje a 40 — ~6 MB de RAM por una marca. Mismo criterio que
                `Hero` en `components.tsx`. */}
            <Image
              source={require('../../assets/logo.png')}
              style={s.logoBadge}
              resizeMode="contain"
              accessibilityLabel="Kobrax"
            />
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
            onChangeText={(v) => {
              setEmail(v);
              void saveLoginEmail(v);
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            }}
            placeholder="ejemplo@empresa.com"
            keyboardType="email-address"
            autoCapitalize="none"
            // Autofill (M-LOG-39): el correo es el "usuario" del par que guarda el gestor de contraseñas
            // (Google en Android, llavero en iOS); con 'email' solo no lo empareja con la contraseña.
            autoComplete="username"
            textContentType="username"
            importantForAutofill="yes"
            // "Siguiente" pasa a la contraseña sin cerrar el teclado (M-LOG-04).
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
            error={!!error}
            errorMessage={fieldErrors.email}
          />
          <Field
            ref={passwordRef}
            label="Contraseña"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
            }}
            placeholder="Ingresa tu contraseña"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            importantForAutofill="yes"
            // "Ir" en la contraseña = tocar "Iniciar sesión" (si falta algo, avisa bajo el campo).
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            error={!!error}
            errorMessage={fieldErrors.password}
          />

          <TextLink
            label="¿Olvidaste tu contraseña?"
            onPress={() => router.push('/(auth)/forgot-password')}
          />

          <Button label="Iniciar sesión" onPress={submit} loading={loading} />

          <TextLink label="Crear una cuenta" onPress={() => router.push('/(auth)/registro')} />
          <TextLink label="Tengo una invitación" onPress={() => router.push('/(auth)/invitacion')} />

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

          {/* El sello aparece sólo si la app de verdad habla por HTTPS. "SSL 256-bit" era una
              frase de marketing que se mostraba igual apuntando a `http://`: prometía un cifrado
              que en ese caso no existía. */}
          {API_BASE.startsWith('https://') && (
            <View style={s.footerPill}>
              <Text style={s.footerText}>🔒 Acceso cifrado</Text>
            </View>
          )}
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
    width: 44,
    height: 44,
    borderRadius: RADIUS.button,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
