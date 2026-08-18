import { AgendaItemStatus, ScheduleTimeMode } from '@kobrax/shared';

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

/** Los 7 días de la semana de `iso`, de lunes a domingo. La tira de navegación del día. */
export function weekOf(iso: string): string[] {
  const d = new Date(`${iso}T00:00:00.000Z`);
  // `getUTCDay()` da 0 el domingo; acá la semana arranca el lunes, como el calendario de la región.
  const lunes = shiftDay(iso, -((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDay(lunes, i));
}

/**
 * La grilla del mes de `iso`: siempre semanas enteras de lunes a domingo.
 *
 * Devuelve 35 o 42 días —los del mes más los del anterior y el siguiente que completan la primera y
 * la última semana—, porque una grilla de 7 columnas con la primera fila coja se lee peor que una
 * con dos días de marzo asomando en abril.
 */
export function monthGrid(iso: string): string[] {
  const primero = `${iso.slice(0, 7)}-01`;
  const d = new Date(`${primero}T00:00:00.000Z`);
  const díasDelMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const desde = weekOf(primero)[0]!;
  const último = shiftDay(primero, díasDelMes - 1);
  const hasta = weekOf(último)[6]!;

  const out: string[] = [];
  for (let day = desde; day <= hasta; day = shiftDay(day, 1)) out.push(day);
  return out;
}

/** Otro mes, en `YYYY-MM-DD` (día 1). Evita el desborde de `setUTCMonth` sobre un día 31. */
export function shiftMonth(iso: string, months: number): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Lo que la tira semanal y el calendario necesitan saber de un día, sin abrirlo. */
export interface DayLoad {
  total: number;
  /** Pendientes y ya vencidas: es lo único que se pinta en rojo. */
  overdue: number;
  done: number;
}

/** Cuántas gestiones cae en cada día de un rango, y cómo vienen. */
export function loadByDay(items: { scheduledDate: string; status: AgendaItemStatus; isOverdue: boolean }[]): Map<string, DayLoad> {
  const out = new Map<string, DayLoad>();
  for (const item of items) {
    const day = item.scheduledDate.slice(0, 10);
    const load = out.get(day) ?? { total: 0, overdue: 0, done: 0 };
    load.total += 1;
    if (item.status === AgendaItemStatus.SCHEDULED) {
      if (item.isOverdue) load.overdue += 1;
    } else {
      load.done += 1;
    }
    out.set(day, load);
  }
  return out;
}

export interface HourGroup<T> {
  /** La etiqueta de la izquierda: la hora, el nombre de la franja, o «sin hora». */
  when: string;
  items: T[];
}

/**
 * Las gestiones de un día, **agrupadas por bloque horario**.
 *
 * 🔴 La hora aparece UNA vez. Antes cada fila repetía su hora en una columna fija, y un día con seis
 * gestiones a las 9 mostraba «09:00» seis veces: la columna dejaba de leerse como una línea de
 * tiempo y pasaba a ser ruido pegado a cada nombre.
 *
 * El orden lo trae el servidor (`scheduledTime asc`); acá sólo se juntan las que comparten rótulo,
 * y los grupos se mantienen en el orden en que aparecieron. Las que no tienen hora quedan al final
 * porque su rótulo llega último, no porque se las ordene aparte.
 */
export function groupByHour<T>(items: T[], whenOf: (item: T) => string): HourGroup<T>[] {
  const out: HourGroup<T>[] = [];
  for (const item of items) {
    const when = whenOf(item);
    const last = out[out.length - 1];
    if (last && last.when === when) last.items.push(item);
    else out.push({ when, items: [item] });
  }
  return out;
}

/** Las métricas del día. Se derivan de lo que ya llegó: ni una llamada más. */
export function dayMetrics(items: { status: AgendaItemStatus; isOverdue: boolean }[]): {
  total: number;
  done: number;
  overdue: number;
  /** Porcentaje entero de completadas. Sin gestiones es 0 y no `NaN`. */
  donePct: number;
} {
  const total = items.length;
  const done = items.filter((i) => i.status !== AgendaItemStatus.SCHEDULED).length;
  const overdue = items.filter((i) => i.status === AgendaItemStatus.SCHEDULED && i.isOverdue).length;
  return { total, done, overdue, donePct: total > 0 ? Math.round((done / total) * 100) : 0 };
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
 *
 * **Editar no está**: el panel supervisa lo agendado, y corregir la hora o la observación de una
 * gestión propia es trabajo del teléfono, que es donde se agendó. Ver §12 del plan.
 */
export function itemActions(status: AgendaItemStatus): ('complete' | 'reschedule' | 'cancel')[] {
  return status === AgendaItemStatus.SCHEDULED ? ['complete', 'reschedule', 'cancel'] : [];
}

/**
 * Cuándo se hace la gestión: la hora exacta o el nombre de la franja.
 *
 * Son **dos formas de programar**, no una hora que a veces falta; por eso «Sin hora» es el último
 * recurso y no el caso normal de una gestión por franja.
 */
export function itemWhen(
  item: { timeMode: ScheduleTimeMode; scheduledTime?: string; timeSlot?: string },
  t: { (key: string): string; has: (key: string) => boolean },
): string {
  if (item.timeMode === ScheduleTimeMode.FIXED) return item.scheduledTime ?? t('noTime');
  const key = `timeSlot.${item.timeSlot}`;
  return item.timeSlot && t.has(key) ? t(key) : t('noTime');
}
