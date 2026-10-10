import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RouteStatus } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import {
  AgendaCard,
  AGENDA_STATUS_LABEL,
  AGENDA_TYPE_META,
  Header,
  ListRow,
  ProgressBar,
  SectionLabel,
  StatTile,
  StatusBadge,
} from '@/ui';
import { authService, type Me } from '@/auth-service';
import { tenantCurrency } from '@/mora.service';
import { getRoute, listRoutes, routeProgress, type RouteItem } from '@/routes.service';
import { getSummaryCached, listByDay, listOverdue, type AgendaListItem } from '@/agenda.service';
import { listPaymentsByDay } from '@/payments.service';
import { money, todayISO } from '@/agenda-form';
import { syncAgendaReminders } from '@/agenda-notifications';
import { dayProgress, dueSoon, queuedCollectedToday, summaryView, upNext, type DayProgress, type SummaryView } from '@/home';
import { pendingActions } from '@/sync/queue';
import { unreadCount } from '@/notifications.service';

/** KPIs de la jornada (calculados en cliente — decisión cerrada). `—` = dato no disponible aún. */
interface Home {
  me: Me;
  collected: string;
  progress: DayProgress;
  overdue: number;
  proximas: AgendaListItem[];
  siguientes: AgendaListItem[];
  route: RouteItem | null;
  routeProgress: { done: number; total: number } | null;
  unread: number;
  /** Contactos efectivos y promesas de hoy: los calcula el servidor (una sola definición para web y móvil). */
  summary: SummaryView;
}

/**
 * Inicio (Home / Jornada) — Figma `42:3069` (con ruta) / `42:3247` (pre-jornada).
 *
 * Es la primera pantalla del día y contesta tres preguntas en ese orden: **cómo voy** (el bloque
 * navy), **qué es lo urgente** (la banda naranja y la agenda de hoy) y **dónde tengo que ir** (la
 * ruta). Todo lo que muestra es pulsable: el Home no es un tablero, es el punto de partida.
 *
 * `ponytail:` las tarjetas de agenda no muestran el monto que sí tiene el mockup — `AgendaListItem`
 * no lo trae y sumarlo es tocar el serializer del backend. Se agrega cuando se toque agenda.
 */
