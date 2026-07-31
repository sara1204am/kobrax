import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { RouteStatus } from '@kobrax/shared';
import { COLORS, SPACING, TYPE } from '@/theme';
import { Header, ListRow, StatTile, StatusBadge } from '@/ui';
import { authService, type Me } from '@/auth-service';
import { listCases } from '@/cases.service';
import { getRoute, listRoutes, routeProgress, type RouteItem } from '@/routes.service';
import { unreadCount } from '@/notifications.service';

/** KPIs de la jornada (calculados en cliente — decisión cerrada). `—` = dato no disponible aún. */
interface Home {
  me: Me;
  assigned: string;
  overdue: string;
  route: RouteItem | null;
  progress: { done: number; total: number } | null;
  unread: number;
}

/** Inicio (Home / Jornada). Home `42:3069` (con ruta) / `42:3247` (pre-jornada). Solo lectura. */
export default function InicioScreen() {
  const [home, setHome] = useState<Home | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (initial: boolean) => {
    const res = await authService.me();
    if (res.status === 'offline') {
      // ponytail: en el mount inicial (sin datos locales aún, WatermelonDB = P6) vamos a la
      // pantalla offline; en un refresh el Home YA está en pantalla → un bache de red no debe
      // expulsar al cobrador (offline-first: nunca sacarlo del shell por conectividad).
      if (initial) router.replace('/(app)/offline');
      return;
    }
    if (res.status !== 'ok') return router.replace('/(auth)/login');
    const me = res.me;

    // KPIs en paralelo; cada uno degrada a "—"/null si falla (offline/error no bloquea el Home).
    // "Casos asignados" cuenta solo ABIERTOS (open) → no infla con casos ya cerrados/pagados.
    const [assignedRes, overdueRes, routesRes, unread] = await Promise.all([
      listCases({ assigneeId: me.userId, open: true, limit: 1 }),
      listCases({ assigneeId: me.userId, overdue: true, limit: 1 }),
      listRoutes({ collectorId: me.userId, status: RouteStatus.IN_PROGRESS }),
      unreadCount(),
    ]);

    // ponytail: filtro por status IN_PROGRESS (no por fecha) — un cobrador tiene a lo sumo una
    // ruta activa; evita el match exacto de datetime del backend en `plannedDate`.
    const active = routesRes.status === 'ok' ? (routesRes.data[0] ?? null) : null;
    // El listado no trae stops → pido el detalle para el progreso de paradas.
    const detail = active ? await getRoute(active.id) : null;
    const route = detail && detail.status === 'ok' ? detail.data : active;

    setHome({
      me,
      assigned: assignedRes.status === 'ok' ? String(assignedRes.total) : '—',
      overdue: overdueRes.status === 'ok' ? String(overdueRes.total) : '—',
      route,
      progress: route ? routeProgress(route) : null,
      unread,
    });
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(false);
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
  const hasRoute = !!home.route;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header
        title="Inicio"
        right={home.unread > 0 ? <StatusBadge label={`🔔 ${home.unread}`} tone="info" /> : undefined}
      />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
      >
        <View>
          <Text style={TYPE.h1}>Hola, {name}</Text>
          <Text style={{ ...TYPE.secondary, marginTop: 4 }}>Tu jornada de hoy</Text>
        </View>

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

        <View style={{ flexDirection: 'row', gap: SPACING.md }}>
          <StatTile label="Cobrado hoy" value="—" />
          <StatTile label="Casos asignados" value={home.assigned} />
          <StatTile
            label="En mora"
            value={home.overdue}
            tone={home.overdue !== '—' && home.overdue !== '0' ? 'danger' : 'neutral'}
          />
        </View>

        {hasRoute && home.progress ? (
          <ListRow
            title="Ruta del día"
            subtitle={`${home.progress.done} de ${home.progress.total} paradas`}
            right={
              <StatusBadge
                label={home.progress.done >= home.progress.total && home.progress.total > 0 ? 'Completa' : 'En curso'}
                tone={home.progress.done >= home.progress.total && home.progress.total > 0 ? 'success' : 'info'}
              />
            }
          />
        ) : (
          <ListRow
            title="Ruta del día"
            subtitle="Sin ruta activa"
            right={<StatusBadge label="Pendiente" tone="warning" />}
          />
        )}

        <Text style={{ ...TYPE.caption }}>
          "Cobrado hoy" se activa con los pagos en campo (P4).
        </Text>
      </ScrollView>
    </View>
  );
}
