import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Card, ErrorBanner, Hero, SecurityFooter, styles } from '@/components';
import { COLORS, RADIUS } from '@/theme';
import { authService, getFlowAccounts } from '@/auth-service';
import { goToStep } from '@/route-step';

export default function SelectAccountScreen() {
  const accounts = getFlowAccounts();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(accountId: string) {
    setError(null);
    setBusy(accountId);
    const res = await authService.selectAccount(accountId);
    if ('error' in res) {
      setBusy(null);
      setError(res.error);
      return;
    }
    goToStep(res.step);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Hero subtitle="Selecciona tu empresa" />
      <Card>
        <Text style={styles.title}>Elige tu empresa</Text>
        <Text style={styles.subtitle}>Tienes acceso a varias empresas.</Text>
        <ErrorBanner message={error} />
        {accounts.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => choose(a.id)}
            disabled={!!busy}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: COLORS.border,
              borderRadius: RADIUS.input,
              padding: 14,
              opacity: busy && busy !== a.id ? 0.5 : 1,
            }}
          >
            <View>
              <Text style={{ fontSize: 15, fontWeight: '500', color: COLORS.text }}>{a.name}</Text>
              <Text style={{ fontSize: 12, color: COLORS.text2 }}>{a.role}</Text>
            </View>
            <Text style={{ color: COLORS.muted, fontSize: 18 }}>{busy === a.id ? '···' : '›'}</Text>
          </Pressable>
        ))}
      </Card>
      <SecurityFooter />
    </ScrollView>
  );
}