export default function InicioScreen() {
  const [home, setHome] = useState<Home | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await authService.me();
    if (res.status === 'offline') {
      // Ya no expulsa a la pantalla de offline ni en el arranque: desde P6, `me()` responde con la
      // identidad guardada mientras la sesión local siga vigente, así que llegar acá significa que
      // de verdad no hay con qué trabajar (sesión vencida o teléfono nuevo). El Home se queda como
      // está y el banner explica lo que pasa — nunca se saca al cobrador del shell por conectividad.
      return;
    }
    if (res.status !== 'ok') return router.replace('/(auth)/login');
    const me = res.me;
    const hoy = todayISO();

    // Todo en paralelo; cada dato degrada solo si falla (offline/error no bloquea el Home).
    const [agendaRes, overdueRes, routesRes, unread, paysRes, currency, summaryRes] = await Promise.all([
      listByDay(hoy),
      listOverdue(1), // sólo interesa `meta.total`: el contador de vencidas
      listRoutes({ collectorId: me.userId, status: RouteStatus.IN_PROGRESS }),
      unreadCount(),
      listPaymentsByDay(hoy),
      // La moneda en la que cobra este tenant (de la lista de créditos): `payments` no la trae y
      // `GET /accounts/me` es 403 para el cobrador.
      tenantCurrency(),
      getSummaryCached(),
    ]);

    const items = agendaRes.status === 'ok' ? agendaRes.data : [];
    // Los avisos de hoy (parcial: solo las gestiones de esta lista; la semana entera la programa la hidratación).
    if (agendaRes.status === 'ok') void syncAgendaReminders(agendaRes.data, { complete: false });

    // ponytail: filtro por status IN_PROGRESS (no por fecha) — un cobrador tiene a lo sumo una
    // ruta activa; evita el match exacto de datetime del backend en `plannedDate`.
    const active = routesRes.status === 'ok' ? (routesRes.data[0] ?? null) : null;
    // El listado no trae stops → pido el detalle para el progreso de paradas.
    const detail = active ? await getRoute(active.id) : null;
    const route = detail && detail.status === 'ok' ? detail.data : active;

    // Cobrado hoy: `GET /payments` devuelve los del TENANT, así que se filtra por quién lo registró
    // — si no, el Home mostraría lo que cobró otro. Cuenta todo lo suyo, con ruta o sin ella.
    // ponytail: el techo de 100 pagos/día de `listPaymentsByDay` alcanza para un cobrador; si un
    // tenant grande lo supera, hace falta paginar o un `registeredBy` en el query.
    // Más lo cobrado sin señal que sigue en la cola: es de este cobrador por definición (la cola es suya) y todavía
    // no está en `GET /payments`. Sin sumarlo, cobrar offline dejaba el Home en «Bs 0».
    let enCola = 0;
    try {
      enCola = queuedCollectedToday(await pendingActions(me.userId));
    } catch {
      /* si la cola no se puede leer, se muestra lo del server */
    }
    const delServer =
      paysRes.status === 'ok'
        ? paysRes.data.filter((p) => p.registeredBy === me.userId).reduce((sum, p) => sum + p.amount, 0)
        : null;
    const collected = delServer === null ? (enCola > 0 ? enCola : null) : delServer + enCola;

    setHome({
      me,
      collected: collected === null ? '—' : money(collected, currency),
      progress: dayProgress(items),
      overdue: overdueRes.status === 'ok' ? overdueRes.total : 0,
      proximas: dueSoon(items, new Date()),
      siguientes: upNext(items),
      route,
      routeProgress: route ? routeProgress(route) : null,
      unread,
      summary: summaryView(summaryRes, hoy),
    });
  }, []);

  // Al volver de registrar una gestión o un pago los números cambiaron: se relee al enfocar.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!home) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.navy} />
      </View>
    );
  }

  const name = home.me.profile ? home.me.profile.firstName : home.me.email;
  const { progress } = home;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header
        title="Inicio"
        // El 🔔 siempre lleva al buzón, tenga o no pendientes: si sólo apareciera con no leídas,
        // no habría forma de volver a leer una vez marcadas.
        right={
          <Pressable onPress={() => router.push('/notificaciones')} hitSlop={8} accessibilityRole="button">
            <StatusBadge label={home.unread > 0 ? `🔔 ${home.unread}` : '🔔'} tone={home.unread > 0 ? 'info' : 'neutral'} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
      >
        <View>
          <Text style={TYPE.h1}>Hola, {name}</Text>
          <Text style={{ ...TYPE.secondary, marginTop: 4 }}>Tu jornada de hoy</Text>
        </View>

        {/* Cómo voy: el bloque navy del mockup. Progreso arriba, los tres números abajo. */}
        <View style={styles.bloque}>
          <View style={styles.bloqueHead}>
            <Text style={styles.bloqueLabel}>PROGRESO DEL DÍA</Text>
            <Text style={styles.bloquePct}>{progress.percent}%</Text>
          </View>
          <ProgressBar percent={progress.percent} />
          <View style={styles.tiles}>
            <StatTile label="PENDIENTES" value={String(progress.pending)} onDark onPress={() => router.push('/(tabs)/agenda')} />
            <StatTile
              label="VENCIDOS"
              value={String(home.overdue)}
              tone={home.overdue > 0 ? 'danger' : 'neutral'}
              onDark
              // Abre la Agenda, donde las vencidas van arriba de todo: antes era una cifra que no llevaba a ningún lado.
              onPress={() => router.push('/(tabs)/agenda')}
            />
            <StatTile label="COBRADO HOY" value={home.collected} tone="success" onDark />
          </View>
        </View>

        {/* Lo que el servidor cuenta hoy. Un resumen guardado dice de qué hora es; uno de ayer no muestra cifras. */}
        {home.summary.freshness !== 'none' && (
          <View style={{ gap: SPACING.xs }}>
            <View style={styles.tiles}>
              <StatTile label="CONTACTOS EFECTIVOS" value={home.summary.effectiveContacts == null ? '—' : String(home.summary.effectiveContacts)} />
              <StatTile label="PROMESAS TOMADAS" value={home.summary.promisesTaken == null ? '—' : String(home.summary.promisesTaken)} />
              <StatTile label="PROMESAS DE HOY" value={home.summary.promisesDue == null ? '—' : String(home.summary.promisesDue)} />
            </View>
            {home.summary.freshness === 'cached' && <Text style={TYPE.caption}>{`Sin señal: datos de las ${home.summary.asOf ?? 'última vez'}.`}</Text>}
            {home.summary.freshness === 'outdated' && <Text style={TYPE.caption}>Sin datos de hoy todavía: se actualizan con señal.</Text>}
          </View>
        )}

        {/* Lo urgente. Sólo aparece si de verdad hay algo por empezar: una banda naranja permanente
            deja de significar urgencia a los dos días. */}
        {home.proximas.length > 0 && (
          <Pressable style={styles.urgente} onPress={() => router.push('/(tabs)/agenda')} accessibilityRole="button">
            <Text style={styles.urgenteText}>
              🕐  {home.proximas.length === 1
                ? '1 gestión en los próximos 30 min'
                : `${home.proximas.length} gestiones en los próximos 30 min`}
            </Text>
            <Text style={styles.urgenteChevron}>›</Text>
          </Pressable>
        )}

        {/* Recordatorio blando del segundo factor: se puede postergar indefinidamente
            (decisión 31/07), así que el aviso queda hasta que lo active. */}
        {!home.me.mfaEnabled && (
          <ListRow
            title="Protegé tu cuenta"
            subtitle="Activá la verificación en dos pasos"
            right={<StatusBadge label="Pendiente" tone="warning" />}
            onPress={() => router.push('/(auth)/mfa-setup?authed=1')}
          />
        )}

        <View style={styles.seccionHead}>
          <SectionLabel>AGENDA DE HOY</SectionLabel>
          <Pressable onPress={() => router.push('/(tabs)/agenda')} hitSlop={8} accessibilityRole="button">
            <Text style={styles.verTodo}>Ver toda ›</Text>
          </Pressable>
        </View>
        {home.siguientes.length === 0 ? (
          <Text style={styles.vacio}>
            {progress.total === 0 ? 'No tenés gestiones agendadas para hoy.' : '¡Listo! Cerraste todas las de hoy.'}
          </Text>
        ) : (
          home.siguientes.map((it) => {
            const meta = AGENDA_TYPE_META[it.type];
            return (
              <AgendaCard
                key={it.id}
                name={it.clientName ?? 'Cliente'}
                icon={meta.icon}
                typeLabel={meta.label}
                time={it.scheduledTime}
                statusLabel={AGENDA_STATUS_LABEL[it.status]}
                tone={meta.tone}
                overdue={it.isOverdue}
                onPress={() => router.push(`/agenda/${it.id}`)}
              />
            );
          })
        )}

        <SectionLabel>RUTA DE HOY</SectionLabel>
        {home.route && home.routeProgress ? (
          <ListRow
            title="Ruta en curso"
            subtitle={`${home.routeProgress.done} de ${home.routeProgress.total} paradas`}
            icon="map-outline"
            right={
              <StatusBadge
                label={
                  home.routeProgress.done >= home.routeProgress.total && home.routeProgress.total > 0
                    ? 'Completa'
                    : 'En curso'
                }
                tone={
                  home.routeProgress.done >= home.routeProgress.total && home.routeProgress.total > 0
                    ? 'success'
                    : 'info'
                }
              />
            }
            onPress={() => router.push('/(tabs)/rutas')}
          />
        ) : (
          <ListRow
            title="Sin ruta activa"
            subtitle="Armá tu recorrido del día"
            icon="map-outline"
            right={<StatusBadge label="Pendiente" tone="warning" />}
            onPress={() => router.push('/(tabs)/rutas')}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bloque: { backgroundColor: COLORS.navy, borderRadius: RADIUS.card, padding: SPACING.lg, gap: SPACING.md },
  bloqueHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bloqueLabel: { ...TYPE.caption, color: COLORS.lightBg, letterSpacing: 0.5, fontWeight: '600' },
  bloquePct: { ...TYPE.body, color: COLORS.white, fontWeight: '700' },
  tiles: { flexDirection: 'row', gap: SPACING.md },
  urgente: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.warning,
    borderRadius: RADIUS.card,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  urgenteText: { ...TYPE.body, color: COLORS.white, fontWeight: '600', flex: 1 },
  urgenteChevron: { ...TYPE.h2, color: COLORS.white },
  seccionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verTodo: { ...TYPE.secondary, color: COLORS.purple, fontWeight: '600' },
  vacio: { ...TYPE.secondary },
});
