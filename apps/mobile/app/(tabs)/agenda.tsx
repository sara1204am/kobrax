import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { CaseStatus, formatCurrency, SUPPORTED_CURRENCIES, type CurrencyCode } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { CaseCard, CASE_PRIORITY_LABEL, CASE_STATUS_LABEL, EmptyState, Header } from '@/ui';
import { authService } from '@/auth-service';
import { listCases, type CaseListItem } from '@/cases.service';

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error'; message: string }
  | { status: 'ok'; cases: CaseListItem[]; total: number };

/** Filtros de la Agenda: por estado operativo o "En mora" (overdue). `key` estable para React. */
interface Filter {
  key: string;
  label: string;
  status?: CaseStatus;
  overdue?: boolean;
}
const FILTERS: Filter[] = [
  { key: 'all', label: 'Todos' },
  { key: 'overdue', label: 'En mora', overdue: true },
  { key: 'active', label: CASE_STATUS_LABEL[CaseStatus.ACTIVE], status: CaseStatus.ACTIVE },
  { key: 'negotiation', label: CASE_STATUS_LABEL[CaseStatus.IN_NEGOTIATION], status: CaseStatus.IN_NEGOTIATION },
  { key: 'promise', label: CASE_STATUS_LABEL[CaseStatus.PROMISE_TO_PAY], status: CaseStatus.PROMISE_TO_PAY },
  { key: 'paid', label: CASE_STATUS_LABEL[CaseStatus.PAID], status: CaseStatus.PAID },
];

/** Formatea el monto con la moneda del crédito; si no es una moneda soportada, número plano. */
function formatMoney(amount?: number, currency?: string): string | null {
  if (amount == null) return null;
  if (currency && currency in SUPPORTED_CURRENCIES) return formatCurrency(amount, currency as CurrencyCode);
  return amount.toLocaleString();
}

/** Subtítulo del caso: monto + prioridad + días de mora (mora calculada por el server, no por el reloj). */
function caseSubtitle(c: CaseListItem): string {
  const parts: string[] = [];
  const money = formatMoney(c.amount, c.currency);
  if (money) parts.push(money);
  parts.push(CASE_PRIORITY_LABEL[c.priority]);
  if (c.isOverdue) parts.push(`${c.daysPastDue ?? 0} días de mora`);
  return parts.join(' · ');
}

/** Agenda Diaria (`64:4`): casos asignados del cobrador + filtro por estado/mora. Solo lectura. */
export default function AgendaScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>(FILTERS[0]!);
  const [refreshing, setRefreshing] = useState(false);
  // Descarta respuestas viejas cuando el usuario cambia de filtro rápido (last-write-wins).
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

  const fetchCases = useCallback(async (uid: string, f: Filter) => {
    const reqId = ++reqRef.current;
    const res = await listCases({ assigneeId: uid, status: f.status, overdue: f.overdue, limit: 100 });
    if (reqId !== reqRef.current) return; // llegó una respuesta más nueva → descartar esta
    if (res.status === 'offline') return setLoad({ status: 'offline' });
    if (res.status === 'unauthenticated') return router.replace('/(auth)/login');
    if (res.status === 'error') return setLoad({ status: 'error', message: res.message });
    setLoad({ status: 'ok', cases: res.data, total: res.total });
  }, []);

  useEffect(() => {
    if (userId) void fetchCases(userId, filter);
  }, [userId, filter, fetchCases]);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await fetchCases(userId, filter);
    setRefreshing(false);
  }, [userId, filter, fetchCases]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Agenda" />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, gap: SPACING.sm }}
        style={{ flexGrow: 0 }}
      >
        {FILTERS.map((f) => {
          const active = f.key === filter.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.xs,
                borderRadius: RADIUS.pill,
                backgroundColor: active ? COLORS.navy : COLORS.white,
                borderWidth: 1,
                borderColor: active ? COLORS.navy : COLORS.border,
              }}
            >
              <Text style={{ ...TYPE.secondary, color: active ? COLORS.white : COLORS.text2, fontWeight: '600' }}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* flex:1 acota la altura del FlashList para que virtualice (si no, colapsa a 0). */}
      <View style={{ flex: 1 }}>
        <AgendaBody load={load} refreshing={refreshing} onRefresh={onRefresh} />
      </View>
    </View>
  );
}

function AgendaBody({
  load,
  refreshing,
  onRefresh,
}: {
  load: Load;
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
    return <EmptyState icon="🗓️" title="Sin casos" hint="No tienes casos asignados con este filtro." />;
  }
  const shown = load.cases.length;
  const countLabel = load.total > shown ? `${shown} de ${load.total} casos` : `${shown} ${shown === 1 ? 'caso' : 'casos'}`;
  return (
    <FlashList
      data={load.cases}
      keyExtractor={(c) => c.id}
      estimatedItemSize={72}
      contentContainerStyle={{ padding: SPACING.lg }}
      ListHeaderComponent={<Text style={{ ...TYPE.caption, marginBottom: SPACING.sm }}>{countLabel}</Text>}
      ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
      refreshing={refreshing}
      onRefresh={onRefresh}
      renderItem={({ item }) => (
        <CaseCard
          title={item.clientName ?? `Caso ${item.id.slice(0, 8)}`}
          subtitle={caseSubtitle(item)}
          status={item.status}
          overdue={item.isOverdue}
        />
      )}
    />
  );
}
