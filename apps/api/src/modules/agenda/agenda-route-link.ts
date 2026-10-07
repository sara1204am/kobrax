import type { PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, RouteStatus, RouteStopStatus } from '@prisma/client';

/**
 * El vínculo entre una visita agendada y la parada de ruta que la lleva (F4/11 · E1).
 *
 * 🔴 **La parada es el contenedor operativo; la gestión sigue siendo la fuente de verdad.** Quien cambia la gestión
 * (reagendar, cancelar, eliminar, reasignar) mantiene la ruta en la misma transacción, y quien visita la parada cierra
 * la gestión en la suya. Todo vive acá, en un solo lugar, para que ninguno de los dos lados reimplemente la regla.
 *
 * Funciones puras sobre `tx`: no tocan auditoría ni permisos (los pone quien las llama).
 */

type Tx = Pick<PrismaClient, 'routeStop' | 'routePlan' | '$executeRaw'>;

/** Renumera las paradas de una ruta 1..N en el orden dado (el `unique(routeId, sequenceOrder)` no admite cruces). */
async function resequence(tx: Pick<PrismaClient, 'routeStop'>, orderedIds: string[]): Promise<void> {
  const TEMP = 10_000; // fuera de rango de cualquier ruta real
  for (const [i, id] of orderedIds.entries()) await tx.routeStop.update({ where: { id }, data: { sequenceOrder: TEMP + i } });
  for (const [i, id] of orderedIds.entries()) await tx.routeStop.update({ where: { id }, data: { sequenceOrder: i + 1 } });
}

/**
 * Saca la visita de la ruta que la lleva. Según el momento:
 *  - ruta **planificada** (la parada aún no se tocó): la parada se borra y las demás se corren;
 *  - ruta **en curso** y parada sin visitar: la parada queda **salteada** (no se borra: ya es parte de la jornada);
 *  - parada ya visitada: no se toca (la gestión ya se cerró con ella).
 * Devuelve cuántas paradas cambió.
 */
export async function detachVisitFromRoute(tx: Tx & Pick<PrismaClient, 'routeStop'>, agendaItemId: string): Promise<number> {
  const stops = await tx.routeStop.findMany({
    where: { agendaItemId, status: { in: [RouteStopStatus.PENDING, RouteStopStatus.IN_ROUTE] } },
    select: { id: true, routeId: true },
  });
  let changed = 0;
  for (const stop of stops) {
    const route = await tx.routePlan.findFirst({ where: { id: stop.routeId }, select: { id: true, status: true } });
    if (!route || route.status === RouteStatus.CANCELLED || route.status === RouteStatus.COMPLETED) continue;
    if (route.status === RouteStatus.PLANNED) {
      await tx.routeStop.delete({ where: { id: stop.id } });
      const rest = await tx.routeStop.findMany({ where: { routeId: route.id }, orderBy: { sequenceOrder: 'asc' }, select: { id: true } });
      await resequence(tx, rest.map((s) => s.id));
      await tx.routePlan.update({ where: { id: route.id }, data: { totalCases: rest.length } });
    } else {
      await tx.routeStop.update({ where: { id: stop.id }, data: { status: RouteStopStatus.SKIPPED } });
    }
    changed += 1;
  }
  return changed;
}

/**
 * Si el responsable ya tiene una ruta **planificada** ese día, la visita entra a ella como la última parada (o, si el
 * crédito ya iba en esa ruta, la parada existente queda vinculada). Sin ruta ese día no hace nada: entrará cuando se
 * genere. Una ruta en curso no se toca. Solo para `VISIT` pendientes.
 */
export async function attachVisitToPlannedRoute(
  tx: Tx & Pick<PrismaClient, 'routeStop'>,
  item: { id: string; accountId: string; assigneeId: string; clientId: string; creditId: string; scheduledDate: Date; type: AgendaItemType; status: AgendaItemStatus },
): Promise<boolean> {
  if (item.type !== AgendaItemType.VISIT || item.status !== AgendaItemStatus.SCHEDULED) return false;
  const route = await tx.routePlan.findFirst({
    where: { collectorId: item.assigneeId, plannedDate: item.scheduledDate, status: RouteStatus.PLANNED },
    select: { id: true },
  });
  if (!route) return false;

  const same = await tx.routeStop.findFirst({ where: { routeId: route.id, creditId: item.creditId }, select: { id: true, agendaItemId: true } });
  if (same) {
    if (same.agendaItemId) return false; // ya lleva otra visita de ese crédito: ésta queda solo en la agenda
    await tx.routeStop.update({ where: { id: same.id }, data: { agendaItemId: item.id } });
    return true;
  }
  const last = await tx.routeStop.findFirst({ where: { routeId: route.id }, orderBy: { sequenceOrder: 'desc' }, select: { sequenceOrder: true } });
  await tx.routeStop.create({
    data: {
      accountId: item.accountId,
      routeId: route.id,
      clientId: item.clientId,
      creditId: item.creditId,
      agendaItemId: item.id,
      sequenceOrder: (last?.sequenceOrder ?? 0) + 1,
    },
  });
  await tx.routePlan.update({ where: { id: route.id }, data: { totalCases: await tx.routeStop.count({ where: { routeId: route.id } }) } });
  return true;
}
