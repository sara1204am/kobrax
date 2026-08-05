import { useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
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
import { validateSignup, type SignupForm } from '@/account-form';
import { signup } from '@/account.service';
import { authService, type Step } from '@/auth-service';
import { goToStep } from '@/route-step';
import { COLORS, SPACING, TYPE } from '@/theme';

/**
 * Registro público (CUENTA · S4). Crea el tenant y entra de una: el alta no devuelve
 * tokens, así que acá se hace el login normal con lo que ya está en el formulario y se
 * delega el destino en `goToStep` (S4-D1). Para un `ACCOUNT_ADMIN` eso significa aterrizar
 * en el enrolamiento de MFA, que es obligatorio para su rol (S4-D5).
 *
 * País y moneda no se piden: arrancan en el default y se cambian en Cuenta → Datos (S4-D8).
 */
export default function RegistroScreen() {
  const [form, setForm] = useState<SignupForm>({
    businessName: '',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** La cuenta quedó creada pero el login posterior falló: reintentar el alta sería un 409 (S4-R4). */
  const [created, setCreated] = useState(false);
  /** Alta OK y sesión resuelta: se confirma antes de mandarla al paso siguiente. */
  const [done, setDone] = useState<Step | null>(null);

  const set = (k: keyof SignupForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const invalid = validateSignup(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setLoading(true);

    const email = form.email.trim().toLowerCase();
    const res = await signup({ ...form, businessName: form.businessName.trim(), email });
    if (res.status !== 'ok') {
      setLoading(false);
      setError(
        res.status === 'offline'
          ? 'Sin conexión. Para crear la cuenta necesitás internet.'
          : res.message,
      );
      return;
    }

    // La cuenta ya existe: de acá en adelante el camino es iniciar sesión, no volver a crearla.
    setCreated(true);
    const login = await authService.login(email, form.password);
    setLoading(false);
    if ('error' in login) {
      setError(`Tu cuenta se creó, pero no pudimos iniciar sesión: ${login.error}`);
      return;
    }
    // No se salta directo: confirmar el alta antes de encajarle una pantalla de seguridad
    // que no pidió. El paso siguiente (casi siempre MFA) queda esperando el toque.
    setDone(login.step);
  }

  if (done) {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Tu cuenta ya está lista" />
        <Card>
          <View style={{ alignItems: 'center', gap: SPACING.sm }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: COLORS.successBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 30, color: COLORS.success }}>✓</Text>
            </View>
            <Text style={styles.title}>¡Cuenta creada!</Text>
          </View>
          <Text style={styles.subtitle}>
            Ya podés entrar y cargar tu cartera. Antes te ofrecemos proteger la cuenta con un
            segundo paso de seguridad — si preferís, lo dejás para después.
          </Text>
          <View style={{ backgroundColor: COLORS.bg, borderRadius: 10, padding: SPACING.lg }}>
            <Text style={{ ...TYPE.secondary }}>
              Tu correo: <Text style={{ fontWeight: '600' }}>{form.email.trim().toLowerCase()}</Text>
            </Text>
            <Text style={{ ...TYPE.secondary, marginTop: 2 }}>
              Negocio: <Text style={{ fontWeight: '600' }}>{form.businessName.trim()}</Text>
            </Text>
          </View>
          <Button label="Continuar" onPress={() => goToStep(done)} />
        </Card>
        <SecurityFooter />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Empezá a cobrar con Kobrax" />
        <Card>
          <Text style={styles.title}>Crear una cuenta</Text>
          <Text style={styles.subtitle}>
            Con esto ya podés cargar tu cartera. El país y la moneda los configurás después.
          </Text>
          <ErrorBanner message={error} />

          <Field
            label="Nombre del negocio"
            value={form.businessName}
            onChangeText={set('businessName')}
            placeholder="Cobranzas Pérez"
            error={!!error}
          />
          <Field
            label="Nombre"
            value={form.firstName}
            onChangeText={set('firstName')}
            placeholder="Sara"
          />
          <Field
            label="Apellido"
            value={form.lastName}
            onChangeText={set('lastName')}
            placeholder="Pérez"
          />
          <Field
            label="Correo electrónico"
            value={form.email}
            onChangeText={set('email')}
            placeholder="tu@empresa.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Field
            label="Contraseña"
            value={form.password}
            onChangeText={set('password')}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
          />
          <PasswordChecklist password={form.password} />

          {created ? (
            <Button label="Ir a iniciar sesión" onPress={() => router.replace('/(auth)/login')} />
          ) : (
            <Button label="Crear cuenta" onPress={submit} loading={loading} />
          )}
          <TextLink label="Ya tengo cuenta" onPress={() => router.replace('/(auth)/login')} />
        </Card>
        <SecurityFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
