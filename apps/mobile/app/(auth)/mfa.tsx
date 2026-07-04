import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, ErrorBanner, Field, Hero, SecurityFooter, styles } from '@/components';
import { OtpInput } from '@/otp-input';
import { authService } from '@/auth-service';
import { goToStep } from '@/route-step';

export default function MfaScreen() {
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    setError(null);
    setLoading(true);
    const res = await authService.mfaChallenge(value);
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      setCode('');
      return;
    }
    goToStep(res.step);
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <Hero subtitle="Verificación en dos pasos" />
      <Card>
        <Text style={styles.title}>Ingresa tu código</Text>
        <Text style={styles.subtitle}>Abre tu app de autenticación y escribe el código.</Text>
        <ErrorBanner message={error} />
        {!useBackup ? (
          <>
            <OtpInput value={code} onChange={setCode} error={!!error} />
            <Button label="Verificar" onPress={() => submit(code)} loading={loading} disabled={code.length !== 6} />
            <Text style={[styles.footer, { color: '#7B68D6' }]} onPress={() => setUseBackup(true)}>
              Usar un código de respaldo
            </Text>
          </>
        ) : (
          <View style={{ gap: 16 }}>
            <Field
              label="Código de respaldo"
              value={backup}
              onChangeText={setBackup}
              placeholder="xxxxx-xxxxx"
              autoCapitalize="none"
              error={!!error}
            />
            <Button label="Verificar" onPress={() => submit(backup)} loading={loading} disabled={backup.length < 6} />
            <Text style={[styles.footer, { color: '#7B68D6' }]} onPress={() => setUseBackup(false)}>
              Volver al código del authenticator
            </Text>
          </View>
        )}
      </Card>
      <SecurityFooter />
    </ScrollView>
  );
}
