import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { NotificationType, type NotificationPayload } from '@kobrax/shared';
import { COLORS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, OfflineIndicator, SegmentTabs } from '@/ui';
import {
  listNotifications,
  markAllRead,
  markRead,
  whenLabel,
} from '@/notifications.service';

/** Ícono por tipo. Mismo criterio que `AGENDA_TYPE_META`, pero acá no lo usa nadie más. */
const TYPE_ICON: Record<NotificationType, string> = {
  [NotificationType.CASE_ASSIGNED]: '📋',
  [NotificationType.CASE_UPDATED]: '🔄',
  [NotificationType.PAYMENT_REGISTERED]: '💵',
  [NotificationType.ROUTE_ASSIGNED]: '🗺️',
  [NotificationType.PROMISE_DUE]: '🤝',
  [NotificationType.SYSTEM]: '🔔',
};

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; items: NotificationPayload[] };

/**
 * Buzón de notificaciones. Entrada: el badge 🔔 del Home, que hasta ahora contaba y no llevaba
 * a ningún lado (`ui-screen-map` `64:538`).
 *
 * Marcar leída no es una acción aparte: pasa al tocar la fila, que es lo que el cobrador hace
 * naturalmente. "Marcar todas" existe para el día que vuelve del campo con 20 sin abrir.
 */
export default function NotificacionesScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [refreshing, setRefreshing] = useState(false);

  const fetch = useCallback(async (soloNoLeidas: boolean) => {
    const res = await listNotifications(soloNoLeidas || undefined);
    if (res.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (res.status !== 'ok') return setLoad((p) => (p.status === 'ok' ? p : { status: 'error' }));
    setLoad({ status: 'ok', items: res.data });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetch(tab === 'unread');
    }, [fetch, tab]),
  );

  const items = load.status === 'ok' ? load.items : [];
  const sinLeer = items.filter((n) => !n.readAt).length;

  const abrir = useCallback(
    async (n: NotificationPayload) => {
      // Optimista: la fila se ve leída al instante y el server se entera después. Si falla, la
      // próxima recarga la vuelve a mostrar sin leer — nada se pierde.
      if (!n.readAt) {
        setLoad((p) =>
          p.status === 'ok'
            ? { ...p, items: p.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) }
            : p,
        );
        void markRead(n.id);
      }
      // El destino útil es el deudor: no hay pantalla de caso suelto.
      if (n.clientId) router.push(`/cliente/${n.clientId}`);
    },
    [],
  );

  const marcarTodas = useCallback(async () => {
    const res = await markAllRead();
    if (res.status === 'ok') await fetch(tab === 'unread');
  }, [fetch, tab]);

  return (
    <View style={styles.screen}>
      <Header
        title="Notificaciones"
        onBack={() => router.back()}
        right={
          sinLeer > 0 ? (
            <Pressable onPress={marcarTodas} hitSlop={8} accessibilityRole="button">
              <Text style={styles.accion}>Marcar todas</Text>
            </Pressable>
          ) : undefined
        }
      />
      <OfflineIndicator />

      <View style={styles.tabs}>
        <SegmentTabs
          items={[
            { key: 'unread', label: 'Sin leer', count: sinLeer },
            { key: 'all', label: 'Todas', count: tab === 'all' ? items.length : '' },
          ]}
          value={tab}
          onChange={(k) => setTab(k as 'unread' | 'all')}
        />
      </View>

      {load.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : load.status === 'offline' ? (
        <EmptyState icon="📴" title="Sin conexión" hint="Tus notificaciones aparecen cuando vuelva la red." />
      ) : load.status === 'error' ? (
        <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={tab === 'unread' ? 'Sin notificaciones nuevas' : 'Todavía no hay notificaciones'}
          hint={tab === 'unread' ? 'Cuando llegue algo, aparece acá.' : undefined}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.lista}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={COLORS.navy}
              onRefresh={async () => {
                setRefreshing(true);
                await fetch(tab === 'unread');
                setRefreshing(false);
              }}
            />
          }
        >
          {items.map((n) => (
            <ListRow
              key={n.id}
              title={`${TYPE_ICON[n.type] ?? '🔔'}  ${n.title}`}
              subtitle={n.body ?? undefined}
              right={
                <View style={styles.derecha}>
                  <Text style={TYPE.caption}>{whenLabel(n.createdAt)}</Text>
                  {!n.readAt && <View style={styles.punto} />}
                </View>
              }
              onPress={() => void abrir(n)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabs: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  lista: { padding: SPACING.lg, gap: SPACING.md },
  accion: { ...TYPE.secondary, color: COLORS.white, fontWeight: '600' },
  derecha: { alignItems: 'flex-end', gap: 6 },
  // El punto es lo único que distingue una sin leer: el resto de la fila es idéntico.
  punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.purple },
});
