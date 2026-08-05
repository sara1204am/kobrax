import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RouteStopStatus } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, StopCard } from '@/ui';
import { Button } from '@/components';
import { MapCanvas, type MapMarker } from '@/maps/MapCanvas';
import { money } from '@/agenda-form';
import { actionLinks, clientContext } from '@/agenda.service';
import { straightLine } from '@/route-eta';
import { getRoute, getRoutePreview, type RouteItem, type RouteStopItem } from '@/routes.service';

/**
 * RT-4 · Mapa activo (Rutas S4). La jornada ya arrancó: el cobrador ve su recorrido, toca el pin de
 * la parada a la que llegó y de ahí dispara la acción.
 *
 * **Registrar el resultado es S5.** Acá el botón avisa, igual que hizo S1 con el FAB hasta que
 * llegó S2: la pantalla se valida completa antes de que exista el sheet.
 */
export default function MapaRutaScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const [route, setRoute] = useState<RouteItem | null>(null);
  const [line, setLine] = useState<{ latitude: number; longitude: number }[]>([]);
  const [zigzag, setZigzag] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const res = await getRoute(routeId);
    if (res.status !== 'ok') {
      // Sin red no se borra lo que ya está en pantalla: el cobrador sigue viendo su ruta.
      return setError(res.status === 'offline' ? 'Sin conexión.' : 'No se pudo cargar la ruta.');
    }
    setError(null);
    setRoute(res.data);
    setSelectedId((prev) => prev ?? firstPending(res.data)?.id ?? null);

    // El recorrido por calles necesita red; el mapa se dibuja igual sin él (rectas).
    const preview = await getRoutePreview(routeId);
    if (preview.status === 'ok') {
      setLine(preview.data.geometry.length ? preview.data.geometry : straightLine(res.data.stops ?? []));
      // D4: el aviso se muestra si el recorrido vigente TODAVÍA da vueltas de más.
      setZigzag(!!preview.data.suggestion);
    } else {
      setLine(straightLine(res.data.stops ?? []));
    }
  }, [routeId]);

  useFocusEffect(
    useCallback(() => {
      void fetchAll();
    }, [fetchAll]),
  );

  const stops = route?.stops ?? [];
  const selected = stops.find((s) => s.id === selectedId);

  // El teléfono de la parada elegida, para que "Llamar" no dependa de abrir la ficha.
  const loadPhone = useCallback(async (clientId: string) => {
    setPhone(undefined);
    const ctx = await clientContext(clientId);
    if (ctx.status === 'ok') setPhone(ctx.data.contacts.find((c) => c.value)?.value ?? undefined);
  }, []);

  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const stop = stops.find((s) => s.id === id);
      if (stop) void loadPhone(stop.clientId);
    },
    [stops, loadPhone],
  );

  if (!route) {
    return (
      <View style={styles.screen}>
        <Header title="Mapa de Ruta" onBack={() => router.back()} />
        {error ? (
          <EmptyState icon="⚠️" title={error} />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.navy} />
          </View>
        )}
      </View>
    );
  }

  const markers: MapMarker[] = stops
    .filter((s): s is RouteStopItem & { latitude: number; longitude: number } => s.latitude != null && s.longitude != null)
    .map((s) => ({
      id: s.id,
      latitude: s.latitude,
      longitude: s.longitude,
      label: String(s.sequenceOrder),
      selected: s.id === selectedId,
      tone: s.status === RouteStopStatus.VISITED ? 'done' : s.id === selectedId ? 'active' : 'default',
    }));

  const links = actionLinks({ phone });
  const sinPendientes = stops.length > 0 && !stops.some((s) => s.status === RouteStopStatus.PENDING);
  const center = selected?.latitude != null && selected.longitude != null
    ? { latitude: selected.latitude, longitude: selected.longitude }
    : undefined;

  return (
    <View style={styles.screen}>
      <Header title="Mapa de Ruta" onBack={() => router.back()} />

      {zigzag && (
        <View style={styles.zigzag}>
          <Text style={styles.zigzagText}>Ruta con ZIGZAG ACTIVA</Text>
        </View>
      )}

      <MapCanvas
        markers={markers}
        routeLine={line}
        center={center}
        controls
        onMarkerPress={onSelect}
        style={{ flex: 1 }}
      />

      {selected ? (
        <StopCard
          title={selected.clientName ?? 'Cliente sin nombre'}
          address={selected.address}
          // Monto y moneda vienen juntos del crédito o no vienen: sin moneda no se inventa una.
          overdue={
            selected.overdueAmount != null && selected.currency
              ? money(selected.overdueAmount, selected.currency)
              : undefined
          }
          daysPastDue={selected.daysPastDue}
          onPrimary={() => router.push(`/rutas/resultado?routeId=${routeId}&stopId=${selected.id}`)}
          actions={
            <View style={styles.acciones}>
              <View style={{ flex: 1 }}>
                <Button
                  label="📞 Llamar"
                  variant="ghost"
                  disabled={!links.tel}
                  onPress={() => links.tel && void Linking.openURL(links.tel)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Ver detalle"
                  variant="ghost"
                  onPress={() => router.push(`/cliente/${selected.clientId}?routeId=${routeId}&stopId=${selected.id}`)}
                />
              </View>
            </View>
          }
        />
      ) : sinPendientes ? (
        // No queda nada por hacer: el paso siguiente es cerrar el día (S6), no seguir en el mapa.
        <View style={styles.cierre}>
          <Text style={TYPE.h2}>¡Terminaste tus paradas!</Text>
          <Button label="Ver resumen de la jornada" onPress={() => router.push(`/rutas/resumen?routeId=${routeId}`)} />
        </View>
      ) : (
        <EmptyState icon="📍" title="Ruta sin paradas ubicadas" hint="Cargá la dirección de tus clientes para verlos en el mapa." />
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

/** La primera parada por hacer: es la que el cobrador tiene enfrente al abrir el mapa. */
function firstPending(route: RouteItem): RouteStopItem | undefined {
  return (route.stops ?? []).find((s) => s.status === RouteStopStatus.PENDING);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cierre: { padding: SPACING.lg, gap: SPACING.md, alignItems: 'center', backgroundColor: COLORS.white },
  zigzag: { backgroundColor: COLORS.navy, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  zigzagText: { ...TYPE.secondary, color: COLORS.white, fontWeight: '700' },
  acciones: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  error: {
    ...TYPE.secondary,
    color: COLORS.danger,
    textAlign: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
  },
});
