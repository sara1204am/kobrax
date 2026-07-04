import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, ErrorBanner, Hero, SecurityFooter, styles } from '@/components';
import { OtpInput } from '@/otp-input';
import { COLORS } from '@/theme';
import { authService, type Step } from '@/auth-service';
import { goToStep } from '@/route-step';

export default function MfaSetupScreen() {
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pendingStep, setPendingStep] = useState<Step | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await authService.mfaSetupStart();
      if ('error' in res) setError(res.error);
      else setSecret(res.secret);
    })();
  }, []);

  async function verify() {
    setError(null);
    setLoading(true);
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
          <Button label="Ya los guardé, continuar" onPress={() => goToStep(pendingStep)} />
        </Card>
        <SecurityFooter />
      </ScrollView>
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <Hero subtitle="Configura la verificación en dos pasos" />
      <Card>
        <Text style={styles.title}>Activa MFA</Text>
        <Text style={styles.subtitle}>Tu rol lo requiere. Ingresa esta clave en tu app de autenticación:</Text>
        <View style={{ backgroundColor: COLORS.bg, borderRadius: 10, padding: 12, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: '600', color: COLORS.navy }}>
            {secret || '···'}
          </Text>
        </View>
        <ErrorBanner message={error} />
        <OtpInput value={code} onChange={setCode} error={!!error} />
        <Button label="Activar y continuar" onPress={verify} loading={loading} disabled={code.length !== 6 || !secret} />
      </Card>
      <SecurityFooter />
    </ScrollView>
  );
}
