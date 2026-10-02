import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { BottomSheet, CaseCard, Chips, EmptyState, ListRow, PORTFOLIO_STATUS_META, SectionLabel, SegmentTabs, TONE_SOLID } from '@/ui';
import { money } from '@/agenda-form';
import { listCases } from '@/cases.service';
import { listMora, MORA_LIMIT } from '@/mora.service';
import { filterMora, MORA_CHIP_LABEL, moraCardProps, staleLine, type MoraChip, type MoraRow } from '@/mora';
import {
  filterPortfolio,
  groupPortfolio,
  PORTFOLIO_SORT_LABEL,
  sortPortfolio,
  type ClientPortfolio,
  type PortfolioChip,
  type PortfolioSort,
} from '@/portfolio';
import { clientDisplayName, type ClientHit } from '@/clients.service';
import { useClientSearch } from '@/use-client-search';

const SORTS = (Object.keys(PORTFOLIO_SORT_LABEL) as PortfolioSort[]).map((value) => ({
  value,
  label: PORTFOLIO_SORT_LABEL[value],
}));

const CHIPS: { key: PortfolioChip; label: string; danger?: boolean }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'today', label: 'Hoy' },
  { key: 'overdue', label: 'En mora', danger: true },
  { key: 'current', label: 'Al día' },
  { key: 'paid', label: 'Pagados' },
];

// Preferencia de densidad (tarjetas ↔ lista), en SecureStore como los flags de import/biometría:
// cero deps nuevas. ponytail: clave global, no por usuario — es una preferencia visual, no un dato.
const VIEW_KEY = 'cartera.compact';

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; cards: ClientPortfolio[] };

/** La lista de «En mora» viene de `GET /mora` (por crédito), no de la cartera (por cliente). */
type MoraLoad =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; rows: MoraRow[]; localAt?: number | null };

const MORA_CHIPS = Object.keys(MORA_CHIP_LABEL) as MoraChip[];

/**
 * Cartera (V3, §5.3): lista centrada en el cliente con la deuda agregada. Buscador (nombre + documento +
 * zona) + chips de filtro + orden elegible. Los datos salen de `GET /cases?view=portfolio` (ya scoped al
 * cobrador); agrupar/estado/orden/buscar es lógica pura de `src/portfolio.ts`.
 *
 * **La búsqueda es global (S4)**: además de filtrar lo cargado, consulta `GET /clients?q=`. Sin eso, un
 * cliente sin préstamo —o más allá de la página de casos— no existe en ninguna pantalla de la app.
 */
