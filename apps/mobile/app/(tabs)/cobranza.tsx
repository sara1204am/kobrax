import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { CaseCard, EmptyState, PORTFOLIO_STATUS_META, SegmentTabs } from '@/ui';
import { money } from '@/agenda-form';
import { listCases } from '@/cases.service';
import { filterPortfolio, groupPortfolio, type ClientPortfolio, type PortfolioChip } from '@/portfolio';

const CHIPS: { key: PortfolioChip; label: string; danger?: boolean }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'today', label: 'Hoy' },
  { key: 'overdue', label: 'En mora', danger: true },
  { key: 'current', label: 'Al día' },
  { key: 'paid', label: 'Pagados' },
];

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; cards: ClientPortfolio[] };

/**
 * Cartera (V3, §5.3): lista centrada en el cliente con la deuda agregada. Buscador local (nombre +
 * documento) + chips de filtro. Los datos salen de `GET /cases?view=portfolio` (ya scoped al cobrador);
 * agrupar/estado/orden/buscar es lógica pura de `src/portfolio.ts`. Reemplaza el placeholder del Slice 0.
 */
export default function CobranzaScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [chip, setChip] = useState<PortfolioChip>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const reqRef = useRef(0);

  const fetchCartera = useCallback(async () => {
    const reqId = ++reqRef.current;
    // La cartera de un cobrador cabe en memoria (§5.3): una página amplia, sin paginar en el móvil.
    const res = await listCases({ view: 'portfolio', limit: 100 });
    if (reqId !== reqRef.current) return;
    // Un bache de red en un refresh no borra lo ya cargado (offline-first).
    if (res.status === 'offline') return setLoad((prev) => (prev.status === 'ok' ? prev : { status: 'offline' }));
    if (res.status !== 'ok') return setLoad((prev) => (prev.status === 'ok' ? prev : { status: 'error' }));
    setLoad({ status: 'ok', cards: groupPortfolio(res.data) });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchCartera();
    }, [fetchCartera]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchCartera();
    setRefreshing(false);
  }, [fetchCartera]);

  const cards = load.status === 'ok' ? load.cards : [];
  const chipItems = useMemo(
    () =>
      CHIPS.map((c) => ({
        key: c.key,
        label: c.label,
        count: filterPortfolio(cards, c.key, query).length,
        tone: c.danger ? ('danger' as const) : ('neutral' as const),
      })),
    [cards, query],
  );
  const visible = useMemo(() => filterPortfolio(cards, chip, query), [cards, chip, query]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.headerTitle}>Cartera</Text>
        <TextInput
          style={styles.search}
          placeholder="Buscar por nombre o documento"
          placeholderTextColor={COLORS.muted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Buscar en la cartera"
        />
      </SafeAreaView>

      {load.status === 'ok' && (
        <View style={styles.chips}>
          <SegmentTabs items={chipItems} value={chip} onChange={(k) => setChip(k as PortfolioChip)} />
        </View>
      )}

      {load.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : load.status === 'offline' ? (
        <EmptyState icon="📴" title="Sin conexión" hint="Tu cartera aparecerá cuando vuelva la red." />
      ) : load.status === 'error' ? (
        <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={query || chip !== 'all' ? 'Sin resultados' : 'Cartera vacía'}
          hint={query || chip !== 'all' ? 'Probá con otro filtro o búsqueda.' : 'Cuando des de alta un cliente, aparecerá acá.'}
        />
      ) : (
        <FlashList
          data={visible}
          keyExtractor={(c) => c.clientId}
          estimatedItemSize={92}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
          renderItem={({ item }) => <Card card={item} />}
        />
      )}

      <Pressable
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Nuevo cliente"
        onPress={() => router.push('/cliente/nuevo')}
      >
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>
    </View>
  );
}

/** Tarjeta de cliente (§5.3): nombre + zona, deuda agregada (roja si mora), línea secundaria y badge. */
function Card({ card }: { card: ClientPortfolio }) {
  const meta = PORTFOLIO_STATUS_META[card.status];
  const caption = [card.zone, card.creditCount > 1 ? `${card.creditCount} préstamos` : undefined]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <CaseCard
        name={card.name}
        caption={caption || undefined}
        subtitle={card.secondaryLine || undefined}
        amount={money(card.totalDebt, card.currency)}
        amountDanger={card.maxDaysPastDue > 0}
        badge={meta}
        onPress={() => router.push(`/cliente/${card.clientId}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: COLORS.navy, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.md },
  headerTitle: { color: COLORS.white, fontSize: 20, fontWeight: '700', paddingTop: SPACING.md },
  search: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.input,
    paddingHorizontal: SPACING.md,
    height: 44,
    ...TYPE.body,
    color: COLORS.text,
  },
  chips: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute', right: SPACING.lg, bottom: SPACING.lg, width: 56, height: 56, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.purple, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.navy, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabPlus: { color: COLORS.white, fontSize: 30, lineHeight: 32, fontWeight: '400' },
});
