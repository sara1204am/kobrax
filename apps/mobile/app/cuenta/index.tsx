import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ROLE_LABEL, type RoleType } from '@kobrax/shared';
import { COLORS, SPACING } from '@/theme';
import { Header, ListRow, OfflineIndicator, SectionLabel } from '@/ui';
import { ErrorBanner } from '@/components';
import { authService, type Me } from '@/auth-service';
import { getAccount, type AccountInfo } from '@/account.service';

/**
 * Hub de "Mi cuenta" (CUENTA S1). Entrada: la fila "Perfil y seguridad" de `Más`.
 *
 * Es la puerta del autoservicio: el independiente y el equipo de 2–5 configuran acá sin
 * pasar por la web. Lo avanzado (sucursales, jerarquías, roles de la web, reportes) no
 * vive en el móvil por diseño.
 */
export default function CuentaScreen() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [acc, meRes] = await Promise.all([getAccount(), authService.me()]);
    if (acc.status === 'ok') {
      setAccount(acc.data);
      setError(null);
    } else if (acc.status === 'offline') setError('Sin conexión. Los datos de la cuenta se leen en línea.');
    else if (acc.status === 'error') setError(acc.message);
    if (meRes.status === 'ok') setMe(meRes.me);
  }, []);

  // Al volver de datos/perfil hay que releer: pudieron cambiar.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const nombre = me?.profile ? `${me.profile.firstName} ${me.profile.lastName}`.trim() : me?.email;
  const rol = me ? (ROLE_LABEL[me.role as RoleType] ?? me.role) : undefined;
  // Sin `account:write` la cuenta se ve pero no se toca (S1-D4). El gating es por
  // capacidad, nunca por tipo de cuenta ni por plan.
  const puedeEditar = !!me?.permissions.includes('account:write');

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Mi cuenta" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />

        <SectionLabel>Yo</SectionLabel>
        <ListRow
          title="Mi perfil"
          subtitle={[nombre, rol].filter(Boolean).join(' · ') || 'Nombre, teléfono y foto'}
          icon="person-circle-outline"
          onPress={() => router.push('/cuenta/perfil')}
        />

        <SectionLabel>Mi negocio</SectionLabel>
        <ListRow
          title="Datos de la cuenta"
          subtitle={account ? `${account.businessName} · ${account.currencyCode}` : 'Nombre, país y moneda'}
          icon="business-outline"
          onPress={() => router.push('/cuenta/datos')}
        />
        <ListRow
          title="Miembros"
          subtitle={
            account
              ? `${account.memberCount} de ${account.maxUsers}`
              : 'Invitar y administrar tu equipo'
          }
          icon="people-outline"
          onPress={() => router.push('/cuenta/miembros')}
        />

        {!puedeEditar && (
          <SectionLabel>Tu rol no permite editar los datos del negocio</SectionLabel>
        )}
      </ScrollView>
    </View>
  );
}
