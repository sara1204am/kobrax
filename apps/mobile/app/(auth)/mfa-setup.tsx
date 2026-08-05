import { useEffect, useMemo, useState } from 'react';
// eslint-disable-next-line no-restricted-imports -- ver nota de `Clipboard` en `copy()`
import { Clipboard, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, ErrorBanner, Hero, SecurityFooter, TextLink, styles } from '@/components';
import { OtpInput } from '@/otp-input';
import { BottomSheet } from '@/ui';
import { qrMatrix } from '@/qr';
import { COLORS, SPACING, TYPE } from '@/theme';
import { authService, type Step } from '@/auth-service';
import { goToStep } from '@/route-step';

/** Lado del QR en pantalla. Suficiente para que otro teléfono lo lea de cerca. */
const QR_SIZE = 220;
/** Margen obligatorio del estándar (4 módulos): sin él muchos escáneres no enganchan. */
const QUIET_ZONE = 4;

/**
 * QR dibujado con `View`s. Negro sobre blanco puros y no los tokens de marca: acá el
 * contraste no es estética, es lo que hace que la cámara lo lea.
 */
function QrCode({ url }: { url: string }) {
  const m = useMemo(() => qrMatrix(url), [url]);
  const cell = QR_SIZE / (m.size + QUIET_ZONE * 2);
  const offset = QUIET_ZONE * cell;
  return (
    <View
      style={{ width: QR_SIZE, height: QR_SIZE, backgroundColor: '#FFFFFF', borderRadius: 8 }}
      accessibilityRole="image"
      accessibilityLabel="Código QR para tu app de autenticación"
    >
      {m.rows.map((runs, y) =>
        runs.map((run) => (
          <View
            key={`${y}-${run.x}`}
            style={{
              position: 'absolute',
              left: offset + run.x * cell,
              top: offset + y * cell,
              width: run.width * cell,
              height: cell,
              backgroundColor: '#000000',
            }}
          />
        )),
      )}
    </View>
  );
}

/** Un punto de la guía: número + texto. */
function Paso({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: SPACING.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: COLORS.navy,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: COLORS.white, fontSize: 13, fontWeight: '700' }}>{n}</Text>
      </View>
      <Text style={{ ...TYPE.body, flex: 1 }}>{children}</Text>
    </View>
  );
}

/**
 * Ayuda para alguien que nunca usó un segundo factor. Es la mitad del trabajo de esta
 * pantalla: sin esto, "escaneá el QR con tu app de autenticación" no quiere decir nada
 * para un cobrador que nunca instaló una.
 */
function AyudaMfa({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="¿Qué es esto y para qué sirve?">
      <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: SPACING.lg, paddingBottom: SPACING.lg }}>
        <Text style={TYPE.body}>
          Es una segunda llave para entrar a tu cuenta: además de tu contraseña, te va a pedir un
          número de 6 dígitos que cambia cada 30 segundos.
        </Text>

        <View style={{ backgroundColor: COLORS.highlight, borderRadius: 10, padding: SPACING.lg }}>
          <Text style={{ ...TYPE.body, fontWeight: '600' }}>Por qué importa acá</Text>
          <Text style={{ ...TYPE.secondary, marginTop: 4 }}>
            En Kobrax se mueve plata y datos de tus clientes. Si alguien te adivina o te roba la
            contraseña, sin ese número igual no entra: el número está solo en tu teléfono.
          </Text>
        </View>

        <Text style={{ ...TYPE.body, fontWeight: '600' }}>Cómo se hace, paso a paso</Text>
        <Paso n={1}>
          Instalá en tu teléfono una app de autenticación. Cualquiera de estas sirve y son
          gratuitas: <Text style={{ fontWeight: '600' }}>Authy</Text>,{' '}
          <Text style={{ fontWeight: '600' }}>Google Authenticator</Text> o{' '}
          <Text style={{ fontWeight: '600' }}>Microsoft Authenticator</Text>. Buscalas por nombre en
          la Play Store.
        </Paso>
        <Paso n={2}>
          Abrila y tocá el botón de agregar cuenta (suele ser un <Text style={{ fontWeight: '600' }}>+</Text>).
          Elegí la opción de escanear un código.
        </Paso>
        <Paso n={3}>
          Apuntá la cámara al código QR de esta pantalla. Si no podés escanear, tocá la clave de
          letras que está debajo del código: se copia sola y la pegás en la app.
        </Paso>
        <Paso n={4}>
          La app te va a mostrar 6 números. Escribilos acá abajo y listo.
        </Paso>

        <View style={{ backgroundColor: COLORS.bg, borderRadius: 10, padding: SPACING.lg, gap: 6 }}>
          <Text style={{ ...TYPE.secondary, fontWeight: '600' }}>Dos cosas que conviene saber</Text>
          <Text style={TYPE.secondary}>
            · No hace falta internet para que la app genere los números: funcionan en el campo, sin
            señal.
          </Text>
          <Text style={TYPE.secondary}>
            · Cuando termines te vamos a dar unos códigos de respaldo. Guardalos: son la forma de
            entrar si perdés o cambiás de teléfono.
          </Text>
        </View>

        <Button label="Entendido" onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * Activación del segundo factor. Dos modos, misma pantalla:
 *
 * - **Durante el login** (por defecto): el rol lo exige y todavía no hay sesión, así que va
 *   con el pre-auth token. Acá aparece "Lo hago después", que completa el login sin activarlo
 *   (decisión de producto 31/07: postergable indefinidamente; el Home lo recuerda).
 * - **`?authed=1`**, desde el aviso del Home: ya hay sesión → usa los endpoints self-service.
 *   Sin botón de postergar, porque acá el usuario vino a propósito.
 */
