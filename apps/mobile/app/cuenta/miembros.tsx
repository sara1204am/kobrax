import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ROLE_LABEL, type RoleType } from '@kobrax/shared';
import { COLORS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, OfflineIndicator, SectionLabel, StatusBadge } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { authService } from '@/auth-service';
import { getAccount, type AccountInfo } from '@/account.service';
import { listMembers, memberName, type Member } from '@/users.service';

/**
 * Equipo de la cuenta (CUENTA S2). Para el cobrador independiente es una lista de uno, y
 * está bien: no se le esconde la pantalla (README D6).
 *
 * El estado se pinta sólo cuando **no** es el normal: un miembro activo muestra su rol y
 * nada más; el badge queda para "Pendiente" e "Inactivo", que son los que piden acción.
 */
export default function MiembrosScreen() {
  const [members, setMembers] = useState<Member[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [puedeInvitar, setPuedeInvitar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, acc, me] = await Promise.all([listMembers(), getAccount(), authService.me()]);
    if (res.status === 'ok') {
      setMembers(res.data);
      setError(null);
    } else if (res.status === 'offline') {
      setError('Sin conexión. El equipo se administra en línea.');
    } else if (res.status === 'error') setError(res.message);
    if (acc.status === 'ok') setAccount(acc.data);
    if (me.status === 'ok') setPuedeInvitar(me.me.permissions.includes('user:invite'));
    setLoading(false);
  }, []);

  // Al volver de invitar o del detalle hay que releer: cambió la lista.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const ocupados = account?.memberCount ?? members.filter((m) => m.isActive).length;
  const tope = account?.maxUsers ?? 5;
  const lleno = ocupados >= tope;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Miembros" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />

        <SectionLabel>{`Tu equipo · ${ocupados} de ${tope}`}</SectionLabel>

        {members.map((m) => (
          <ListRow
            key={m.userId}
            title={memberName(m)}
            subtitle={[ROLE_LABEL[m.roleName as RoleType] ?? m.roleName, m.isOwner ? 'Dueño' : null]
              .filter(Boolean)
              .join(' · ')}
            icon="person-outline"
            right={estado(m)}
            onPress={() => router.push(`/cuenta/miembro/${m.userId}`)}
          />
        ))}

        {!loading && members.length === 0 && (
          <EmptyState icon="👥" title="Todavía no hay nadie" hint="Invitá a tu equipo por correo." />
        )}

        {lleno && (
          <Text style={{ ...TYPE.caption }}>
            Llegaste al tope de tu plan. Para sumar a alguien, desactivá o eliminá a otro miembro.
          </Text>
        )}
      </ScrollView>

      {puedeInvitar && (
        <View style={styles.footer}>
          <Button
            label={lleno ? `Tu plan permite ${tope}` : 'Invitar a alguien'}
            onPress={() => router.push('/cuenta/invitar')}
            disabled={lleno}
          />
        </View>
      )}
    </View>
  );
}

function estado(m: Member) {
  if (m.userStatus === 'PENDING') return <StatusBadge label="Pendiente" tone="warning" />;
  if (!m.isActive) return <StatusBadge label="Inactivo" tone="neutral" />;
  return undefined;
}

const styles = {
  footer: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
};
