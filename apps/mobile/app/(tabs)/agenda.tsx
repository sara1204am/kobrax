import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { CaseStatus, formatCurrency, SUPPORTED_CURRENCIES, type CurrencyCode } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { CaseCard, CASE_PRIORITY_LABEL, EmptyState, SectionLabel, SegmentTabs } from '@/ui';
import { authService } from '@/auth-service';
import { listCases, type CaseListItem, type ListCasesParams } from '@/cases.service';

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error'; message: string }
  | { status: 'ok'; cases: CaseListItem[] };

/** Segmentos de la Agenda (Figma 81:4): Vencidas · Pendientes · Completadas. */
interface Segment {
  key: string;
  label: string;
  tone?: 'neutral' | 'danger';
  params: Partial<ListCasesParams>;
}
const SEGMENTS: Segment[] = [
  { key: 'overdue', label: 'Vencidas', tone: 'danger', params: { overdue: true } },
  { key: 'pending', label: 'Pendientes', params: { open: true } },
  { key: 'done', label: 'Completadas', params: { status: CaseStatus.PAID } },
];

/** Formatea el monto con la moneda del crédito; si no es una moneda soportada, número plano. */
function formatMoney(amount?: number, currency?: string): string | undefined {
  if (amount == null) return undefined;
  if (currency && currency in SUPPORTED_CURRENCIES) return formatCurrency(amount, currency as CurrencyCode);
  return amount.toLocaleString();
}

/** Línea secundaria de la tarjeta: prioridad + días de mora (mora del server, no del reloj). */
function caseSubtitle(c: CaseListItem): string {
  const parts = [CASE_PRIORITY_LABEL[c.priority]];
  if (c.isOverdue) parts.push(`${c.daysPastDue ?? 0} días de mora`);
  return parts.join(' · ');
}

