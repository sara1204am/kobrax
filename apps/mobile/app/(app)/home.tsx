import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, TYPE } from '@/theme';
import { authService, type Me } from '@/auth-service';
import { clearBiometric } from '@/biometric';

export default function HomeScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await authService.me();
      if (res.status === 'offline') {
        router.replace('/(app)/offline');
        return;
      }
      if (res.status !== 'ok') {
        router.replace('/(auth)/login');
        return;
      }
      setMe(res.me);
      setLoading(false);
    })();
  }, []);

  async function logout() {
    await authService.logout();
    await clearBiometric(); // logout limpia SecureStore completo (incl. flags biométricos)
    router.replace('/(auth)/login');
  }

  if (loading || !me) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.navy} />
      </View>
    );
  }

  const name = me.profile ? `${me.profile.firstName} ${me.profile.lastName}` : me.email;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: COLORS.navy,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.white, letterSpacing: 1 }}>KOBRAX</Text>
        <Pressable onPress={logout}>
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '500' }}>Cerrar sesión</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.xl, gap: SPACING.lg }}>
        <View>
          <Text style={TYPE.h1}>Hola, {name}</Text>
          <Text style={{ ...TYPE.secondary, marginTop: 4 }}>
            Sesión iniciada como <Text style={{ fontWeight: '600', color: COLORS.text }}>{me.role}</Text>.
          </Text>
        </View>

        <View
          style={{
            backgroundColor: COLORS.white,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: SPACING.lg,
            gap: SPACING.sm,
          }}
        >
          <Text style={{ ...TYPE.caption, textTransform: 'uppercase', fontWeight: '600' }}>Empresa activa</Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 13, color: COLORS.text }}>{me.accountId}</Text>
          <Text style={{ ...TYPE.caption, textTransform: 'uppercase', fontWeight: '600', marginTop: 8 }}>
            Permisos ({me.permissions.length})
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {me.permissions.map((p) => (
              <Text
                key={p}
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: COLORS.purple,
                  backgroundColor: COLORS.highlight,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                {p}
              </Text>
            ))}
          </View>
        </View>

        <Text style={{ ...TYPE.caption }}>
          App base (F2a Slice 6). La ruta del día, casos, pagos y evidencia offline llegan en F3+.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
