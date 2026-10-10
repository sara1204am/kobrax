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

/** Los estados que se ofrecen en el filtro; «other» agrupa lo que salió distinto (reagendada o cancelada). */
export type StatusFilter = '' | 'SCHEDULED' | 'EXECUTED' | 'CANCELLED' | 'RESCHEDULED';

export interface AgendaFilters {
  /** Id del cobrador. */
  gestor?: string;
  tipo?: string;
  estado?: string;
  /** Texto libre: deudor, código del crédito o id de la gestión. */
  q?: string;
}

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Los filtros de la pantalla, una sola vez, para el día, el mes, las métricas y el calendario.
 *
 * `GET /agenda` no filtra por tipo, estado ni texto: el día llega entero y sin paginar, así que
 * filtrar acá no esconde nada. La búsqueda ignora tildes y mayúsculas.
 */
export function filterItems<
  T extends { id: string; assigneeId?: string; type: string; status: string; clientName?: string; creditCode?: string },
>(items: T[], f: AgendaFilters): T[] {
  const q = f.q ? norm(f.q) : '';
  return items.filter((i) => {
    if (f.gestor && i.assigneeId !== f.gestor) return false;
    if (f.tipo && i.type !== f.tipo) return false;
    if (f.estado && i.status !== f.estado) return false;
    if (q) {
      const hay = norm(`${i.clientName ?? ''} ${i.creditCode ?? ''} ${i.id}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Las cifras del «Resumen del día». **No hay «en proceso»**: una gestión está pendiente, ejecutada,
 * cancelada o reagendada, y se cuentan tal cual.
 */
export function daySummary(items: { status: AgendaItemStatus }[]): {
  total: number;
  pending: number;
  done: number;
  /** Reagendadas + canceladas. */
  other: number;
} {
  let pending = 0;
  let done = 0;
  let other = 0;
  for (const i of items) {
    if (i.status === AgendaItemStatus.SCHEDULED) pending += 1;
    else if (i.status === AgendaItemStatus.EXECUTED) done += 1;
    else other += 1;
  }
  return { total: items.length, pending, done, other };
}

export type DaySort = 'hour' | 'type' | 'assignee';

type Timed = {
  timeMode: ScheduleTimeMode;
  scheduledTime?: string;
  timeSlot?: string;
};

/** Orden de las franjas dentro del día: la mañana antes que la tarde. */
const SLOT_ORDER = ['MORNING', 'AFTERNOON', 'NIGHT'];

/**
 * La clave de orden de una gestión dentro del día: las de hora exacta primero (por hora), después las
 * de franja (mañana, tarde, noche) y al final las que no tienen hora.
 */
export function timeSortKey(item: Timed): string {
  const hhmm = item.scheduledTime?.match(/^(\d{2}):(\d{2})/);
  if (item.timeMode !== ScheduleTimeMode.LAPSE && hhmm) return `0-${hhmm[1]}:${hhmm[2]}`;
  if (item.timeMode === ScheduleTimeMode.LAPSE && item.timeSlot && SLOT_ORDER.includes(item.timeSlot)) {
    return `1-${SLOT_ORDER.indexOf(item.timeSlot)}`;
  }
  return '2-';
}

/** La clave del grupo horario: la hora en punto, la franja, o «sin hora». */
export function hourGroupKey(item: Timed): string {
  const k = timeSortKey(item);
  if (k.startsWith('0-')) return `h:${k.slice(2, 4)}:00`;
  if (k.startsWith('1-')) return `s:${item.timeSlot}`;
  return 'none';
}

export interface DayGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * El día agrupado según el orden elegido, con las gestiones de cada grupo siempre por hora.
 *
 *  · `hour` — una banda por hora en punto («09:00»); las de franja (mañana/tarde/noche) van en su propio
 *    grupo con el nombre de la franja, y las sin hora al final.
 *  · `type` — una banda por tipo de gestión.
 *  · `assignee` — una banda por cobrador (sin cobrador al final).
 *
 * Es pura: las etiquetas las resuelve quien llama, que es quien tiene el idioma.
 */
export function groupDay<T extends Timed & { type: string; assigneeId?: string }>(
  items: T[],
  sort: DaySort,
  labels: { slot: (slot?: string) => string; noTime: string; type: (type: string) => string; assignee: (item: T) => string },
): DayGroup<T>[] {
  const byTime = [...items].sort((a, b) => timeSortKey(a).localeCompare(timeSortKey(b)));
  const groups = new Map<string, DayGroup<T>>();
  for (const item of byTime) {
    let key: string;
    let label: string;
    if (sort === 'type') {
      key = `t:${item.type}`;
      label = labels.type(item.type);
    } else if (sort === 'assignee') {
      key = `a:${item.assigneeId ?? ''}`;
      label = labels.assignee(item);
    } else {
      key = hourGroupKey(item);
      label = key.startsWith('h:') ? key.slice(2) : key.startsWith('s:') ? labels.slot(item.timeSlot) : labels.noTime;
    }
    const g = groups.get(key) ?? { key, label, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  const out = [...groups.values()];
  // Por hora ya sale ordenado (se insertó en orden); por tipo o cobrador se ordena por nombre, y lo huérfano al final.
  if (sort !== 'hour') out.sort((a, b) => (a.key.endsWith(':') ? 1 : b.key.endsWith(':') ? -1 : a.label.localeCompare(b.label)));
  return out;
}

/** «Miércoles, 4 de octubre» — con la inicial en mayúscula, en el idioma de quien mira. */
export function longDay(iso: string, locale: string): string {
  const s = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00.000Z`),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** La hora que se escribe en la fila: la exacta, o nada si la gestión es por franja. */
export function rowTime(item: Timed): string | undefined {
  const k = timeSortKey(item);
  return k.startsWith('0-') ? k.slice(2) : undefined;
}

/**
 * La frase de una gestión en la línea de tiempo del detalle: de qué iba, en una línea.
 *
 * Cada tipo guarda lo suyo en `details` (el recordatorio su texto, la promesa su monto, el WhatsApp su
 * mensaje); llamada y visita no tienen texto propio y dicen lo que dejó escrito quien las agendó.
 * Sin nada que decir devuelve `undefined`: la fila muestra sólo el tipo, no una frase inventada.
 */
export function entrySummary(
  e: { type: string; details?: Record<string, unknown>; observations?: string },
  currency: string | undefined,
  promiseText: (amount: string) => string,
  fmtMoney: (amount: number, currency?: string) => string,
): string | undefined {
  const d = e.details ?? {};
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  switch (e.type) {
    case 'REMINDER':
      return text(d.description) ?? text(e.observations);
    case 'WHATSAPP':
      return text(d.message) ?? text(e.observations);
    case 'PROMISE_TO_PAY':
      return typeof d.amount === 'number' ? promiseText(fmtMoney(d.amount, currency)) : text(e.observations);
    default:
      return text(e.observations);
  }
}