export default function CobranzaScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [moraLoad, setMoraLoad] = useState<MoraLoad>({ status: 'loading' });
  const [moraChip, setMoraChip] = useState<MoraChip>('all');
  const [chip, setChip] = useState<PortfolioChip>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PortfolioSort>('mora');
  const [sortSheet, setSortSheet] = useState(false);
  const [compact, setCompact] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const reqRef = useRef(0);

  const fetchCartera = useCallback(async () => {
    const reqId = ++reqRef.current;
    // La cartera de un cobrador cabe en memoria (§5.3): una página amplia, sin paginar en el móvil.
    // 🔴 `open: true` no es opcional: sin él entran los casos CERRADOS. Mientras nada los cerraba
    // daba igual; ahora el trabajo diario cierra al que pagó, y esta lista lo seguiría mostrando
    // para cobrar. Lo mismo en `rutas/crear` y en el hidratado offline.
    // La mora se pide a la par pero **por su cuenta**: si una falla, la otra lista igual se muestra.
    const [res, moraRes] = await Promise.all([
      listCases({ view: 'portfolio', open: true, limit: 100 }),
      listMora({ limit: MORA_LIMIT }), // misma llamada que `hydrate`
    ]);
    if (reqId !== reqRef.current) return;
    if (moraRes.status === 'ok') setMoraLoad({ status: 'ok', rows: moraRes.data, localAt: moraRes.localAt });
    else
      setMoraLoad((prev) => (prev.status === 'ok' ? prev : { status: moraRes.status === 'offline' ? 'offline' : 'error' }));
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

  useEffect(() => {
    void SecureStore.getItemAsync(VIEW_KEY).then((v) => setCompact(v === '1'));
  }, []);

  function toggleView() {
    const next = !compact;
    setCompact(next);
    void SecureStore.setItemAsync(VIEW_KEY, next ? '1' : '0');
  }

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
        // «En mora» cuenta CRÉDITOS (de `GET /mora`), no clientes: es lo que la lista de ese chip muestra.
        count:
          c.key === 'overdue' && moraLoad.status === 'ok'
            ? filterMora(moraLoad.rows, 'all', query).length
            : filterPortfolio(cards, c.key, query).length,
        tone: c.danger ? ('danger' as const) : ('neutral' as const),
      })),
    [cards, query, moraLoad],
  );
  const visible = useMemo(() => sortPortfolio(filterPortfolio(cards, chip, query), sort), [cards, chip, query, sort]);

  // Búsqueda global: los clientes del tenant que NO están en la cartera cargada (sin préstamo, de otro
  // cobrador, o más allá de la página). El hook trae el debounce; acá sólo se descarta lo repetido.
  const remoteHits = useClientSearch(query);
  const others = useMemo(() => {
    const known = new Set(cards.map((c) => c.clientId));
    return remoteHits.filter((h) => !known.has(h.id));
  }, [remoteHits, cards]);

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
          {/* En mora el orden es fijo (prioridad → días) y no hay tarjeta compacta: no hay nada que elegir. */}
          {chip !== 'overdue' && (
          <View style={styles.tools}>
            <Pressable
              style={styles.sortPill}
              onPress={toggleView}
              accessibilityRole="button"
              accessibilityLabel={compact ? 'Ver en tarjetas' : 'Ver en lista compacta'}
            >
              <Ionicons name={compact ? 'grid-outline' : 'list-outline'} size={16} color={COLORS.navy} />
            </Pressable>
            <Pressable
              style={styles.sortPill}
              onPress={() => setSortSheet(true)}
              accessibilityRole="button"
              accessibilityLabel={`Ordenar por ${PORTFOLIO_SORT_LABEL[sort]}`}
            >
              <Text style={styles.sortText}>⇅ {PORTFOLIO_SORT_LABEL[sort]}</Text>
            </Pressable>
          </View>
          )}
        </View>
      )}

      {chip === 'overdue' ? (
        <MoraList load={moraLoad} chip={moraChip} onChip={setMoraChip} query={query} refreshing={refreshing} onRefresh={onRefresh} />
      ) : load.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : load.status === 'offline' ? (
        <EmptyState icon="📴" title="Sin conexión" hint="Tu cartera aparecerá cuando vuelva la red." />
      ) : load.status === 'error' ? (
        <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />
      ) : visible.length === 0 && others.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={query || chip !== 'all' ? 'Sin resultados' : 'Cartera vacía'}
          hint={query || chip !== 'all' ? 'Probá con otro filtro o búsqueda.' : 'Cuando des de alta un cliente, aparecerá acá.'}
        />
      ) : (
        <FlashList
          // FlashList recicla las celdas y cachea el alto: al cambiar de densidad no basta con que
          // `renderItem` devuelva otro componente — hay que remontar la lista.
          key={compact ? 'compact' : 'cards'}
          data={visible}
          keyExtractor={(c) => c.clientId}
          estimatedItemSize={compact ? 48 : 92}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
          renderItem={({ item }) => (compact ? <CompactRow card={item} /> : <Card card={item} />)}
          ListFooterComponent={others.length > 0 ? <Others hits={others} /> : null}
        />
      )}

      <BottomSheet visible={sortSheet} onClose={() => setSortSheet(false)} title="Ordenar por">
        <Chips
          options={SORTS}
          value={sort}
          onChange={(v) => {
            setSort(v);
            setSortSheet(false);
          }}
        />
      </BottomSheet>

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

/**
 * «En mora»: **un crédito por fila**, con y sin caso (`GET /mora`). Orden fijo prioridad → días → saldo; los
 * sub-chips y la búsqueda se resuelven acá sobre lo ya bajado, así que funcionan igual sin señal.
 */
function MoraList({
  load,
  chip,
  onChip,
  query,
  refreshing,
  onRefresh,
}: {
  load: MoraLoad;
  chip: MoraChip;
  onChip: (c: MoraChip) => void;
  query: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const asOf = useMemo(() => new Date(), [load]);
  const rows = load.status === 'ok' ? load.rows : [];
  const items = useMemo(
    () => MORA_CHIPS.map((k) => ({ key: k, label: MORA_CHIP_LABEL[k], count: filterMora(rows, k, query, asOf).length })),
    [rows, query, asOf],
  );
  const visible = useMemo(() => filterMora(rows, chip, query, asOf), [rows, chip, query, asOf]);

  if (load.status === 'loading')
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.navy} />
      </View>
    );
  if (load.status === 'offline') return <EmptyState icon="📴" title="Sin conexión" hint="Tu mora aparecerá cuando vuelva la red." />;
  if (load.status === 'error') return <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />;

  const stale = staleLine(load.localAt);
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.chips}>
        <SegmentTabs items={items} value={chip} onChange={(k) => onChip(k as MoraChip)} />
        {stale && <Text style={styles.othersHint}>{stale}</Text>}
      </View>
      {visible.length === 0 ? (
        <EmptyState
          icon={rows.length === 0 ? '🎉' : '🔍'}
          title={rows.length === 0 ? 'Nadie en mora' : 'Sin resultados'}
          hint={rows.length === 0 ? 'No tenés créditos vencidos.' : 'Probá con otro filtro o búsqueda.'}
        />
      ) : (
        <FlashList
          data={visible}
          keyExtractor={(r) => r.creditId}
          estimatedItemSize={92}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
          renderItem={({ item }) => <MoraRowCard row={item} asOf={asOf} />}
        />
      )}
    </View>
  );
}

