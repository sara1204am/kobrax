import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RouteStopStatus } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, SectionLabel, StatTile } from '@/ui';
import { Button } from '@/components';
import { humanDistance, humanDuration } from '@/route-eta';
import { actionLinks, clientContext } from '@/agenda.service';
import { getRoute, type RouteItem, type RouteStopItem } from '@/routes.service';

/**
 * RT-3 · La jornada arrancó (S3). Confirma lo que el cobrador va a hacer y lo deja parado en la
 * primera visita: adónde ir y a quién llamar, sin volver a buscar nada.
 *
 * La ruta ya pasó a `IN_PROGRESS` en la pantalla anterior — acá no se decide, se muestra. El mapa
 * activo parada por parada es S4.
 */
export default function ConfirmarRutaScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const [route, setRoute] = useState<RouteItem | null>(null);
  const [phone, setPhone] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const fetchRoute = useCallback(async () => {
    const res = await getRoute(routeId);
    if (res.status !== 'ok') {
      return setError(res.status === 'offline' ? 'Sin conexión.' : 'No se pudo cargar la ruta.');
    }
    setRoute(res.data);
    // El teléfono de la primera visita, para que "Llamar" no dependa de otra pantalla.
    const next = pending(res.data)[0];
    if (!next) return;
    const ctx = await clientContext(next.clientId);
    if (ctx.status === 'ok') setPhone(ctx.data.contacts.find((c) => c.value)?.value ?? undefined);
  }, [routeId]);

  useFocusEffect(
    useCallback(() => {
      void fetchRoute();
    }, [fetchRoute]),
  );

  if (!route) {
    return (
      <View style={styles.screen}>
        <Header title="Confirmación" onBack={() => router.back()} />
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

  const stops = pending(route);
  const [next, ...resto] = stops;
  const tel = actionLinks({ phone }).tel;

  return (
    <View style={styles.screen}>
      <Header title="Confirmación" onBack={() => router.replace('/(tabs)/rutas')} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.lg, paddingBottom: SPACING.xxl }}>
        <View style={{ alignItems: 'center', gap: SPACING.sm }}>
          <Text style={styles.bigIcon}>🚀</Text>
          <Text style={TYPE.h1}>¡Todo listo para iniciar!</Text>
          <Text style={[TYPE.secondary, { textAlign: 'center' }]}>
            Revisá el resumen antes de comenzar tu recorrido de hoy.
          </Text>
        </View>

        <View style={styles.resumen}>
          <StatTile label="CLIENTES" value={String(route.totalCases || (route.stops ?? []).length)} />
          <StatTile label="RECORRIDO" value={humanDistance(route.totalDistanceKm)} />
          <StatTile label="ESTIMADOS" value={humanDuration(route.estimatedMinutes)} />
        </View>

        {next ? (
          <View style={{ gap: SPACING.sm }}>
            <SectionLabel>SIGUIENTE PARADA</SectionLabel>
            <View style={styles.nextCard}>
              <Text style={styles.nextName} numberOfLines={1}>
                {next.clientName ?? 'Cliente sin nombre'}
              </Text>
              <Text style={styles.nextAddress} numberOfLines={2}>
                {next.address ?? 'Sin dirección cargada'}
              </Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <View style={{ flex: 1 }}>
                  {/* Navegar abre el mapa de Kobrax, no Google Maps (decisión de S2). */}
                  <Button
                    label="📍 Navegar"
                    variant="ghost"
                    onPress={() =>
                      router.push(`/cliente/mapa?clientId=${next.clientId}&name=${encodeURIComponent(next.clientName ?? '')}`)
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="📞 Llamar"
                    variant="ghost"
                    disabled={!tel}
                    onPress={() => tel && void Linking.openURL(tel)}
                  />
                </View>
              </View>
            </View>
          </View>
        ) : (
          <EmptyState icon="✅" title="Sin paradas pendientes" hint="Todas las visitas de hoy están resueltas." />
        )}

        {resto.length > 0 && (
          <View style={{ gap: SPACING.sm }}>
            <SectionLabel>{`PARADAS PENDIENTES (${resto.length})`}</SectionLabel>
            {resto.map((s) => (
              <ListRow
                key={s.id}
                title={`${s.sequenceOrder}. ${s.clientName ?? 'Cliente sin nombre'}`}
                subtitle={s.address ?? 'Sin dirección cargada'}
                onPress={() => router.push(`/cliente/${s.clientId}`)}
              />
            ))}
          </View>
        )}

        {/* La jornada ya arrancó: el paso natural es el mapa activo (S4), no volver al listado. */}
        <Button label="Ir al mapa de la ruta" onPress={() => router.replace(`/rutas/mapa?routeId=${routeId}`)} />
        <Button label="Ver mi ruta" variant="ghost" onPress={() => router.replace('/(tabs)/rutas')} />
      </ScrollView>
    </View>
  );
}

/** Las paradas que quedan por hacer, en orden de recorrido. */
function pending(route: RouteItem): RouteStopItem[] {
  return (route.stops ?? []).filter((s) => s.status === RouteStopStatus.PENDING);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bigIcon: { fontSize: 48 },
  resumen: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  nextCard: { backgroundColor: COLORS.navy, borderRadius: RADIUS.card, padding: SPACING.lg, gap: SPACING.xs },
  nextName: { fontSize: 19, fontWeight: '600', color: COLORS.white },
  nextAddress: { ...TYPE.secondary, color: COLORS.lightBg },
});
