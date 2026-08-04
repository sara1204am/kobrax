import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RouteStatus, RouteStopStatus } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, ROUTE_STATUS_LABEL, SectionLabel, StatTile, StatusBadge, STOP_STATUS_META } from '@/ui';
import { Button } from '@/components';
import { formatLongDate, todayISO } from '@/agenda-form';
import { authService } from '@/auth-service';
import type { MutateResult } from '@/api-client';
import {
  generateRoute,
  getRoute,
  listRoutes,
  routeProgress,
  updateRouteStatus,
  type RouteItem,
  type RouteStopItem,
} from '@/routes.service';

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  /** `route: null` = hoy no tiene ruta (RT-0a). */
  | { status: 'ok'; collectorId: string; route: RouteItem | null };

const TERMINAL: RouteStatus[] = [RouteStatus.COMPLETED, RouteStatus.CANCELLED];

/**
 * Rutas del día (S1, RT-0a/b/c): una pantalla con tres estados —sin ruta, en curso, finalizada—.
 * Sin mapa: crear-en-mapa y el mapa activo llegan en S2/S4. Las paradas traen nombre y dirección
 * del backend (`GET /routes/:id`), porque una lista de ids no le sirve a nadie en campo.
 */
export default function RutasScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const fetchRoute = useCallback(async () => {
    // Foco de tab + pull-to-refresh + recarga post-acción se pisan: sólo el último pedido escribe
    // (mismo guard que la Cartera).
    const reqId = ++reqRef.current;
    const stale = () => reqId !== reqRef.current;

    const me = await authService.me();
    if (stale()) return;
    if (me.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (me.status !== 'ok') return router.replace('/(auth)/login');
    const collectorId = me.me.userId;

    // ponytail: se filtra por fecha en el móvil, no con `?date=` — el backend compara `plannedDate`
    // por igualdad exacta de datetime y una ruta creada con hora no matchearía nunca.
    const res = await listRoutes({ collectorId });
    if (stale()) return;
    if (res.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (res.status !== 'ok') return setLoad((p) => (p.status === 'ok' ? p : { status: 'error' }));

    const today = todayISO();
    const mine = res.data.find((r) => r.plannedDate.slice(0, 10) === today) ?? null;
    // El listado no trae paradas: el detalle es el que da nombre y dirección de cada una.
    const detail = mine ? await getRoute(mine.id) : null;
    if (stale()) return;
    setLoad({ status: 'ok', collectorId, route: detail?.status === 'ok' ? detail.data : mine });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchRoute();
    }, [fetchRoute]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRoute();
    setRefreshing(false);
  }, [fetchRoute]);

  /** Envuelve una acción de escritura: bloquea el botón, muestra el error del server y recarga. */
  const run = useCallback(
    async (action: () => Promise<MutateResult<RouteItem>>) => {
      setBusy(true);
      setActionError(null);
      const res = await action();
      if (res.status === 'offline') setActionError('Sin conexión. Reintentá cuando vuelva la red.');
      else if (res.status === 'error') setActionError(res.message);
      // `unauthenticated` cae acá: `fetchRoute` lo detecta con `me()` y manda al login.
      else await fetchRoute();
      setBusy(false);
    },
    [fetchRoute],
  );

  if (load.status !== 'ok') {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Rutas" />
        {load.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.navy} />
          </View>
        ) : load.status === 'offline' ? (
          <EmptyState icon="📴" title="Sin conexión" hint="Tu ruta aparecerá cuando vuelva la red." />
        ) : (
          <EmptyState icon="⚠️" title="No se pudo cargar" hint="Deslizá para reintentar en un momento." />
        )}
      </View>
    );
  }

  const { route, collectorId } = load;
  const finished = !!route && TERMINAL.includes(route.status);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Rutas" />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
      >
        <Text style={TYPE.secondary}>{formatLongDate(todayISO())}</Text>

        {!route ? (
          <SinRuta
            busy={busy}
            onGenerate={() => run(() => generateRoute({ collectorId, plannedDate: todayISO() }))}
          />
        ) : finished ? (
          <RutaFinalizada route={route} />
        ) : (
          // Iniciar pasa por la vista previa (S3): ahí se ve el recorrido, se mide y se confirma.
          <RutaEnCurso route={route} onStart={() => router.push(`/rutas/preview?routeId=${route.id}`)} />
        )}

        {actionError && <Text style={styles.error}>{actionError}</Text>}

        {route && <Paradas stops={route.stops ?? []} readOnly={finished} />}
      </ScrollView>
    </View>
  );
}

/** RT-0a: sin ruta para hoy. Los dos caminos a la vista; el del mapa apagado y diciendo por qué. */
function SinRuta({ busy, onGenerate }: { busy: boolean; onGenerate: () => void }) {
  return (
    <View style={[styles.card, { alignItems: 'center', gap: SPACING.md }]}>
      <Text style={styles.bigIcon}>🗺️</Text>
      <Text style={TYPE.h2}>Sin ruta para hoy</Text>
      <Text style={[TYPE.secondary, { textAlign: 'center' }]}>
        Todavía no organizaste tus visitas. Generá la ruta con tus casos abiertos.
      </Text>
      <View style={{ alignSelf: 'stretch', gap: SPACING.sm }}>
        <Button label="Generar ruta del día" onPress={onGenerate} loading={busy} />
        <Button label="Crear desde el mapa" variant="ghost" onPress={() => router.push('/rutas/crear')} />
      </View>
    </View>
  );
}