/** La tarjeta del crédito: lo arma `moraCardProps` (probado aparte) y la pinta `CaseCard`. */
function MoraRowCard({ row, asOf }: { row: MoraRow; asOf: Date }) {
  const p = moraCardProps(row, asOf);
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <CaseCard
        name={p.name}
        caption={p.caption}
        subtitle={p.subtitle}
        amount={p.amount}
        amountDanger
        badge={p.badge}
        // M2 lo lleva a la ficha de mora; mientras, abre la ficha del deudor.
        onPress={() => router.push(`/cliente/${row.clientId}`)}
      />
    </View>
  );
}

/**
 * Resultados de la búsqueda global que **no** están en la cartera cargada. Sin deuda ni estado a propósito:
 * `GET /clients` no los trae, e inventar un "Bs 0" sería mentirle al cobrador.
 */
function Others({ hits }: { hits: ClientHit[] }) {
  return (
    <View style={{ marginTop: SPACING.lg, gap: SPACING.sm }}>
      <SectionLabel>Otros clientes</SectionLabel>
      <Text style={styles.othersHint}>No están en tu cartera de hoy.</Text>
      {hits.map((h) => (
        <ListRow
          key={h.id}
          title={clientDisplayName(h)}
          subtitle={h.nationalId ? `CI ${h.nationalId}` : undefined}
          onPress={() => router.push(`/cliente/${h.id}`)}
        />
      ))}
    </View>
  );
}

/** Tarjeta de cliente (§5.3): nombre + zona, deuda agregada (roja si mora), línea secundaria y badge. */
function Card({ card }: { card: ClientPortfolio }) {
  const meta = PORTFOLIO_STATUS_META[card.status];
  // D7: si parte de la deuda la reporta el banco, la tarjeta lo dice junto a la zona.
  const caption = [card.zone, card.creditCount > 1 ? `${card.creditCount} préstamos` : undefined, card.sourceLine]
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

/**
 * Fila compacta (una línea por cliente): punto de estado + nombre + monto. Misma info accionable que la
 * tarjeta pero ~4x más clientes por pantalla; el detalle sigue a un toque. Sin zona ni línea secundaria
 * a propósito — ponytail: si hace falta más contexto, está la vista en tarjetas.
 */
function CompactRow({ card }: { card: ClientPortfolio }) {
  const overdue = card.maxDaysPastDue > 0;
  return (
    <Pressable
      style={({ pressed }) => [styles.compactRow, pressed && { backgroundColor: COLORS.bg }]}
      accessibilityRole="button"
      accessibilityLabel={`${card.name}, ${PORTFOLIO_STATUS_META[card.status].label}, ${money(card.totalDebt, card.currency)}`}
      onPress={() => router.push(`/cliente/${card.clientId}`)}
    >
      <View style={[styles.dot, { backgroundColor: TONE_SOLID[PORTFOLIO_STATUS_META[card.status].tone] }]} />
      <Text style={styles.compactName} numberOfLines={1}>
        {card.name}
      </Text>
      {overdue && <Text style={styles.compactDays}>{card.maxDaysPastDue}d</Text>}
      <Text style={[styles.compactAmount, overdue && { color: COLORS.danger }]} numberOfLines={1}>
        {money(card.totalDebt, card.currency)}
      </Text>
    </Pressable>
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
  chips: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, gap: SPACING.sm },
  sortPill: {
    alignSelf: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  sortText: { ...TYPE.caption, color: COLORS.navy, fontWeight: '600' },
  tools: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    minHeight: 48, // toque cómodo con guantes, sin desperdiciar alto
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  compactName: { ...TYPE.body, flex: 1, color: COLORS.text, fontWeight: '600' },
  compactDays: { ...TYPE.caption, color: COLORS.danger, fontWeight: '700' },
  compactAmount: { ...TYPE.body, color: COLORS.navy, fontWeight: '700' },
  othersHint: { ...TYPE.caption, color: COLORS.muted, marginTop: -SPACING.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute', right: SPACING.lg, bottom: SPACING.lg, width: 56, height: 56, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.purple, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.navy, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabPlus: { color: COLORS.white, fontSize: 30, lineHeight: 32, fontWeight: '400' },
});
