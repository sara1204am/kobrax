import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ROUTE_REASON_MAX, RouteStatus, isValidReason } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, ProgressBar, SectionLabel } from '@/ui';
import { Button } from '@/components';
import { formatLongDate, money } from '@/agenda-form';
import { listPaymentsByDay, type PaymentItem } from '@/payments.service';
import { getRoute, updateRouteStatus, type RouteItem } from '@/routes.service';
import { CATEGORY_LABEL, CATEGORY_TONE, summarizeDay } from '@/route-summary';
import { queueForLater } from '@/sync/sync.service';

/**
 * RT-7 · Resumen de la jornada (Rutas S6). Cierra el día: cuánto recaudó, cuántas paradas completó y
 * cómo terminó cada una.
 *
 * **Los números se calculan acá, no en el server** (`ui-screen-map §8.1`): son contadores intradía de
 * lo que el cobrador acaba de hacer, y hasta que sincronice el dispositivo tiene el dato más fresco.
 */
export default function ResumenJornadaScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const [route, setRoute] = useState<RouteItem | null>(null);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cerrar con paradas sin registrar pide un motivo (D-5): se escribe acá antes de cerrar. */
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const fetchAll = useCallback(async () => {
    const res = await getRoute(routeId);
    if (res.status !== 'ok') {
      return setError(res.status === 'offline' ? 'Sin conexión.' : 'No se pudo cargar la jornada.');
    }
    setError(null);
    setRoute(res.data);
    // El recaudado necesita red; el resto del resumen se pinta igual sin él.
    const day = String(res.data.plannedDate).slice(0, 10);
    const pays = await listPaymentsByDay(day);
    if (pays.status === 'ok') setPayments(pays.data);
  }, [routeId]);

  useFocusEffect(
    useCallback(() => {
      void fetchAll();
    }, [fetchAll]),
  );

  const close = useCallback(
    async (why?: string) => {
      setBusy(true);
      setError(null);
      const motivo = why?.trim();
      const res = await updateRouteStatus(routeId, RouteStatus.COMPLETED, motivo);
      // Sin red —o con la sesión vencida— la jornada se cierra igual **y el cierre sube solo, con su motivo**.
      // Antes, con sesión vencida, caía derecho al `replace` y el cierre se perdía en silencio.
      if (res.status === 'offline' || res.status === 'unauthenticated') {
        const guardado = await queueForLater({
          kind: 'route.status',
          routeId,
          status: RouteStatus.COMPLETED,
          ...(motivo ? { reason: motivo } : {}),
        });
        if (!guardado) {
          setBusy(false);
          return setError('No se pudo guardar el cierre en el teléfono. Reintentá cuando tengas señal.');
        }
      }
      setBusy(false);
      if (res.status === 'error') return setError(res.message);
      router.replace('/(tabs)/rutas');
    },
    [routeId],
  );

  const onClose = useCallback(() => {
    if (!route) return;
    const { done, total } = summarizeDay(route, payments);
    const pendientes = total - done;
    if (pendientes === 0) return void close();
    // D2: se permite cerrar con paradas sin hacer — bloquearlo empujaría a marcar visitas falsas — pero se pide el motivo
    // (D-5): queda en la bitácora de la ruta y esas paradas pasan a «saltadas».
    setAsking(true);
  }, [route, payments, close]);

  if (!route) {
    return (
      <View style={styles.screen}>
        <Header title="Resumen de Jornada" onBack={() => router.back()} />
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

  const s = summarizeDay(route, payments);
  const cerrada = route.status === RouteStatus.COMPLETED || route.status === RouteStatus.CANCELLED;

  return (
    <View style={styles.screen}>
      <Header title="Resumen de Jornada" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>TOTAL RECAUDADO HOY</Text>
          <Text style={styles.heroValue}>{money(s.collected, s.currency)}</Text>
          <View style={styles.heroRow}>
            <Text style={TYPE.secondary}>Progreso de visitas</Text>
            <Text style={styles.heroProgress}>{`${s.done} de ${s.total} completadas`}</Text>
          </View>
          <ProgressBar percent={s.percent} />
          <Text style={TYPE.caption}>{formatLongDate(String(route.plannedDate).slice(0, 10))}</Text>
        </View>

        {s.categories.length > 0 ? (
          <>
            <SectionLabel>RESULTADOS POR CATEGORÍA</SectionLabel>
            <View style={styles.grid}>
              {s.categories.map((c) => (
                <View key={c.key} style={styles.catCard}>
                  <View style={styles.catHead}>
                    <View style={[styles.dot, { backgroundColor: TONE_COLOR[CATEGORY_TONE[c.key]] }]} />
                    <Text style={styles.catCount}>{c.count}</Text>
                  </View>
                  <Text style={TYPE.secondary}>{CATEGORY_LABEL[c.key]}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <EmptyState icon="📋" title="Todavía no registraste ninguna parada" hint="Los resultados aparecen a medida que cerrás cada visita." />
        )}

        <SectionLabel>PRÓXIMAS ACCIONES</SectionLabel>
        {/* Antes era un botón muerto que pintaba "llega en su propia etapa (P6)" como si fuera un
            error: jerga interna, en rojo, en la pantalla de cierre del día. La sincronización ya
            existe y su lugar es la lista de pendientes. */}
        <ListRow
          title="Ver lo que falta subir"
          subtitle="Lo que registraste sin señal y todavía no llegó a oficina"
          icon="cloud-upload-outline"
          onPress={() => router.push('/pendientes')}
        />
        <ListRow
          title="Revisar ruta de mañana"
          subtitle="Planificá tu jornada anticipadamente"
          onPress={() => router.replace('/(tabs)/rutas')}
        />

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        {cerrada ? (
          <Text style={[TYPE.secondary, { textAlign: 'center' }]}>Esta jornada ya está cerrada.</Text>
        ) : asking ? (
          <View style={{ gap: SPACING.sm }}>
            <Text style={styles.askTitle}>
              {`Quedan ${s.total - s.done} ${s.total - s.done === 1 ? 'parada sin registrar' : 'paradas sin registrar'}`}
            </Text>
            <Text style={TYPE.secondary}>Contá por qué se cierran así. Esas paradas quedan como saltadas.</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Ej.: lluvia fuerte, no llegué a la zona"
              placeholderTextColor={COLORS.muted}
              multiline
              maxLength={ROUTE_REASON_MAX}
              style={styles.reason}
              accessibilityLabel="Motivo del cierre"
            />
            <Button label="Cerrar jornada" onPress={() => void close(reason)} loading={busy} disabled={busy || !isValidReason(reason)} />
            <Button label="Volver" variant="ghost" onPress={() => setAsking(false)} disabled={busy} />
          </View>
        ) : (
          <Button label="Finalizar y Cerrar Jornada  →" onPress={onClose} loading={busy} disabled={busy} />
        )}
      </View>
    </View>
  );
}

const TONE_COLOR = {
  success: COLORS.success,
  warning: COLORS.warning,
  danger: COLORS.danger,
  neutral: COLORS.text2,
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl },
  hero: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    gap: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  heroLabel: { ...TYPE.caption, letterSpacing: 0.5 },
  heroValue: { fontSize: 30, fontWeight: '700', color: COLORS.navy },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.sm },
  heroProgress: { ...TYPE.body, fontWeight: '700', color: COLORS.navy },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  catCard: {
    width: '48%',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    gap: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  catHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  catCount: { fontSize: 22, fontWeight: '700', color: COLORS.navy },
  error: { ...TYPE.secondary, color: COLORS.danger, textAlign: 'center' },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  askTitle: { ...TYPE.body, fontWeight: '700', color: COLORS.navy },
  reason: {
    minHeight: 76,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.input,
    padding: SPACING.md,
    textAlignVertical: 'top',
    color: COLORS.text,
    fontSize: 15,
  },
});
