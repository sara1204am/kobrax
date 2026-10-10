import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { BottomSheet, EmptyState, Header, ListRow, PORTFOLIO_STATUS_META, StatusBadge } from '@/ui';
import { Button } from '@/components';
import { MapCanvas, type MapMarker } from '@/maps/MapCanvas';
import { money, todayISO } from '@/agenda-form';
import type { PortfolioLocation } from '@kobrax/shared';
import { toRouteCandidates, type RouteCandidate } from '@/route-candidates';
import { createRoute, listRoutePlanCredits, listRoutes } from '@/routes.service';
import { lugarLabel } from '@/route-labels';
import { isPlannableDay, planningDays } from '@/route-days';
import { flushDraft, loadDraft, moveStop, saveDraft, withoutStop, withStop, type RouteDraft } from '@/route-draft';
import { authService } from '@/auth-service';
import { useNetStore } from '@/store/net';

/** Una candidata = un crédito (una parada = un crédito). */
type Cliente = RouteCandidate;

/**
 * Un pin del mapa = **una ubicación**, no un cliente: la casa, el negocio, y también la del garante o
 * la familia. Una deuda se cobra donde esté la persona.
 */
interface Pin {
  loc: PortfolioLocation;
  cliente: Cliente;
}

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; pins: Pin[]; sinUbicacion: Cliente[] };

/**
 * RT-1 · Armar la ruta desde el mapa (S2). La cartera del cobrador se pinta sobre el mapa y cada
 * toque agrega o saca una parada. **Nada se escribe directo en el server**: todo pasa por el borrador
 * local (`route-draft`), que se sincroniza al toque si hay red y al reconectar si no la había. Por eso
 * la pantalla funciona igual en modo avión.
 */