export default function MfaSetupScreen() {
  const { authed } = useLocalSearchParams<{ authed?: string }>();
  const conSesion = authed === '1';

  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pendingStep, setPendingStep] = useState<Step | null>(null);

  useEffect(() => {
    void (async () => {
      const res = conSesion ? await authService.mfaEnroll() : await authService.mfaSetupStart();
      if ('error' in res) setError(res.error);
      else {
        setSecret(res.secret);
        setOtpauthUrl(res.otpauthUrl);
      }
    })();
  }, [conSesion]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  function copy() {
    // `Clipboard` del core está deprecado (avisa por consola) pero funciona en RN 0.74.
    // ponytail: la alternativa es `expo-clipboard`, que es módulo nativo → prebuild +
    // rebuild del dev build y el módulo deja de correr en Expo Go, por un botón de copiar.
    // Techo: cuando RN lo saque, o cuando haya que rebuildear por otra cosa, se cambia.
    Clipboard.setString(secret);
    setCopied(true);
  }

  async function verify() {
    setError(null);
    setLoading(true);
    // Ramas separadas y no un ternario: con sesión no hay `step` que resolver — el login
    // ya pasó y de acá se vuelve a las tabs.
    if (conSesion) {
      const res = await authService.mfaVerify(code);
      setLoading(false);
      if ('error' in res) {
        setError(res.error);
        setCode('');
        return;
      }
      setBackupCodes(res.backupCodes);
      setPendingStep('done');
      return;
    }
    const res = await authService.mfaSetupVerify(code);
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      setCode('');
      return;
    }
    setBackupCodes(res.backupCodes);
    setPendingStep(res.step);
  }

  async function despues() {
    setError(null);
    setLoading(true);
    const res = await authService.mfaSetupSkip();
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    goToStep(res.step);
  }

  if (backupCodes && pendingStep) {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero subtitle="Verificación en dos pasos" />
        <Card>
          <Text style={styles.title}>Guarda tus códigos</Text>
          <Text style={styles.subtitle}>Úsalos si pierdes tu authenticator. Cada uno sirve una sola vez.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {backupCodes.map((c) => (
              <Text
                key={c}
                selectable
                style={{
                  width: '47%',
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  fontSize: 14,
                  color: COLORS.text,
                  backgroundColor: COLORS.bg,
                  borderRadius: 8,
                  paddingVertical: 6,
                }}
              >
                {c}
              </Text>
            ))}
          </View>
          <Button
            label="Ya los guardé, continuar"
            onPress={() => (conSesion ? router.replace('/(tabs)') : goToStep(pendingStep))}
          />
        </Card>
        <SecurityFooter />
      </ScrollView>
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <Hero subtitle="Configura la verificación en dos pasos" />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.title}>Activa MFA</Text>
          <Pressable
            onPress={() => setAyuda(true)}
            accessibilityRole="button"
            accessibilityLabel="Qué es esto y cómo se hace"
            hitSlop={12}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: COLORS.highlight,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: COLORS.purple, fontWeight: '700', fontSize: 13 }}>? Ayuda</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>
          Escaneá el código con tu app de autenticación, o copiá la clave y pegala a mano. Si nunca
          hiciste esto, tocá <Text style={{ fontWeight: '600' }}>Ayuda</Text>.
        </Text>

        {otpauthUrl ? (
          <View style={{ alignItems: 'center' }}>
            <QrCode url={otpauthUrl} />
          </View>
        ) : null}

        <Pressable
          onPress={copy}
          disabled={!secret}
          accessibilityRole="button"
          accessibilityLabel="Copiar la clave de configuración"
          style={({ pressed }) => ({
            backgroundColor: COLORS.bg,
            borderRadius: 10,
            padding: 12,
            alignItems: 'center',
            gap: 4,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: '600', color: COLORS.navy }}
            selectable
          >
            {secret || '···'}
          </Text>
          <Text style={{ fontSize: 12, color: copied ? COLORS.success : COLORS.text2 }}>
            {copied ? '✓ Clave copiada' : 'Tocá para copiar'}
          </Text>
        </Pressable>

        <ErrorBanner message={error} />
        <OtpInput value={code} onChange={setCode} error={!!error} />
        <Button label="Activar y continuar" onPress={verify} loading={loading} disabled={code.length !== 6 || !secret} />

        {conSesion ? (
          <TextLink label="Volver" onPress={() => router.back()} />
        ) : (
          <TextLink label="Lo hago después" onPress={despues} />
        )}
      </Card>
      <SecurityFooter />
      <AyudaMfa visible={ayuda} onClose={() => setAyuda(false)} />
    </ScrollView>
  );
}
