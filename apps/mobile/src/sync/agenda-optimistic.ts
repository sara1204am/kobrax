/**
 * Lo que el cobrador hizo sin señal tiene que VERSE ya en las listas y los contadores (F4/11 · E6), no recién cuando la cola
 * sube. `agenda-register` solo cambiaba el ítem en SU pantalla: al volver a la Agenda o al Inicio la lista cacheada seguía
 * mostrándolo pendiente, el contador no bajaba y el cobrador podía intentar registrarlo otra vez.
 *
 * Acá se aplica el mismo cambio sobre las copias que ya tiene el teléfono: la fila en las listas de su día y en los vencidos,
 * y el detalle. La próxima lectura con señal las reemplaza por lo real (`cachedList` / `cachedOne`), así que esto es solo el
 * puente mientras la cola no llegó — igual que `optimistic.ts` con los clientes y créditos dados de alta sin red.
 *
 * Reglas (no romper los invariantes de `db.ts`): no cambia la forma de ninguna fila y no inventa filas nuevas — solo toca las
 * que ya estaban guardadas.
 */
import { AgendaItemStatus, type AgendaItemDetail, type AgendaListItem } from '@kobrax/shared';
import * as db from '../db';
import { todayISO } from '../tenant-day';
import { cancelAgendaReminder } from '../agenda-notifications';

/** Las consultas de vencidas que guardan las pantallas: el Inicio pide 1 (solo el total) y la Agenda 100. */
const OVERDUE_SCOPES = ['overdue:limit=1', 'overdue:limit=100'];

/** En qué consultas guardadas puede estar la gestión: su día, hoy y las dos de vencidas. */
export function agendaScopesFor(item: Pick<AgendaListItem, 'scheduledDate'>): string[] {
  return [...new Set([item.scheduledDate.slice(0, 10), todayISO(), ...OVERDUE_SCOPES])];
}

/**
 * Aplica `patch` a la gestión en todas las copias locales. Si deja de estar pendiente (ejecutada, cancelada, reagendada)
 * sale de las listas de vencidas —ya no lo es— y el total guardado de esa consulta baja en uno: es lo que lee el contador del Inicio.
 */
export async function patchAgendaItemLocal(item: AgendaListItem, patch: Partial<AgendaListItem>): Promise<void> {
  const leavesPending = patch.status !== undefined && patch.status !== AgendaItemStatus.SCHEDULED;

  for (const scope of agendaScopesFor(item)) {
    const rows = await db.getMany<AgendaListItem>('agenda', scope);
    if (!rows.some((r) => r.id === item.id)) continue;

    if (OVERDUE_SCOPES.includes(scope) && leavesPending) {
      await db.replaceAll<AgendaListItem>('agenda', rows.filter((r) => r.id !== item.id), scope);
      const meta = await db.getOne<{ total?: number }>('list.meta', `agenda|${scope}`);
      if (typeof meta?.total === 'number') await db.putOne('list.meta', `agenda|${scope}`, { total: Math.max(0, meta.total - 1) });
    } else {
      await db.replaceAll<AgendaListItem>('agenda', rows.map((r) => (r.id === item.id ? { ...r, ...patch } : r)), scope);
    }
  }

  // Ya hecha, cancelada, reagendada o corrida de hora: el aviso programado quedó viejo y no puede sonar a destiempo.
  if (leavesPending || patch.scheduledTime !== undefined || patch.timeSlot !== undefined) await cancelAgendaReminder(item.id);

  const detail = await db.getOne<AgendaItemDetail>('agenda.detail', item.id);
  if (detail) await db.putOne('agenda.detail', item.id, { ...detail, item: { ...detail.item, ...patch } });
}