export default function CrearRutaScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const today = todayISO();
  /** El día que se arma (D-6): hoy por defecto, hasta 14 días hacia adelante. */
  const [day, setDay] = useState(isPlannableDay(params.date, today) ? params.date : today);
  /** Días que ya tienen una ruta (una por cobrador y día): esos no se vuelven a armar desde acá. */
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // id de la ubicación
  const [sheet, setSheet] = useState<'recorrido' | 'sin-ubicacion' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useNetStore((s) => s.isConnected);

  const fetchCartera = useCallback(async () => {
    const me = await authService.me();
    if (me.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (me.status !== 'ok') return router.replace('/(auth)/login');

    setDraft(await loadDraft(day));

    // Qué días ya tienen ruta: la API permite una por cobrador y día, y armarla de nuevo chocaría.
    const mine = await listRoutes({ collectorId: me.me.userId });
    if (mine.status === 'ok') setTaken(new Set(mine.data.map((r) => String(r.plannedDate).slice(0, 10))));

    // Los créditos en mora del cobrador (`GET /mora`), ya acotados a él y con el punto de cada cliente.
    // Un crédito ya pagado no está en la lista: no se sale a visitar a quien ya pagó.
    const res = await listRoutePlanCredits();
    if (res.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (res.status !== 'ok') return setLoad((p) => (p.status === 'ok' ? p : { status: 'error' }));

    // Una candidata por crédito: un cliente con dos créditos en mora puede aportar dos paradas.
    const todos: Cliente[] = toRouteCandidates(res.data);

    setLoad({
      status: 'ok',
      // Un pin por ubicación: un cliente con casa, negocio y garante aporta tres.
      pins: todos.flatMap((cliente) => cliente.locations.map((loc) => ({ loc, cliente }))),
      sinUbicacion: todos.filter((c) => c.locations.length === 0),
    });
  }, [day]);

  useFocusEffect(
    useCallback(() => {
      void fetchCartera();
    }, [fetchCartera]),
  );

  /** Guarda el borrador y lo intenta sincronizar. Sin red no pasa nada malo: queda pendiente. */
  const commit = useCallback(
    async (next: RouteDraft) => {
      setDraft(next);
      setError(null);
      await saveDraft(next);
      if (!online) return setPending(true);
      const me = await authService.me();
      if (me.status !== 'ok') return setPending(true);
      const res = await flushDraft(next, (id) => createRoute({ id, collectorId: me.me.userId, plannedDate: day }));
      if (res.status === 'ok') {
        setDraft(res.draft);
        setPending(false);
      } else {
        setPending(true);
        if (res.status === 'error') setError(res.message);
      }
    },
    [online, day],
  );

  const enRuta = useMemo(() => new Set(draft?.creditIds ?? []), [draft]);
  const pins = load.status === 'ok' ? load.pins : [];
  const elegido = pins.find((p) => p.loc.id === selected);

  const markers: MapMarker[] = pins.map((p) => ({
    id: p.loc.id,
    latitude: p.loc.latitude,
    longitude: p.loc.longitude,
    label: enRuta.has(p.cliente.creditId) ? String(draft!.creditIds.indexOf(p.cliente.creditId) + 1) : undefined,
    tone: enRuta.has(p.cliente.creditId) ? 'active' : p.cliente.daysPastDue > 0 ? 'done' : 'default',
    selected: p.loc.id === selected,
  }));

  if (load.status !== 'ok') {
    return (
      <View style={styles.screen}>
        <Header title="Crear ruta" onBack={() => router.back()} />
        {load.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.navy} />
          </View>
        ) : load.status === 'offline' ? (
          <EmptyState icon="📴" title="Sin conexión" hint="Tu cartera aparece cuando vuelva la red." />
        ) : (
          <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />
        )}
      </View>
    );
  }

  const total = draft?.creditIds.length ?? 0;

  return (
    <View style={styles.screen}>
      <Header
        title="Crear ruta"
        onBack={() => router.back()}
        right={pending ? <StatusBadge label="Sin sincronizar" tone="warning" /> : undefined}
      />

      {/* El día que se arma (D-6): hoy y hasta 14 días hacia adelante. Un día que ya tiene ruta se marca y no se vuelve a armar. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.days}
        contentContainerStyle={styles.daysContent}
        accessibilityLabel="Día de la ruta"
      >
        {planningDays(today).map((d) => {
          const active = d.date === day;
          const hasRoute = taken.has(d.date);
          return (
            <Pressable
              key={d.date}
              onPress={() => {
                if (active) return;
                setSelected(null);
                setSheet(null);
                setError(null);
                setLoad({ status: 'loading' });
                setDay(d.date);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${d.label} ${d.dayOfMonth}${hasRoute ? ', ya tiene ruta' : ''}`}
              style={[styles.dayChip, active && styles.dayChipActive]}
            >
              <Text style={[styles.dayLabel, active && styles.dayLabelActive]}>{d.label}</Text>
              <Text style={[styles.dayNumber, active && styles.dayLabelActive]}>{d.dayOfMonth}</Text>
              {hasRoute && <View style={[styles.dayDot, active && { backgroundColor: COLORS.white }]} />}
            </Pressable>
          );
        })}
      </ScrollView>
      {taken.has(day) && !draft?.routeId && (
        <Text style={styles.aviso2}>Ya tenés una ruta armada para este día: la ves en la pestaña Rutas.</Text>
      )}

      <MapCanvas
        markers={markers}
        controls
        onMarkerPress={setSelected}
        onMapPress={(p) => router.push(`/cliente/nuevo?lat=${p.latitude.toFixed(6)}&lng=${p.longitude.toFixed(6)}`)}
        style={{ flex: 1 }}
      />

      {load.sinUbicacion.length > 0 && (
        <Pressable style={styles.aviso} onPress={() => setSheet('sin-ubicacion')} accessibilityRole="button">
          <Text style={styles.avisoText}>
            {load.sinUbicacion.length} {load.sinUbicacion.length === 1 ? 'cliente' : 'clientes'} sin ubicación cargada ›
          </Text>
        </Pressable>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {elegido && (
        <View style={styles.card}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.nombre} numberOfLines={1}>
              {elegido.cliente.name}
            </Text>
            {/* De quién es este punto: del cliente, o de su garante/familiar. */}
            <Text style={styles.lugar} numberOfLines={1}>
              {lugarLabel(elegido.loc)}
            </Text>
            <Text style={TYPE.secondary} numberOfLines={1}>
              {elegido.loc.address ?? elegido.cliente.secondaryLine}
            </Text>
            <Text style={[styles.monto, elegido.cliente.daysPastDue > 0 && { color: COLORS.danger }]}>
              {money(elegido.cliente.balance, elegido.cliente.currency)}
            </Text>
          </View>
          <View style={{ gap: SPACING.sm, alignItems: 'flex-end' }}>
            <StatusBadge {...PORTFOLIO_STATUS_META[elegido.cliente.status]} />
            {enRuta.has(elegido.cliente.creditId) ? (
              <Button label="Quitar" variant="ghost" onPress={() => void commit(withoutStop(draft!, elegido.cliente.creditId))} />
            ) : (
              <Button
                label="Agregar al recorrido"
                disabled={taken.has(day) && !draft?.routeId}
                onPress={() =>
                  void commit(
                    withStop(
                      draft ?? { routeId: null, date: day, creditIds: [], clientByCredit: {} },
                      elegido.cliente.creditId,
                      elegido.cliente.clientId,
                      elegido.loc.id,
                    ),
                  )
                }
              />
            )}
          </View>
        </View>
      )}

      <Pressable
        style={[styles.barra, total === 0 && styles.barraVacia]}
        disabled={total === 0}
        onPress={() => setSheet('recorrido')}
        accessibilityRole="button"
      >
        <Text style={styles.barraText}>
          {total === 0 ? 'Tocá un cliente para armar el recorrido' : `Ver el recorrido · ${total} ${total === 1 ? 'parada' : 'paradas'}`}
        </Text>
      </Pressable>

      <BottomSheet visible={sheet === 'recorrido'} onClose={() => setSheet(null)} title="El recorrido">
        <ScrollView style={{ maxHeight: 360 }}>
          {(draft?.creditIds ?? []).map((creditId, i) => {
            const p = pins.find((x) => x.cliente.creditId === creditId)?.cliente ?? load.sinUbicacion.find((x) => x.creditId === creditId);
            return (
              <ListRow
                key={creditId}
                title={`${i + 1}. ${p?.name ?? 'Cliente'}`}
                subtitle={p?.zone}
                right={
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <Mover label="↑" onPress={() => void commit(moveStop(draft!, creditId, -1))} disabled={i === 0} />
                    <Mover label="↓" onPress={() => void commit(moveStop(draft!, creditId, 1))} disabled={i === draft!.creditIds.length - 1} />
                    <Mover label="✕" onPress={() => void commit(withoutStop(draft!, creditId))} />
                  </View>
                }
              />
            );
          })}
        </ScrollView>
        {/* Terminar de armar lleva a la vista previa (S3): ahí se mide el recorrido y se confirma. */}
        <Button
          label="Ver el recorrido en el mapa"
          disabled={!draft?.routeId}
          onPress={() => {
            setSheet(null);
            router.push(`/rutas/preview?routeId=${draft!.routeId}`);
          }}
        />
      </BottomSheet>

      <BottomSheet visible={sheet === 'sin-ubicacion'} onClose={() => setSheet(null)} title="Sin ubicación cargada">
        <Text style={[TYPE.secondary, { marginBottom: SPACING.md }]}>
          Estos clientes no se pueden pintar en el mapa. Tocá uno para marcarle el punto en su
          ubicación y aparece acá.
        </Text>
        <ScrollView style={{ maxHeight: 320 }}>
          {load.sinUbicacion.map((p) => (
            <ListRow
              key={p.clientId}
              title={p.name}
              subtitle={p.secondaryLine || undefined}
              onPress={() => {
                setSheet(null);
                router.push(`/cliente/editar?clientId=${p.clientId}`);
              }}
            />
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

/** Botoncito cuadrado de la fila del recorrido (subir/bajar/quitar). */
function Mover({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      style={[styles.mover, disabled && { opacity: 0.3 }]}
    >
      <Text style={styles.moverText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  days: { flexGrow: 0, backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  daysContent: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  dayChip: {
    minWidth: 64,
    height: 56,
    borderRadius: RADIUS.card,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipActive: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  dayLabel: { fontSize: 12, color: COLORS.text2, fontWeight: '600' },
  dayNumber: { fontSize: 17, color: COLORS.navy, fontWeight: '700' },
  dayLabelActive: { color: COLORS.white },
  dayDot: { position: 'absolute', top: 6, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.periwinkle },
  aviso2: { ...TYPE.secondary, backgroundColor: COLORS.highlight, color: COLORS.navy, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  aviso: { backgroundColor: COLORS.warningBg, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg },
  avisoText: { ...TYPE.secondary, color: COLORS.warningText },
  error: { ...TYPE.secondary, color: COLORS.danger, textAlign: 'center', paddingVertical: SPACING.sm },
  card: {
    flexDirection: 'row',
    gap: SPACING.md,
    backgroundColor: COLORS.white,
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  nombre: { fontSize: 17, fontWeight: '600', color: COLORS.navy },
  lugar: { ...TYPE.secondary, color: COLORS.purple, fontWeight: '600' },
  monto: { fontSize: 17, fontWeight: '700', color: COLORS.navy },
  barra: { backgroundColor: COLORS.navy, padding: SPACING.lg, alignItems: 'center' },
  barraVacia: { backgroundColor: COLORS.slate },
  barraText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  mover: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.button,
    backgroundColor: COLORS.lightBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moverText: { fontSize: 16, color: COLORS.navy, fontWeight: '700' },
});
