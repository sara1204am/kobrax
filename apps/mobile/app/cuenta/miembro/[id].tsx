import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ROLE_LABEL, isMobileRole, type RoleType } from '@kobrax/shared';
import { COLORS, SPACING, TYPE } from '@/theme';
import { Header, OfflineIndicator, PickerSheet, SectionLabel, SelectRow, StatusBadge } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { roleOptions } from '@/account-form';
import { CodigoInvitacion } from '@/codigo-invitacion';
import { authService } from '@/auth-service';
import {
  listMembers,
  listRoles,
  memberName,
  removeMember,
  resendInvitation,
  updateMember,
  type Member,
  type Role,
} from '@/users.service';

/**
 * Detalle de un miembro (CUENTA S2): rol, estado y las acciones de su invitación.
 *
 * No hay `GET /users/:id`: la lista trae todo lo que esta pantalla necesita y son ≤ 5 filas
 * por el techo del plan. Un endpoint nuevo para releer una fila que ya tenemos sería trabajo
 * del servidor para ahorrarse un `find`.
 *
 * Las guardas duras (no editarse a uno mismo, no dejar la cuenta sin administrador) viven en
 * el servidor: acá sólo se esconden los botones que no corresponden.
 */
export default function MiembroScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [member, setMember] = useState<Member | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [yo, setYo] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [lista, cat, me] = await Promise.all([listMembers(), listRoles(), authService.me()]);
    if (lista.status === 'ok') {
      setMember(lista.data.find((m) => m.userId === id) ?? null);
      setError(null);
    } else if (lista.status === 'offline') setError('Sin conexión. El equipo se administra en línea.');
    else if (lista.status === 'error') setError(lista.message);
    if (cat.status === 'ok') setRoles(cat.data);
    if (me.status === 'ok') {
      setYo(me.me.userId);
      setPuedeEditar(me.me.permissions.includes('user:write'));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!member) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Miembro" onBack={() => router.back()} />
        <View style={{ padding: SPACING.lg }}>
          <ErrorBanner message={error} />
        </View>
      </View>
    );
  }

  const pendiente = member.userStatus === 'PENDING';
  const soyYo = member.userId === yo;
  // Un rol de la web (MANAGER, AUDITOR, VIEWER) se muestra y no se toca: el móvil nunca lo
  // pisa en silencio (README D2).
  const rolDeLaWeb = !isMobileRole(member.roleName);
  const editable = puedeEditar && !soyYo && !rolDeLaWeb;
  const opciones = roleOptions(roles);

  async function aplicar(patch: { roleId?: string; isActive?: boolean }) {
    setBusy(true);
    const res = await updateMember(member!.userId, patch);
    setBusy(false);
    if (res.status === 'ok') {
      setMember(res.data);
      setError(null);
      return;
    }
    setError(
      res.status === 'offline'
        ? 'Sin conexión: no se guardó.'
        : res.status === 'error'
          ? res.message
          : 'Tu sesión venció.',
    );
  }

  async function reenviar() {
    setBusy(true);
    const res = await resendInvitation(member!.userId);
    setBusy(false);
    if (res.status === 'ok') {
      setCodigo(res.data.invitationCode);
      setError(null);
      return;
    }
    setError(res.status === 'error' ? res.message : 'No se pudo reenviar la invitación.');
  }

  function eliminar() {
    Alert.alert(
      'Cancelar la invitación',
      `Se borra la invitación de ${memberName(member!)} y su correo queda libre para volver a invitarlo.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Cancelar invitación',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              const res = await removeMember(member!.userId);
              setBusy(false);
              if (res.status === 'ok') router.back();
              else setError(res.status === 'error' ? res.message : 'No se pudo cancelar.');
            })();
          },
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title={memberName(member)} onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />

        <View style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' }}>
          {pendiente && <StatusBadge label="Pendiente de aceptar" tone="warning" />}
          {!pendiente && !member.isActive && <StatusBadge label="Inactivo" tone="neutral" />}
          {member.isOwner && <StatusBadge label="Dueño" tone="info" />}
        </View>

        <SectionLabel>Correo</SectionLabel>
        <Text style={styles.value}>{member.email}</Text>

        <SectionLabel>Rol</SectionLabel>
        <SelectRow
          icon="👤"
          value={ROLE_LABEL[member.roleName as RoleType] ?? member.roleName}
          disabled={!editable}
          onPress={() => setSheet(true)}
        />
        {rolDeLaWeb && <Text style={{ ...TYPE.caption }}>Este rol se administra desde la web.</Text>}
        {soyYo && <Text style={{ ...TYPE.caption }}>Este sos vos: tu propio rol lo cambia otro administrador.</Text>}

        {pendiente && (
          <>
            <SectionLabel>Todavía no aceptó</SectionLabel>
            {codigo ? (
              <>
                <Text style={{ ...TYPE.secondary }}>
                  Código nuevo (el anterior dejó de servir). Vence en 7 días.
                </Text>
                <CodigoInvitacion code={codigo} />
              </>
            ) : (
              <Button label="Reenviar invitación" onPress={() => void reenviar()} loading={busy} />
            )}
            {/* ponytail: `ghost` y no un `variant="danger"` nuevo en el Button compartido —
                la guarda contra el borrado accidental es el Alert de confirmación. */}
            {puedeEditar && (
              <Button label="Cancelar la invitación" variant="ghost" onPress={eliminar} disabled={busy} />
            )}
          </>
        )}

        {!pendiente && editable && (
          <>
            <SectionLabel>Acceso</SectionLabel>
            <Button
              label={member.isActive ? 'Desactivar' : 'Reactivar'}
              variant={member.isActive ? 'ghost' : 'primary'}
              onPress={() => void aplicar({ isActive: !member.isActive })}
              loading={busy}
            />
            <Text style={{ ...TYPE.caption }}>
              Desactivado no puede entrar ni cobrar, y libera un lugar de tu plan. Sus gestiones y
              pagos quedan.
            </Text>
          </>
        )}
      </ScrollView>

      <PickerSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Rol en el equipo"
        options={opciones}
        onPick={(roleId) => void aplicar({ roleId })}
      />
    </View>
  );
}

const styles = {
  value: { ...TYPE.body, fontWeight: '600' as const, color: COLORS.text },
};