/** RT-0b: ruta planificada o en curso — progreso, métricas y la acción del día. */
function RutaEnCurso({ route, onStart }: { route: RouteItem; onStart: () => void }) {
  const { done, total } = routeProgress(route);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const planned = route.status === RouteStatus.PLANNED;
  const next = (route.stops ?? []).find((s) => s.status === RouteStopStatus.PENDING);

  return (
    <>
      <View style={[styles.card, { gap: SPACING.md }]}>
        <View style={styles.cardHead}>
          <Text style={TYPE.h2}>Ruta del día</Text>
          <StatusBadge label={ROUTE_STATUS_LABEL[route.status]} tone={planned ? 'neutral' : 'info'} />
        </View>

        <View>
          <View style={styles.cardHead}>
            <Text style={TYPE.secondary}>Progreso de ruta</Text>
            <Text style={styles.pct}>{pct}%</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct}%` }]} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: SPACING.md }}>
          <StatTile label="Visitas" value={`${done}/${total}`} />
          <StatTile label="Pendientes" value={String(total - done)} />
          {/* "Cobrado" se activa con los pagos en campo (P4), igual que en el Home. */}
          <StatTile label="Cobrado" value="—" />
        </View>

        {planned ? (
          <Button label="Iniciar ruta" onPress={onStart} />
        ) : (
          <View style={{ gap: SPACING.xs }}>
            <Button label="Continuar ruta" onPress={() => {}} disabled />
            <Text style={[TYPE.caption, { textAlign: 'center' }]}>
              El mapa de la ruta activa llega en la próxima versión.
            </Text>
          </View>
        )}

        {/* La ruta a medio armar es la ruta del día (D-S2-VIDA): sin esta puerta, el mapa quedaría
            inalcanzable — el vacío que lo ofrece ya no se muestra. */}
        <Button label="Agregar paradas en el mapa" variant="ghost" onPress={() => router.push('/rutas/crear')} />
      </View>

      {next && (
        <View style={{ gap: SPACING.sm }}>
          <SectionLabel>SIGUIENTE PARADA</SectionLabel>
          <Pressable
            style={styles.nextCard}
            accessibilityRole="button"
            onPress={() => router.push(`/cliente/${next.clientId}`)}
          >
            <Text style={styles.nextName} numberOfLines={1}>
              {next.clientName ?? 'Cliente sin nombre'}
            </Text>
            <Text style={styles.nextAddress} numberOfLines={2}>
              {next.address ?? 'Sin dirección cargada'}
            </Text>
            <Text style={styles.nextLink}>Ver cliente ›</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

/** RT-0c: la jornada cerrada — métricas del día y las paradas en modo lectura. */
function RutaFinalizada({ route }: { route: RouteItem }) {
  const { done, total } = routeProgress(route);
  const cancelled = route.status === RouteStatus.CANCELLED;
  return (
    <View style={[styles.card, { alignItems: 'center', gap: SPACING.md }]}>
      <Text style={styles.bigIcon}>{cancelled ? '🚫' : '✅'}</Text>
      <Text style={TYPE.h2}>{cancelled ? 'Ruta cancelada' : '¡Ruta finalizada!'}</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.md, alignSelf: 'stretch' }}>
        <StatTile label="Visitas" value={`${done}/${total}`} tone={cancelled ? 'neutral' : 'success'} />
        <StatTile label="Cobrado" value="—" />
      </View>
    </View>
  );
}

/** Lista de paradas en orden de recorrido. `readOnly` = jornada cerrada (no se navega al cliente). */
function Paradas({ stops, readOnly }: { stops: RouteStopItem[]; readOnly: boolean }) {
  if (stops.length === 0) {
    return <EmptyState icon="📍" title="Ruta sin paradas" hint="Generá la ruta de nuevo para cargar tus casos." />;
  }
  return (
    <View style={{ gap: SPACING.sm }}>
      <SectionLabel>{`PARADAS (${stops.length})`}</SectionLabel>
      {stops.map((s) => {
        const meta = STOP_STATUS_META[s.status];
        return (
          <ListRow
            key={s.id}
            title={`${s.sequenceOrder}. ${s.clientName ?? 'Cliente sin nombre'}`}
            subtitle={s.address ?? 'Sin dirección cargada'}
            right={<StatusBadge label={meta.label} tone={meta.tone} />}
            onPress={readOnly ? undefined : () => router.push(`/cliente/${s.clientId}`)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bigIcon: { fontSize: 40 },
  pct: { ...TYPE.h3, color: COLORS.navy },
  barTrack: { height: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.lightBg, marginTop: SPACING.sm, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.success },
  nextCard: { backgroundColor: COLORS.navy, borderRadius: RADIUS.card, padding: SPACING.lg, gap: SPACING.xs },
  nextName: { fontSize: 17, fontWeight: '600', color: COLORS.white },
  nextAddress: { ...TYPE.secondary, color: COLORS.lightBg },
  nextLink: { ...TYPE.link, color: COLORS.white, marginTop: SPACING.xs },
  error: { ...TYPE.secondary, color: COLORS.danger, textAlign: 'center' },
});
