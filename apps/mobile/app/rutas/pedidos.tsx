import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ROUTE_REASON_MAX, isValidReason } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { BottomSheet, EmptyState, Header, ListRow, OfflineIndicator, StatusBadge, type BadgeTone } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { authService } from '@/auth-service';
import { nuevoId } from '@/ids';
import { getRoute } from '@/routes.service';
import {
  CHANGE_KIND_LABEL,
  CHANGE_STATUS_LABEL,
  listChangeRequests,
  submitChangeRequest,
  submitDecision,
  type ChangeDecision,
  type RouteChangeRequestItem,
} from '@/route-change-requests';

const TONE: Record<RouteChangeRequestItem['status'], BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

/**
 * Pedidos de cambio de una ruta (R4). Quien armó la ruta ve todos y decide; quien no, ve los suyos, puede retirarlos y pedir
 * uno nuevo. Mismo flujo que la web. El servidor decide quién puede (aquí solo se ofrece lo que corresponde).
 */
export default function PedidosScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const [rows, setRows] = useState<RouteChangeRequestItem[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [owner, setOwner] = useState(false);
  const [canRequest, setCanRequest] = useState(false);
  const [meId, setMeId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  /** Un id por pantalla abierta: reintentar el mismo pedido no lo duplica. */
  const [requestId, setRequestId] = useState<string | undefined>();

  const load = useCallback(async () => {
    const [list, route, me] = await Promise.all([listChangeRequests(routeId), getRoute(routeId), authService.me()]);
    if (me.status === 'ok') setMeId(me.me.userId);
    if (route.status === 'ok') {
      setOwner(route.data.capabilities?.isOwner === true);
      setCanRequest(route.data.capabilities?.requestChange === true);
    }
    if (list.status === 'ok') {
      setRows(list.data);
      setState('ok');
    } else if (list.status === 'offline') setState('offline');
    else if (list.status === 'unauthenticated') router.replace('/(auth)/login');
    else setState('error');
  }, [routeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const decide = async (r: RouteChangeRequestItem, decision: ChangeDecision) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await submitDecision(routeId, r.id, decision);
    setBusy(false);
    if (res.status === 'error' || res.status === 'invalid') return setError(res.message);
    if (res.status === 'queued') setNotice('Sin señal: la decisión se guardó y sube sola.');
    await load();
  };

  const ask = async () => {
    setBusy(true);
    setError(null);
    const res = await submitChangeRequest(routeId, 'CANCEL', reason, undefined, requestId);
    setBusy(false);
    if (res.status === 'error' || res.status === 'invalid') return setError(res.message);
    setAsking(false);
    setReason('');
    setRequestId(undefined);
    setNotice(res.status === 'queued' ? 'Sin señal: el pedido se guardó y sube solo.' : 'Pedido enviado.');
    await load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Pedidos de cambio" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />
        {notice && <Text style={TYPE.secondary}>{notice}</Text>}
        {state === 'loading' && <ActivityIndicator color={COLORS.periwinkle} />}
        {state === 'offline' && <EmptyState title="Sin conexión" hint="Los pedidos se consultan en línea." />}
        {state === 'error' && <EmptyState title="No se pudieron cargar" hint="Probá de nuevo en un momento." />}
        {state === 'ok' && rows && rows.length === 0 && <EmptyState title="No hay pedidos" />}
        {state === 'ok' &&
          rows?.map((r) => {
            const pending = r.status === 'PENDING';
            const mine = r.requestedBy === meId;
            return (
              <View key={r.id} style={styles.card}>
                <ListRow
                  title={CHANGE_KIND_LABEL[r.kind]}
                  subtitle={[r.requestedByName, r.reason].filter(Boolean).join(' · ')}
                  right={<StatusBadge label={CHANGE_STATUS_LABEL[r.status]} tone={TONE[r.status]} />}
                />
                {r.decisionNote && <Text style={TYPE.secondary}>{`Respuesta: ${r.decisionNote}`}</Text>}
                {pending && owner && (
                  <View style={styles.actions}>
                    <View style={{ flex: 1 }}>
                      <Button label="Aprobar" onPress={() => void decide(r, 'APPROVE')} disabled={busy} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Rechazar" variant="ghost" onPress={() => void decide(r, 'REJECT')} disabled={busy} />
                    </View>
                  </View>
                )}
                {pending && mine && !owner && (
                  <Button label="Retirar mi pedido" variant="ghost" onPress={() => void decide(r, 'WITHDRAW')} disabled={busy} />
                )}
              </View>
            );
          })}
        {canRequest && <Button label="Pedir cancelar la ruta" variant="ghost" onPress={() => { setRequestId(nuevoId()); setAsking(true); }} />}
      </ScrollView>

      <BottomSheet visible={asking} onClose={() => setAsking(false)} title="Pedir cancelar la ruta">
        <View style={{ gap: SPACING.sm, padding: SPACING.lg }}>
          <Text style={TYPE.secondary}>Quien armó la ruta recibe tu pedido y lo aprueba o lo rechaza.</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Contá el motivo"
            placeholderTextColor={COLORS.muted}
            multiline
            maxLength={ROUTE_REASON_MAX}
            style={styles.reason}
            accessibilityLabel="Motivo del pedido"
          />
          <Button label="Enviar pedido" onPress={() => void ask()} loading={busy} disabled={busy || !isValidReason(reason)} />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, padding: SPACING.md, gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.border },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  reason: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.input,
    padding: SPACING.md,
    color: COLORS.text,
    textAlignVertical: 'top',
  },
});
