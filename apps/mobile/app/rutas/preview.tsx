import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RouteStatus } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, SectionLabel } from '@/ui';
import { Button } from '@/components';
import { MapCanvas, type MapMarker } from '@/maps/MapCanvas';
import { clockAt, humanDistance, humanDuration, straightLine } from '@/route-eta';
import {
  getRoute,
  getRoutePreview,
  optimizeRoute,
  updateRouteStatus,
  type RouteItem,
  type RoutePreview,
} from '@/routes.service';

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; route: RouteItem; preview: RoutePreview | null };

/**
 * RT-2 · Vista previa de la ruta (S3). El recorrido armado en S2, dibujado **por las calles** con
 * cuánto se camina y cuánto lleva, y —si da vueltas de más— la opción de reordenarlo.
 *
 * **Se degrada, no se bloquea:** sin motor de ruteo o sin señal, el recorrido se dibuja con rectas y
 * los números salen del último cálculo. Confirmar e iniciar la jornada funciona igual: es el
 * no-negociable de offline-first.
 */
export default function PreviewRutaScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [ignored, setIgnored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La hora de salida es cuando se mira la pantalla: las estimaciones cuelgan de ahí.
  const [departure] = useState(() => new Date());

  const fetchAll = useCallback(async () => {
    const route = await getRoute(routeId);
    if (route.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (route.status !== 'ok') return setLoad((p) => (p.status === 'ok' ? p : { status: 'error' }));
    // El preview necesita red; la ruta ya está en pantalla aunque él falle.
    const preview = await getRoutePreview(routeId);
    setLoad({ status: 'ok', route: route.data, preview: preview.status === 'ok' ? preview.data : null });
  }, [routeId]);

  useFocusEffect(
    useCallback(() => {
      void fetchAll();
    }, [fetchAll]),
  );

  const onOptimize = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await optimizeRoute(routeId);
    if (res.status === 'offline') setError('Sin conexión: no se puede reordenar ahora.');
    else if (res.status === 'error') setError(res.message);
    else await fetchAll();
    setBusy(false);
  }, [routeId, fetchAll]);

  const onConfirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await updateRouteStatus(routeId, RouteStatus.IN_PROGRESS);
    setBusy(false);
    // Sin conexión la jornada arranca igual: el estado sube cuando vuelva la red.
    if (res.status === 'error') return setError(res.message);
    router.replace(`/rutas/confirmar?routeId=${routeId}`);
  }, [routeId]);

  if (load.status !== 'ok') {
    return (
      <View style={styles.screen}>
        <Header title="Vista previa" onBack={() => router.back()} />
        {load.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.navy} />
          </View>
        ) : load.status === 'offline' ? (
          <EmptyState icon="📴" title="Sin conexión" hint="Tu ruta aparece cuando vuelva la red." />
        ) : (
          <EmptyState icon="⚠️" title="No se pudo cargar la ruta" hint="Reintentá en un momento." />
        )}
      </View>
    );
  }

  const { route, preview } = load;
  const stops = route.stops ?? [];
  const etaById = new Map((preview?.stops ?? []).map((s) => [s.id, s.etaMinutes]));
  // Sin geometría del server (sin motor o sin red), se unen las paradas con rectas.
  const line = preview?.geometry.length ? preview.geometry : straightLine(stops);
  const suggestion = ignored ? undefined : preview?.suggestion;

  const markers: MapMarker[] = stops
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => ({
      id: s.id,
      latitude: s.latitude!,
      longitude: s.longitude!,
      label: String(s.sequenceOrder),
      tone: 'active',
    }));

  return (
    <View style={styles.screen}>
      <Header title="Vista previa" onBack={() => router.back()} />

      <View style={styles.mapBox}>
        <MapCanvas markers={markers} routeLine={line} controls style={{ flex: 1 }} />
      </View>

      <View style={styles.stats}>
        <Stat label="PARADAS" value={String(stops.length)} />
        <Stat label="DISTANCIA" value={humanDistance(preview?.distanceKm)} />
        <Stat label="DURACIÓN" value={humanDuration(preview?.minutes)} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
        {suggestion && (
          <View style={styles.aviso}>
            <Text style={styles.avisoTitle}>
              ⚠️ Recorrido poco eficiente. Estás recorriendo {humanDistance(suggestion.savedKm)} extra.
            </Text>
            <Text style={TYPE.secondary}>
              Podés ahorrar {suggestion.savedMinutes} min optimizando la ruta.
            </Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Optimizar" onPress={onOptimize} loading={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Ignorar" variant="ghost" onPress={() => setIgnored(true)} />
              </View>
            </View>
          </View>
        )}

        {!preview && (
          <Text style={TYPE.caption}>
            No se pudo calcular el recorrido por las calles. Se muestra en línea recta; podés iniciar la ruta igual.
          </Text>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <SectionLabel>{`SECUENCIA DE PARADAS (${stops.length})`}</SectionLabel>
        {stops.length === 0 ? (
          <EmptyState icon="📍" title="Ruta sin paradas" hint="Agregá paradas desde el mapa antes de iniciar." />
        ) : (
          stops.map((s) => {
            const eta = etaById.get(s.id);
            return (
              <ListRow
                key={s.id}
                title={`${s.sequenceOrder}. ${s.clientName ?? 'Cliente sin nombre'}`}
                subtitle={s.address ?? 'Sin dirección cargada'}
                right={<Text style={styles.hora}>{eta != null ? clockAt(departure, eta) : '—'}</Text>}
              />
            );
          })
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Confirmar e iniciar ruta →" onPress={onConfirm} loading={busy} disabled={stops.length === 0} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mapBox: { height: 240 },
  stats: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: -SPACING.xl,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statLabel: { ...TYPE.caption, letterSpacing: 0.5 },
  statValue: { ...TYPE.h3, color: COLORS.navy },
  aviso: {
    backgroundColor: COLORS.warningBg,
    borderRadius: RADIUS.card,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  avisoTitle: { ...TYPE.body, fontWeight: '700', color: COLORS.navy },
  hora: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
  error: { ...TYPE.secondary, color: COLORS.danger, textAlign: 'center' },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
});
