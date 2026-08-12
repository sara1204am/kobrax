import { AgendaItemStatus } from '@kobrax/shared';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * El color del estado de una gestión.
 *
 * Cancelada y reagendada **no son rojas**: no salieron mal, salieron distinto. El rojo se reserva
 * para lo que está vencido, que es lo único accionable de un vistazo.
 */
export const AGENDA_STATUS_TONE: Record<AgendaItemStatus, Tone> = {
  [AgendaItemStatus.SCHEDULED]: 'neutral',
  [AgendaItemStatus.EXECUTED]: 'success',
  [AgendaItemStatus.CANCELLED]: 'neutral',
  [AgendaItemStatus.RESCHEDULED]: 'warning',
};

/**
 * Otro día, en `YYYY-MM-DD`.
 *
 * Todo en UTC porque así se guardan las fechas-calendario: hacerlo en hora local corre un día
 * entero para cualquiera al oeste de Greenwich, que es toda Latinoamérica.
 */
export function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Un día es válido si tiene la forma que la API espera; cualquier otra cosa cae en hoy. */
export function dayOr(today: string, value?: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
}

export interface AssigneeGroup<T> {
  assigneeId: string | null;
  name: string;
  items: T[];
}

/**
 * Las gestiones del día, agrupadas por cobrador.
 *
 * `GET /agenda` **no filtra por persona**: con `agenda:assign` devuelve el día de todo el equipo,
 * mezclado. Cuarenta gestiones de ocho cobradores en una sola lista no son una pantalla de
 * supervisión, son un volcado. Se agrupa acá y no en la API porque el día no está paginado: se
 * recibió entero, así que agrupar en el navegador no esconde nada.
 *
 * Los que no tienen a nadie van **al final**: son los que le faltan a alguien, no el arranque de
 * la lista.
 */
export function groupByAssignee<T extends { assigneeId?: string }>(
  items: T[],
  nameOf: (assigneeId: string) => string | undefined,
  unassigned: string,
): AssigneeGroup<T>[] {
  const groups = new Map<string, AssigneeGroup<T>>();
  for (const item of items) {
    const id = item.assigneeId ?? '';
    let group = groups.get(id);
    if (!group) {
      group = { assigneeId: id || null, name: id ? (nameOf(id) ?? id) : unassigned, items: [] };
      groups.set(id, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.assigneeId) return 1;
    if (!b.assigneeId) return -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Qué se puede hacer con una gestión. Sólo las pendientes se tocan: una ejecutada, cancelada o
 * reagendada ya contó lo que pasó, y cambiarla después reescribiría el día.
 */
export function itemActions(status: AgendaItemStatus): ('complete' | 'reschedule' | 'cancel' | 'edit')[] {
  return status === AgendaItemStatus.SCHEDULED ? ['complete', 'reschedule', 'cancel', 'edit'] : [];
}