const WEEKDAYS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Lunes de la semana que contiene `d` (00:00). */
function startOfWeek(d: Date): Date {
  const s = new Date(d);
  const dow = (s.getDay() + 6) % 7; // 0 = lunes
  s.setDate(s.getDate() - dow);
  s.setHours(0, 0, 0, 0);
  return s;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Selector de día de la semana (Figma 81:4), en el header navy. El día activo se marca en
 * púrpura. // ponytail: navega visualmente; filtrar la agenda por día necesita fecha
 * agendada en el backend (route stops / visitas = P3) → hoy la lista no cambia por día.
 */
function WeekStrip({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const week = useMemo(() => {
    const base = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  }, []);
  return (
    <View style={styles.weekRow}>
      {week.map((d, i) => {
        const active = sameDay(d, selected);
        return (
          <Pressable
            key={d.toISOString()}
            onPress={() => onSelect(d)}
            style={styles.dayCell}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={styles.dayName}>{WEEKDAYS[i]}</Text>
            <View style={[styles.dayNum, active && styles.dayNumActive]}>
              <Text style={[styles.dayNumText, active && styles.dayNumTextActive]}>{d.getDate()}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Agenda Diaria (Figma `81:4`): segmentos con contador + tarjetas de caso agrupadas. Solo lectura. */
export default function AgendaScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [segment, setSegment] = useState('pending');
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [counts, setCounts] = useState<Record<string, number | undefined>>({});
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const reqRef = useRef(0);

  // La identidad se resuelve UNA vez: la sesión no cambia durante la vida de la pantalla.
  useEffect(() => {
    void (async () => {
      const me = await authService.me();
      if (me.status === 'offline') return setLoad({ status: 'offline' });
      if (me.status !== 'ok') return router.replace('/(auth)/login');
      setUserId(me.me.userId);
    })();
  }, []);

  const fetchAll = useCallback(async (uid: string, segKey: string) => {
    const reqId = ++reqRef.current;
    const seg = SEGMENTS.find((s) => s.key === segKey) ?? SEGMENTS[0]!;
    const [listRes, ...countRes] = await Promise.all([
      listCases({ assigneeId: uid, ...seg.params, limit: 100 }),
      ...SEGMENTS.map((s) => listCases({ assigneeId: uid, ...s.params, limit: 1 })),
    ]);
    if (reqId !== reqRef.current) return; // respuesta vieja (cambió el segmento) → descartar

    const nextCounts: Record<string, number | undefined> = {};
    SEGMENTS.forEach((s, i) => {
      const r = countRes[i]!;
      nextCounts[s.key] = r.status === 'ok' ? r.total : undefined;
    });
    setCounts(nextCounts);

    if (listRes.status === 'offline') return setLoad({ status: 'offline' });
    if (listRes.status === 'unauthenticated') return router.replace('/(auth)/login');
    if (listRes.status === 'error') return setLoad({ status: 'error', message: listRes.message });
    setLoad({ status: 'ok', cases: listRes.data });
  }, []);

  useEffect(() => {
    if (userId) void fetchAll(userId, segment);
  }, [userId, segment, fetchAll]);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await fetchAll(userId, segment);
    setRefreshing(false);
  }, [userId, segment, fetchAll]);

  const activeSeg = SEGMENTS.find((s) => s.key === segment)!;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerBar}>
          <Text style={styles.headerTitle}>Agenda</Text>
          <Text style={styles.headerDate}>
            {selectedDay.getDate()} {MONTHS[selectedDay.getMonth()]}
          </Text>
        </View>
        <WeekStrip selected={selectedDay} onSelect={setSelectedDay} />
      </SafeAreaView>

      <View style={{ padding: SPACING.lg, paddingBottom: SPACING.sm }}>
        <SegmentTabs
          value={segment}
          onChange={setSegment}
          items={SEGMENTS.map((s) => ({
            key: s.key,
            label: s.label,
            tone: s.tone,
            count: counts[s.key] ?? '—',
          }))}
        />
      </View>

      <View style={{ flex: 1 }}>
        <AgendaBody load={load} sectionLabel={activeSeg.label} refreshing={refreshing} onRefresh={onRefresh} />
      </View>

      {/* FAB "Nueva gestión" (Figma) → abre el flujo de alta (pantalla dedicada). */}
      <Pressable
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Nueva gestión"
        onPress={() => router.push('/nueva-gestion')}
      >
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>
    </View>
  );
}

function AgendaBody({
  load,
  sectionLabel,
  refreshing,
  onRefresh,
}: {
  load: Load;
  sectionLabel: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (load.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.navy} />
      </View>
    );
  }
  if (load.status === 'offline') {
    return <EmptyState icon="📴" title="Sin conexión" hint="Tus casos aparecerán cuando vuelva la red." />;
  }
  if (load.status === 'error') {
    return <EmptyState icon="⚠️" title="No se pudo cargar" hint={load.message} />;
  }
  if (load.cases.length === 0) {
    return <EmptyState icon="🗓️" title="Sin casos" hint="No hay casos en esta vista." />;
  }
  return (
    <FlashList
      data={load.cases}
      keyExtractor={(c) => c.id}
      estimatedItemSize={76}
      contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl }}
      ListHeaderComponent={<SectionLabel>{sectionLabel}</SectionLabel>}
      ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
      refreshing={refreshing}
      onRefresh={onRefresh}
      renderItem={({ item }) => (
        <CaseCard
          name={item.clientName ?? `Caso ${item.id.slice(0, 8)}`}
          subtitle={caseSubtitle(item)}
          amount={formatMoney(item.amount, item.currency)}
          status={item.status}
          overdue={item.isOverdue}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: COLORS.navy },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  headerTitle: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  headerDate: { ...TYPE.secondary, color: COLORS.lightBg, textTransform: 'capitalize' },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
  },
  dayCell: { alignItems: 'center', gap: 6, flex: 1 },
  dayName: { fontSize: 11, fontWeight: '600', color: COLORS.periwinkle },
  dayNum: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayNumActive: { backgroundColor: COLORS.purple },
  dayNumText: { fontSize: 15, fontWeight: '600', color: COLORS.white },
  dayNumTextActive: { color: COLORS.white, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: SPACING.lg,
    bottom: SPACING.lg,
    width: 56,
    height: 56,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.navy,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPlus: { color: COLORS.white, fontSize: 30, lineHeight: 32, fontWeight: '400' },
});
