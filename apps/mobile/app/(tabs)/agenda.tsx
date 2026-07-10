import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList, type FlashList as FlashListType } from '@shopify/flash-list';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { AgendaItemStatus } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AgendaCard, AGENDA_STATUS_LABEL, AGENDA_TYPE_META, EmptyState, SectionLabel } from '@/ui';
import { authService } from '@/auth-service';
import { MONTHS, WEEKDAYS_SHORT } from '@/agenda-form';
import { listByDay, listOverdue, type AgendaListItem } from '@/agenda.service';

const RANGE = 180; // días a cada lado de hoy (tira "infinita" práctica; onEndReached bidireccional = futuro)

/** Fecha-calendario en UTC (el backend guarda `scheduledDate` a medianoche UTC). */
function utcToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DayLoad =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; items: AgendaListItem[] };

type Overdue = { items: AgendaListItem[] };

/** Agenda Diaria (Figma `64:4`): tira de calendario + Pendientes / Completados / Vencidos. */
export default function AgendaScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Date>(() => utcToday());
  const [day, setDay] = useState<DayLoad>({ status: 'loading' });
  const [overdue, setOverdue] = useState<Overdue | null>(null);
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const reqRef = useRef(0);
  const stripRef = useRef<FlashListType<Date> | null>(null);

  const today = useMemo(() => utcToday(), []);
  const days = useMemo(() => Array.from({ length: RANGE * 2 + 1 }, (_, i) => addDays(today, i - RANGE)), [today]);

  // Identidad una vez.
  useEffect(() => {
    void (async () => {
      const me = await authService.me();
      if (me.status === 'offline') return setDay({ status: 'offline' });
      if (me.status !== 'ok') return setDay({ status: 'error' });
      setUserId(me.me.userId);
    })();
  }, []);

  const fetchDay = useCallback(async (uid: string, date: Date) => {
    const reqId = ++reqRef.current;
    const res = await listByDay(isoDate(date));
    if (reqId !== reqRef.current) return; // día cambió → descartar
    // Un bache de red en un refresh no debe borrar lo ya cargado (offline-first).
    if (res.status === 'offline') return setDay((prev) => (prev.status === 'ok' ? prev : { status: 'offline' }));
    if (res.status !== 'ok') return setDay((prev) => (prev.status === 'ok' ? prev : { status: 'error' }));
    setDay({ status: 'ok', items: res.data });
  }, []);

  const fetchOverdue = useCallback(async () => {
    const res = await listOverdue(100);
    if (res.status === 'ok') setOverdue({ items: res.data });
  }, []);

  /** Mueve la selección y deja el día centrado en la tira. */
  const centerOn = useCallback(
    (d: Date, animated: boolean) => {
      setSelected(d);
      const idx = days.findIndex((x) => isoDate(x) === isoDate(d));
      if (idx >= 0) stripRef.current?.scrollToIndex({ index: idx, animated, viewPosition: 0.5 });
    },
    [days],
  );

  const selectDate = useCallback(
    (d: Date) => {
      centerOn(d, true);
      if (userId) void fetchDay(userId, d);
    },
    [centerOn, userId, fetchDay],
  );

  /** Volver a hoy: lo usa el botón del header y el foco de la pantalla. */
  const goToday = useCallback(() => selectDate(today), [selectDate, today]);

  // Entrar a la Agenda siempre arranca en hoy, centrado — no donde quedó el scroll de la última vez.
  // También cubre el regreso de "Nueva gestión": el agendado recién creado aparece sin tirar de la lista.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      centerOn(today, false);
      void fetchDay(userId, today);
      void fetchOverdue();
    }, [userId, today, centerOn, fetchDay, fetchOverdue]),
  );

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await Promise.all([fetchDay(userId, selected), fetchOverdue()]);
    setRefreshing(false);
  }, [userId, selected, fetchDay, fetchOverdue]);

  const onPickerChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      setShowPicker(false);
      if (event.type === 'set' && date) {
        selectDate(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
      }
    },
    [selectDate],
  );

  const pending = day.status === 'ok' ? day.items.filter((i) => i.status === AgendaItemStatus.SCHEDULED) : [];
  const done = day.status === 'ok' ? day.items.filter((i) => i.status === AgendaItemStatus.EXECUTED) : [];
  // "Vencidos" es el backlog global, y no depende del día elegido. Al pararse en una fecha pasada, sus
  // pendientes YA aparecen arriba: sin este filtro la misma tarjeta se pinta dos veces.
  const dayIds = new Set(pending.map((i) => i.id));
  const overdueItems = overdue ? overdue.items.filter((i) => !dayIds.has(i.id)) : [];
  const overdueShown = showAllOverdue ? overdueItems : overdueItems.slice(0, 2);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerBar}>
          <Text style={styles.headerTitle}>Agenda</Text>
          {/* Nunca deshabilitado: deslizar la tira NO cambia `selected`, así que aun estando "en hoy"
              el calendario puede estar mostrando otro mes, y este botón es lo que lo trae de vuelta. */}
          <Pressable onPress={goToday} hitSlop={8} accessibilityRole="button" accessibilityLabel="Ir a hoy" style={styles.todayBtn}>
            <Text style={styles.todayText}>Hoy</Text>
          </Pressable>
          <Pressable onPress={() => setShowPicker(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Abrir calendario">
            <Text style={styles.headerDate}>{MONTHS[selected.getUTCMonth()]} {selected.getUTCFullYear()} ▾</Text>
          </Pressable>
        </View>
        <View style={styles.strip}>
          <FlashList
            ref={stripRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            data={days}
            keyExtractor={isoDate}
            estimatedItemSize={48}
            initialScrollIndex={RANGE}
            // `initialScrollIndex` deja hoy pegado al borde izquierdo; recién con la lista medida
            // se puede centrar de verdad (el foco solo no alcanza en el primer render).
            onLoad={() => stripRef.current?.scrollToIndex({ index: RANGE, animated: false, viewPosition: 0.5 })}
            extraData={selected}
            renderItem={({ item }) => {
              const active = isoDate(item) === isoDate(selected);
              const isToday = isoDate(item) === isoDate(today);
              return (
                <Pressable onPress={() => selectDate(item)} style={styles.dayCell} accessibilityRole="button" accessibilityState={{ selected: active }}>
                  <Text style={styles.dayName}>{WEEKDAYS_SHORT[item.getUTCDay()]}</Text>
                  <View style={[styles.dayNum, active && styles.dayNumActive, isToday && !active && styles.dayNumToday]}>
                    <Text style={[styles.dayNumText, active && styles.dayNumTextActive]}>{item.getUTCDate()}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </SafeAreaView>

      {day.status === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : day.status === 'offline' ? (
        <EmptyState icon="📴" title="Sin conexión" hint="Tu agenda aparecerá cuando vuelva la red." />
      ) : day.status === 'error' ? (
        <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
        >
          <SectionLabel>Pendientes</SectionLabel>
          {pending.length === 0 ? (
            <Text style={styles.emptyLine}>Sin pendientes</Text>
          ) : (
            pending.map((it) => <Row key={it.id} item={it} />)
          )}

          {done.length > 0 && (
            <>
              <SectionLabel>Completados</SectionLabel>
              {done.map((it) => <Row key={it.id} item={it} />)}
            </>
          )}

          {overdueItems.length > 0 && (
            <>
              <SectionLabel>Vencidos</SectionLabel>
              {overdueShown.map((it) => <Row key={it.id} item={it} />)}
              {/* Contar sobre lo CARGADO, no sobre `meta.total`: la lista viene capada en 100, así que
                  `total` prometía filas que "Ver más" no podía mostrar.
                  ponytail: 100 vencidos alcanzan para un cobrador; si un tenant los supera, paginar acá. */}
              {overdueItems.length > 2 && (
                <Pressable onPress={() => setShowAllOverdue((v) => !v)} style={styles.moreBtn} accessibilityRole="button">
                  <Text style={styles.moreText}>{showAllOverdue ? 'Ver menos' : `Ver más (${overdueItems.length - 2})`}</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      )}

      <Pressable
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Nueva gestión"
        onPress={() => router.push('/agenda/crear')}
      >
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>

      {showPicker && (
        <DateTimePicker
          value={new Date(selected.getUTCFullYear(), selected.getUTCMonth(), selected.getUTCDate())}
          mode="date"
          onChange={onPickerChange}
        />
      )}
    </View>
  );
}

/** Mapea un agendado a la tarjeta; tocarla abre el detalle (S3). */
function Row({ item }: { item: AgendaListItem }) {
  const meta = AGENDA_TYPE_META[item.type];
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <AgendaCard
        name={item.clientName ?? 'Sin nombre'}
        icon={meta.icon}
        typeLabel={meta.label}
        time={item.scheduledTime}
        statusLabel={AGENDA_STATUS_LABEL[item.status]}
        tone={meta.tone}
        overdue={item.isOverdue}
        onPress={() => router.push(`/agenda/${item.id}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: COLORS.navy },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  headerTitle: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  headerDate: { ...TYPE.secondary, color: COLORS.lightBg, textTransform: 'capitalize', fontWeight: '600' },
  todayBtn: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.periwinkle,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
  },
  todayText: { ...TYPE.caption, color: COLORS.white, fontWeight: '700' },
  strip: { paddingVertical: SPACING.md, height: 78 },
  dayCell: { alignItems: 'center', gap: 6, width: 46 },
  dayName: { fontSize: 11, fontWeight: '600', color: COLORS.periwinkle },
  dayNum: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayNumActive: { backgroundColor: COLORS.purple },
  dayNumToday: { borderWidth: 1.5, borderColor: COLORS.periwinkle },
  dayNumText: { fontSize: 15, fontWeight: '600', color: COLORS.white },
  dayNumTextActive: { color: COLORS.white, fontWeight: '700' },
  emptyLine: { ...TYPE.secondary, color: COLORS.muted, paddingVertical: SPACING.md },
  moreBtn: { alignSelf: 'flex-start', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md },
  moreText: { ...TYPE.secondary, color: COLORS.purple, fontWeight: '700' },
  fab: {
    position: 'absolute', right: SPACING.lg, bottom: SPACING.lg, width: 56, height: 56, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.purple, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.navy, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabPlus: { color: COLORS.white, fontSize: 30, lineHeight: 32, fontWeight: '400' },
});
