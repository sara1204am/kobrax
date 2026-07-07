import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { COLORS, SPACING, TYPE } from '@/theme';
import { Header, ListRow, StatusBadge } from '@/ui';
import { authService, type Me } from '@/auth-service';

/** Inicio (Home / Jornada). Slice 0: saluda + placeholder de jornada; KPIs y ruta activa en Slice 3. */
export default function InicioScreen() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await authService.me();
      // ponytail: aún no hay datos offline (WatermelonDB = P6) → offline = pantalla dedicada.
      // Cuando P6 hidrate datos locales, el cobrador debe QUEDARSE en el shell y operar offline.
      if (res.status === 'offline') return router.replace('/(app)/offline');
      if (res.status !== 'ok') return router.replace('/(auth)/login');
      setMe(res.me);
    })();
  }, []);

  if (!me) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.navy} />
      </View>
    );
  }

  const name = me.profile ? me.profile.firstName : me.email;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Inicio" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.lg }}>
        <View>
          <Text style={TYPE.h1}>Hola, {name}</Text>
          <Text style={{ ...TYPE.secondary, marginTop: 4 }}>Tu jornada de hoy</Text>
        </View>

        <ListRow
          title="Ruta del día"
          subtitle="Sin ruta activa"
          right={<StatusBadge label="Pendiente" tone="warning" />}
        />
        <ListRow title="Gestiones" subtitle="0 de 0 completadas" right={<StatusBadge label="0" tone="neutral" />} />

        <Text style={{ ...TYPE.caption }}>
          Shell de campo (F10 Slice 0). Agenda, rutas, cobranza y evidencia llegan por slices.
        </Text>
      </ScrollView>
    </View>
  );
}
