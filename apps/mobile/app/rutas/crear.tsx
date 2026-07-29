import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { BottomSheet, EmptyState, Header, ListRow, PORTFOLIO_STATUS_META, StatusBadge } from '@/ui';
import { Button } from '@/components';
import { MapCanvas, type MapMarker } from '@/maps/MapCanvas';
import { money, todayISO } from '@/agenda-form';
import { listCases } from '@/cases.service';
import { groupPortfolio, type ClientPortfolio } from '@/portfolio';
import { createRoute } from '@/routes.service';
import { flushDraft, loadDraft, moveStop, saveDraft, withoutStop, withStop, type RouteDraft } from '@/route-draft';
import { authService } from '@/auth-service';
import { useNetStore } from '@/store/net';

/** Cliente de la cartera + el caso con el que entra a la ruta (una parada = un caso). */
interface Punto extends ClientPortfolio {
  caseId: string;
}

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; puntos: Punto[]; sinUbicacion: Punto[] };

/**
 * RT-1 · Armar la ruta desde el mapa (S2). La cartera del cobrador se pinta sobre el mapa y cada
 * toque agrega o saca una parada. **Nada se escribe directo en el server**: todo pasa por el borrador
 * local (`route-draft`), que se sincroniza al toque si hay red y al reconectar si no la había. Por eso
 * la pantalla funciona igual en modo avión.
 */
export default function CrearRutaScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // clientId
  const [sheet, setSheet] = useState<'recorrido' | 'sin-ubicacion' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useNetStore((s) => s.isConnected);

  const fetchCartera = useCallback(async () => {
    const me = await authService.me();
    if (me.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (me.status !== 'ok') return router.replace('/(auth)/login');

    setDraft(await loadDraft(todayISO()));

    // La cartera del cobrador ya viene acotada a él y con el punto de cada cliente (§5.1).
    const res = await listCases({ view: 'portfolio', limit: 100 });
    if (res.status === 'offline') return setLoad((p) => (p.status === 'ok' ? p : { status: 'offline' }));
    if (res.status !== 'ok') return setLoad((p) => (p.status === 'ok' ? p : { status: 'error' }));

    // Un cliente puede tener varios créditos; la parada se arma con el primero (el más urgente,
    // que es como `groupPortfolio` ya los ordena).
    const caseByClient = new Map<string, string>();
    for (const c of res.data) if (!caseByClient.has(c.clientId)) caseByClient.set(c.clientId, c.id);
    const todos: Punto[] = groupPortfolio(res.data).map((c) => ({ ...c, caseId: caseByClient.get(c.clientId)! }));

    setLoad({
      status: 'ok',
      puntos: todos.filter((c) => c.latitude != null && c.longitude != null),
      sinUbicacion: todos.filter((c) => c.latitude == null || c.longitude == null),
    });
  }, []);

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
      const res = await flushDraft(next, () => createRoute({ collectorId: me.me.userId, plannedDate: todayISO() }));
      if (res.status === 'ok') {
        setDraft(res.draft);
        setPending(false);
      } else {
        setPending(true);
        if (res.status === 'error') setError(res.message);
      }
    },
    [online],
  );

  const enRuta = useMemo(() => new Set(draft?.caseIds ?? []), [draft]);
  const puntos = load.status === 'ok' ? load.puntos : [];
  const elegido = puntos.find((p) => p.clientId === selected);

  const markers: MapMarker[] = puntos.map((p) => ({
    id: p.clientId,
    latitude: p.latitude!,
    longitude: p.longitude!,
    label: enRuta.has(p.caseId) ? String(draft!.caseIds.indexOf(p.caseId) + 1) : undefined,
    tone: enRuta.has(p.caseId) ? 'active' : p.maxDaysPastDue > 0 ? 'done' : 'default',
    selected: p.clientId === selected,
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

  const total = draft?.caseIds.length ?? 0;

  return (
    <View style={styles.screen}>
      <Header
        title="Crear ruta"
        onBack={() => router.back()}
        right={pending ? <StatusBadge label="Sin sincronizar" tone="warning" /> : undefined}
      />

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
              {elegido.name}
            </Text>
            <Text style={TYPE.secondary} numberOfLines={1}>
              {[elegido.zone, elegido.secondaryLine].filter(Boolean).join(' · ')}
            </Text>
            <Text style={[styles.monto, elegido.maxDaysPastDue > 0 && { color: COLORS.danger }]}>
              {money(elegido.totalDebt, elegido.currency)}
            </Text>
          </View>
          <View style={{ gap: SPACING.sm, alignItems: 'flex-end' }}>
            <StatusBadge {...PORTFOLIO_STATUS_META[elegido.status]} />
            {enRuta.has(elegido.caseId) ? (
              <Button label="Quitar" variant="ghost" onPress={() => void commit(withoutStop(draft!, elegido.caseId))} />
            ) : (
              <Button
                label="Agregar al recorrido"
                onPress={() => void commit(withStop(draft ?? { routeId: null, date: todayISO(), caseIds: [], clientByCase: {} }, elegido.caseId, elegido.clientId))}
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
          {(draft?.caseIds ?? []).map((caseId, i) => {
            const p = puntos.find((x) => x.caseId === caseId);
            return (
              <ListRow
                key={caseId}
                title={`${i + 1}. ${p?.name ?? 'Cliente'}`}
                subtitle={p?.zone}
                right={
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <Mover label="↑" onPress={() => void commit(moveStop(draft!, caseId, -1))} disabled={i === 0} />
                    <Mover label="↓" onPress={() => void commit(moveStop(draft!, caseId, 1))} disabled={i === draft!.caseIds.length - 1} />
                    <Mover label="✕" onPress={() => void commit(withoutStop(draft!, caseId))} />
                  </View>
                }
              />
            );
          })}
        </ScrollView>
        <Button label="Listo" onPress={() => { setSheet(null); router.back(); }} />
      </BottomSheet>

      <BottomSheet visible={sheet === 'sin-ubicacion'} onClose={() => setSheet(null)} title="Sin ubicación cargada">
        <Text style={[TYPE.secondary, { marginBottom: SPACING.md }]}>
          Estos clientes no se pueden pintar en el mapa. Tocá uno para cargarle el punto y aparece acá.
        </Text>
        <ScrollView style={{ maxHeight: 320 }}>
          {load.sinUbicacion.map((p) => (
            <ListRow
              key={p.clientId}
              title={p.name}
              subtitle={p.secondaryLine || undefined}
              onPress={() => {
                setSheet(null);
                router.push(`/cliente/ubicacion?clientId=${p.clientId}&name=${encodeURIComponent(p.name)}`);
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
