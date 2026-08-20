import { useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { PLANS, SIGNUP_PLANS, TRIAL_DAYS, type PlanLimit, type SignupPlan } from '@kobrax/shared';
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
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';

/** Los nombres comerciales. `FREE` se llama `STARTER` en la base, y eso no se le muestra a nadie. */
const NOMBRE: Record<SignupPlan, string> = {
  FREE: 'Free',
  PROFESSIONAL: 'Professional',
  BUSINESS: 'Business',
};

const PRECIO: Record<SignupPlan, string> = {
  FREE: 'Gratis',
  PROFESSIONAL: `$${PLANS.PROFESSIONAL.price.perSeat} por miembro al mes`,
  BUSINESS: `$${PLANS.BUSINESS.price.base} + $${PLANS.BUSINESS.price.perSeat} por miembro al mes`,
};

const num = (n: PlanLimit) => (n === null ? 'Sin límite' : n.toLocaleString('es-BO'));

/**
 * Elegir plan (L0.5). Apiladas y no en grilla: en un teléfono, tres columnas de números chicos
 * bajo el sol no se leen.
 *
 * ENTERPRISE no está: se cotiza, y este formulario sale a un endpoint público.
 */
function PlanPicker({ onPick }: { onPick: (plan: SignupPlan) => void }) {
  return (
    <View style={{ gap: SPACING.md }}>
      {SIGNUP_PLANS.map((code) => {
        const plan = PLANS[code];
        const gratis = code === 'FREE';
        return (
          <Pressable
            key={code}
            onPress={() => onPick(code)}
            accessibilityRole="button"
            accessibilityLabel={`Empezar con ${NOMBRE[code]}`}
            style={({ pressed }) => ({
              borderWidth: 1.5,
              borderColor: pressed ? COLORS.periwinkle : COLORS.border,
              borderRadius: RADIUS.card,
              padding: SPACING.lg,
              gap: SPACING.sm,
              backgroundColor: COLORS.white,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={TYPE.h3}>{NOMBRE[code]}</Text>
              <Text
                style={{
                  ...TYPE.caption,
                  color: gratis ? COLORS.text2 : COLORS.purple,
                  backgroundColor: gratis ? COLORS.lightBg : COLORS.highlight,
                  borderRadius: RADIUS.pill,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  overflow: 'hidden',
                }}
              >
                {gratis ? 'Gratis para siempre' : `${TRIAL_DAYS} días de prueba`}
              </Text>
            </View>
            <Text style={TYPE.secondary}>{PRECIO[code]}</Text>
            <Text style={{ ...TYPE.secondary, color: COLORS.text }}>
              {num(plan.limits.users)} {plan.limits.users === 1 ? 'miembro' : 'miembros'} ·{' '}
              {num(plan.limits.credits)} créditos · {num(plan.limits.photosPerMonth)} fotos al mes
            </Text>
          </Pressable>
        );
      })}
      {/* Sin precio: Enterprise se cotiza, y un «desde $800» acá ancla un número que casi nunca
          va a ser el del contrato. */}
      <Text style={TYPE.caption}>
        ¿Más grande que esto? Enterprise se arma a medida: los números salen de tu operación.
        Escribinos y lo vemos con vos.
      </Text>
    </View>
  );
}

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
  /** `null` = todavía está eligiendo plan. Es lo primero que se pregunta (L0.5). */
  const [plan, setPlan] = useState<SignupPlan | null>(null);
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
    const res = await signup({
      ...form,
      businessName: form.businessName.trim(),
      email,
      // El servidor lo revalida contra su lista blanca: acá es una preferencia, no una decisión.
      planCode: plan ?? 'FREE',
    });
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

  // Paso 1. Sin plan elegido no hay formulario: es la decisión que ordena todo lo demás.
  if (!plan) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Empezá a cobrar con Kobrax" />
        <Card>
          <Text style={styles.title}>¿Cómo vas a usar Kobrax?</Text>
          <Text style={styles.subtitle}>
            Elegí el plan que te queda. Podés empezar gratis y crecer cuando lo necesites.
          </Text>
          <PlanPicker onPick={setPlan} />
          <TextLink label="Ya tengo cuenta" onPress={() => router.replace('/(auth)/login')} />
        </Card>
        <SecurityFooter />
      </ScrollView>
    );
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
            <Text style={{ ...TYPE.secondary, marginTop: 2 }}>
              Plan: <Text style={{ fontWeight: '600' }}>{NOMBRE[plan]}</Text>
            </Text>
          </View>

          {/* Lo que pasa a los 30 días se dice acá y no en la letra chica: enterarse el día que
              vence, con la cartera adentro, es la peor forma de descubrir un vencimiento. */}
          {plan !== 'FREE' && (
            <Text
              style={{
                ...TYPE.secondary,
                backgroundColor: COLORS.highlight,
                borderRadius: RADIUS.input,
                padding: SPACING.md,
              }}
            >
              Estás probando {NOMBRE[plan]} por {TRIAL_DAYS} días. Al terminar, tu cuenta sigue
              funcionando en el plan Free: no se bloquea nada y no perdés tus datos.
            </Text>
          )}
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

          {/* El plan elegido queda a la vista y se puede cambiar sin perder lo escrito. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: COLORS.highlight,
              borderRadius: RADIUS.input,
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.sm,
            }}
          >
            <Text style={TYPE.secondary}>Plan {NOMBRE[plan]}</Text>
            <Text style={TYPE.link} onPress={() => setPlan(null)} accessibilityRole="link">
              Cambiar
            </Text>
          </View>

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
