import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { EMPTY_CHOICE, canSubmitLegal, isPasswordValid, legalPayload, type LegalChoice } from '@kobrax/shared';
import { LegalConsents, useSignupDocuments } from '@/legal-consents';
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
import { acceptInvitation, getInvitation, type Invitation } from '@/users.service';
import { authService } from '@/auth-service';
import { goToStep } from '@/route-step';
import { COLORS, SPACING, TYPE } from '@/theme';

/**
 * Aceptar una invitación (CUENTA S3). Dos formas de llegar, un solo código (S2-D3):
 *
 * - el link del correo — `kobrax://invitacion?c=…` — que expo-router mapea acá por el
 *   nombre del archivo, sin configuración de linking;
 * - a mano, desde "Tengo una invitación" en el login. Es el camino que **siempre** funciona:
 *   con Expo Go el esquema es `exp://` y desde Gmail un `kobrax://` puede no abrir nada.
 *
 * Aceptar no devuelve tokens (S2-D8): se hace el login normal con la contraseña recién
 * elegida y `goToStep` decide el destino, igual que el registro (S4-D1).
 */
export default function InvitacionScreen() {
  const { c } = useLocalSearchParams<{ c?: string }>();
  const [code, setCode] = useState(c ?? '');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Privacidad: quien se une por invitación también acepta los Términos y reconoce la Política antes de entrar.
  const legalDocs = useSignupDocuments();
  const [choice, setChoice] = useState<LegalChoice>(EMPTY_CHOICE);
  const [stale, setStale] = useState(false);

  const buscar = useCallback(async (raw: string) => {
    setError(null);
    setLoading(true);
    const res = await getInvitation(raw.trim());
    setLoading(false);
    if (res.status === 'ok') {
      setInvitation(res.data);
      return;
    }
    setError(
      res.status === 'offline'
        ? 'Sin conexión. Para aceptar la invitación necesitás internet.'
        : res.message,
    );
  }, []);

  // Si vino por el link, no se le pide que escriba lo que ya trajo.
  useEffect(() => {
    if (c) void buscar(c);
  }, [c, buscar]);

  async function aceptar() {
    setError(null);
    setLoading(true);
    const res = await acceptInvitation(code.trim(), password, legalPayload(legalDocs.docs, choice));
    if (res.status !== 'ok') {
      setLoading(false);
      if (res.status === 'error' && res.code === 'LEGAL_VERSION_STALE') {
        // Cambió una versión mientras llenaba el formulario: no se consumió la invitación; se recarga y se vuelven a pedir las casillas.
        setChoice(EMPTY_CHOICE);
        setStale(true);
        void legalDocs.reload();
        return;
      }
      setError(
        res.status === 'offline' ? 'Sin conexión: no se pudo completar.' : res.message,
      );
      return;
    }
    const login = await authService.login(res.data.email, password);
    setLoading(false);
    if ('error' in login) {
      // La cuenta ya quedó activa: reintentar el código daría "inválida" (es de un solo uso).
      setError(`Tu cuenta quedó lista, pero no pudimos iniciar sesión: ${login.error}`);
      return;
    }
    goToStep(login.step);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Te invitaron a Kobrax" />
        <Card>
          {invitation ? (
            <>
              <Text style={styles.title}>Hola{invitation.firstName ? `, ${invitation.firstName}` : ''}</Text>
              <Text style={styles.subtitle}>
                {invitation.businessName
                  ? `Te sumaron al equipo de ${invitation.businessName}.`
                  : 'Te sumaron a un equipo.'}{' '}
                Elegí una contraseña y entrás.
              </Text>
              <View style={{ backgroundColor: COLORS.bg, borderRadius: 10, padding: SPACING.lg }}>
                <Text style={{ ...TYPE.secondary }}>
                  Tu correo: <Text style={{ fontWeight: '600' }}>{invitation.email}</Text>
                </Text>
              </View>

              <ErrorBanner message={error} />
              <Field
                label="Contraseña"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                importantForAutofill="yes"
              />
              <PasswordChecklist password={password} />
              <LegalConsents
                docs={legalDocs.docs}
                state={legalDocs.state}
                onReload={() => void legalDocs.reload()}
                choice={choice}
                onChange={(next) => {
                  setStale(false);
                  setChoice(next);
                }}
                disabled={loading}
                stale={stale}
              />
              <Button
                label="Entrar"
                onPress={() => void aceptar()}
                loading={loading}
                disabled={!isPasswordValid(password) || !canSubmitLegal(legalDocs.docs, choice)}
              />
            </>
          ) : (
            <>
              <Text style={styles.title}>Tengo una invitación</Text>
              <Text style={styles.subtitle}>
                Escribí el código que te mandaron por correo o por WhatsApp. Los guiones y las
                mayúsculas no importan.
              </Text>
              <ErrorBanner message={error} />
              <Field
                label="Código"
                value={code}
                onChangeText={setCode}
                placeholder="K7F29-QX3TM"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Button
                label="Continuar"
                onPress={() => void buscar(code)}
                loading={loading}
                disabled={code.trim().length < 8}
              />
            </>
          )}
          <TextLink label="Volver a iniciar sesión" onPress={() => router.replace('/(auth)/login')} />
        </Card>
        <SecurityFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
