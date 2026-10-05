/**
 * La lista de mora del cobrador: filtrar, ordenar y armar la tarjeta. **Puro**, sin red ni React.
 *
 * 🔴 **La mora es por crédito.** Por eso esto NO pasa por `groupPortfolio` (que agrupa créditos por
 * cliente): aquí cada fila es un crédito. La fuente es `GET /mora`, que ya viene acotado al cobrador.
 *
 * El teléfono sólo ordena y filtra lo que llegó. Qué es mora, cuánto se debe y qué prioridad tiene lo
 * decide el servidor (`packages/shared` + API).
 */
import { summarizePromises, type CollectionPriority, type MoraCreditListItem, type MoraNoteKind, type MoraPromise, type MoraPromiseStatus } from '@kobrax/shared';
import { money } from './agenda-form';
import { PRIORITY_LABEL, priorityTone } from './ui';
import type { BadgeTone } from './ui';

/** `cachedList` pide un `id`; el crédito es la identidad de la fila. */
export type MoraRow = MoraCreditListItem & { id: string };

export type MoraChip = 'all' | 'critical' | 'promise';

export const MORA_CHIP_LABEL: Record<MoraChip, string> = {
  all: 'Todos',
  critical: 'Críticos',
  promise: 'Con promesa',
};

const DAY_MS = 86_400_000;

/** Qué tan arriba va cada prioridad (la del episodio abierto). Sin prioridad va al final de su tramo. */
const PRIORITY_RANK: Record<CollectionPriority, number> = {
  CRITICAL: 3,
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
};

/** El rango de una prioridad que el API manda como texto; `-1` si no hay (o no se conoce). */
function rankOf(priority: string | undefined): number {
  return priority && priority in PRIORITY_RANK ? PRIORITY_RANK[priority as CollectionPriority] : -1;
}

/** El servidor manda `MoraCreditListItem`; la fila le suma el `id` que pide el respaldo local. */
export function toMoraRows(items: MoraCreditListItem[]): MoraRow[] {
  return items.map((i) => ({ ...i, id: i.creditId }));
}

/** Días enteros desde la última gestión (`lastActionAt`, sólo informativo); `undefined` si nunca hubo. */
export function daysSinceAction(row: MoraRow, asOf: Date): number | undefined {
  const at = row.lastActionAt;
  if (!at) return undefined;
  return Math.max(0, Math.floor((asOf.getTime() - new Date(at).getTime()) / DAY_MS));
}

export function matchesMoraChip(row: MoraRow, chip: MoraChip, asOf: Date = new Date()): boolean {
  switch (chip) {
    case 'all':
      return true;
    case 'critical':
      return row.priority === 'CRITICAL';
    case 'promise':
      return row.hasActivePromise;
  }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Nombre o nº de crédito, sin acentos ni mayúsculas. Vacío = todo. */
export function matchesMoraSearch(row: MoraRow, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return fold(row.clientName ?? '').includes(q) || fold(row.code ?? '').includes(q);
}

/** Prioridad del episodio primero, después más días de mora, después más saldo. */
export function sortMora(rows: MoraRow[]): MoraRow[] {
  return [...rows].sort((a, b) => {
    const pa = rankOf(a.priority);
    const pb = rankOf(b.priority);
    if (pa !== pb) return pb - pa;
    if (a.daysPastDue !== b.daysPastDue) return b.daysPastDue - a.daysPastDue;
    return (b.balance ?? 0) - (a.balance ?? 0);
  });
}

export function filterMora(
  rows: MoraRow[],
  chip: MoraChip,
  query: string,
  asOf: Date = new Date(),
  filters: MoraFilters = EMPTY_MORA_FILTERS,
): MoraRow[] {
  return sortMora(rows.filter((r) => matchesMoraChip(r, chip, asOf) && matchesMoraSearch(r, query) && matchesMoraFilters(r, filters)));
}

// ── Hoja de filtros (paridad con la web: rango de mora y saldo, fuente, categoría, prioridad, castigado) ──────────
// Se resuelven en el teléfono sobre lo ya bajado (igual que los chips y la búsqueda): funcionan sin señal y no
// inventan reglas: la categoría y la prioridad son las que mandó la API.

export type MoraSourceFilter = 'ALL' | 'KOBRAX' | 'PSF';
export type MoraWrittenOffFilter = 'ALL' | 'ONLY' | 'EXCLUDE';

export interface MoraFilters {
  /** Texto tal como lo escribió el cobrador; vacío o no numérico = sin tope. */
  dpdMin: string;
  dpdMax: string;
  balanceMin: string;
  balanceMax: string;
  source: MoraSourceFilter;
  /** Códigos de categoría elegidos (`A`, `B`…). Vacío = todas. */
  categories: string[];
  /** Prioridades elegidas. Vacío = todas. */
  priorities: string[];
  writtenOff: MoraWrittenOffFilter;
}

export const EMPTY_MORA_FILTERS: MoraFilters = {
  dpdMin: '',
  dpdMax: '',
  balanceMin: '',
  balanceMax: '',
  source: 'ALL',
  categories: [],
  priorities: [],
  writtenOff: 'ALL',
};

/** «12» o «1200,5» → número; vacío o basura → `undefined` (sin tope, no cero). */
export function parseBound(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function matchesMoraFilters(row: MoraRow, f: MoraFilters): boolean {
  const dpdMin = parseBound(f.dpdMin);
  const dpdMax = parseBound(f.dpdMax);
  if (dpdMin !== undefined && row.daysPastDue < dpdMin) return false;
  if (dpdMax !== undefined && row.daysPastDue > dpdMax) return false;

  const bMin = parseBound(f.balanceMin);
  const bMax = parseBound(f.balanceMax);
  // Saldo desconocido (el archivo no lo trajo) no pasa un tope de saldo: no se asume 0 ni infinito.
  if ((bMin !== undefined || bMax !== undefined) && row.balance === undefined) return false;
  if (bMin !== undefined && (row.balance ?? 0) < bMin) return false;
  if (bMax !== undefined && (row.balance ?? 0) > bMax) return false;

  if (f.source === 'KOBRAX' && row.externalSource) return false;
  if (f.source === 'PSF' && !row.externalSource) return false;

  if (f.categories.length > 0 && !(row.category && f.categories.includes(row.category.code))) return false;
  if (f.priorities.length > 0 && !(row.priority && f.priorities.includes(row.priority))) return false;

  if (f.writtenOff === 'ONLY' && !row.writtenOff) return false;
  if (f.writtenOff === 'EXCLUDE' && row.writtenOff) return false;
  return true;
}

/** Cuántos criterios hay puestos (para el contador del botón «Filtros»). */
export function activeFilterCount(f: MoraFilters): number {
  return (
    (f.dpdMin.trim() || f.dpdMax.trim() ? 1 : 0) +
    (f.balanceMin.trim() || f.balanceMax.trim() ? 1 : 0) +
    (f.source !== 'ALL' ? 1 : 0) +
    (f.categories.length > 0 ? 1 : 0) +
    (f.priorities.length > 0 ? 1 : 0) +
    (f.writtenOff !== 'ALL' ? 1 : 0)
  );
}


export interface MoraCardProps {
  name: string;
  caption: string;
  subtitle: string;
  amount?: string;
  badge: { label: string; tone: BadgeTone };
  /** Categoría de mora («B»), cuando la cuenta las tiene configuradas. */
  tag?: string;
}

/** Lo que `CreditCard` pinta para un crédito en mora. Una sola fuente para la tarjeta y su prueba. */
export function moraCardProps(row: MoraRow, asOf: Date = new Date()): MoraCardProps {
  const caption = [
    row.code ? `Crédito ${row.code}` : undefined,
    row.daysPastDue > 0 ? `${row.daysPastDue} ${row.daysPastDue === 1 ? 'día' : 'días'} de mora` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  const since = daysSinceAction(row, asOf);
  // «Última gestión» y «Promesa vigente» son datos sueltos, no estados del crédito (F4/08 · D1).
  const last =
    since === undefined ? undefined : since === 0 ? 'Última gestión: hoy' : `Última gestión: hace ${since} ${since === 1 ? 'día' : 'días'}`;
  const subtitle = [last, row.hasActivePromise ? 'Promesa vigente' : undefined].filter(Boolean).join(' · ');

  // «Vencido si existe»: lo que realmente debe hoy; si el archivo no lo trajo, el saldo.
  const owed = row.overdueAmount ?? row.balance;

  // El badge de la fila de «En mora» es la prioridad del episodio; castigado va aparte y gana (condición propia).
  // Sin prioridad (la fuente no la trae) se dice «En mora»: no se inventa una.
  const badge = row.writtenOff
    ? { label: 'Castigado', tone: 'neutral' as BadgeTone }
    : row.situation === 'CURRENT'
      ? { label: 'Al día', tone: 'success' as BadgeTone }
      : row.priority
      ? { label: PRIORITY_LABEL[row.priority as CollectionPriority] ?? row.priority, tone: priorityTone(row.priority) }
      : { label: 'En mora', tone: 'danger' as BadgeTone };

  return {
    name: row.clientName ?? 'Sin nombre',
    caption,
    subtitle,
    amount: owed === undefined ? undefined : money(owed, row.currency),
    badge,
    tag: row.category ? `Cat. ${row.category.code}` : undefined,
  };
}


/** «Sin señal · datos de las 08:15» cuando la lista salió del respaldo local; `undefined` si es reciente. */
export function staleLine(localAt: number | null | undefined): string | undefined {
  if (!localAt) return undefined;
  const d = new Date(localAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Sin señal · datos de las ${hh}:${mm}`;
}


// ── Etiquetas: UN solo mapa para el tipo y otro para el resultado de una gestión ────────────────────────────

/** Cómo se llama cada tipo de gestión (las mismas palabras que el panel). */
export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  CALL: 'Llamada',
  VISIT: 'Visita',
  MESSAGE: 'Mensaje',
  NOTE: 'Nota',
  PAYMENT: 'Pago',
  STATUS_CHANGE: 'Cambio de estado',
  ASSIGNMENT: 'Asignación',
};

/**
 * Cómo se llama cada resultado. Las palabras son las del panel (`panel.mora.ficha.activity.results`).
 *
 *  · Los 7 primeros son `RECOVERY_RESULTS` (lo que hoy se puede registrar).
 *  · `PROMISE_KEPT` / `PROMISE_BROKEN` / `DONE` vienen de los desenlaces de la agenda: se guardan como resultado de
 *    la gestión y se siguen leyendo en el historial.
 *  · LEGACY (ya no se escriben, pero hay gestiones viejas con ellos): `NO_CONTACT`, `PARTIAL_PAYMENT` y `PAID` no
 *    están en `RECOVERY_RESULTS`. Cada uno tiene su propia palabra: `NO_CONTACT` ya no se confunde con `NO_ANSWER`.
 */
export const RESULT_LABEL: Record<string, string> = {
  CONTACTED: 'Habló con el deudor',
  NO_ANSWER: 'No respondió',
  WRONG_NUMBER: 'Número equivocado',
  NOT_FOUND: 'No lo encontró',
  WRONG_ADDRESS: 'Dirección equivocada',
  REFUSAL: 'Se negó a pagar',
  PROMISE_TO_PAY: 'Promesa de pago',
  PROMISE_KEPT: 'Promesa cumplida',
  PROMISE_BROKEN: 'Promesa incumplida',
  DONE: 'Hecho',
  // legacy
  NO_CONTACT: 'Sin contacto',
  PARTIAL_PAYMENT: 'Pago parcial',
  PAID: 'Pagó',
};

/** El tipo en español; lo que no se conoce se muestra tal cual (no se esconde). */
export function activityTypeLabel(type: string): string {
  return ACTIVITY_TYPE_LABEL[type] ?? type;
}

/** El resultado en español; lo que no se conoce se muestra tal cual. */
export function resultLabel(result: string): string {
  return RESULT_LABEL[result] ?? result;
}

/** «Llamada · No respondió». */
export function activityLine(a: { type: string; result?: string }): string {
  const type = activityTypeLabel(a.type);
  return a.result ? `${type} · ${resultLabel(a.result)}` : type;
}

// ── Tarjeta de gestión: icono y tono por tipo (como `ActivityCard` del panel) ───────────────────────────────

export type LookTone = 'blue' | 'green' | 'red' | 'purple' | 'amber' | 'teal';

/** Fondo y tinta de cada tono (los mismos del panel: `TONES`). */
export const LOOK_COLORS: Record<LookTone, { bg: string; fg: string }> = {
  blue: { bg: '#E8F0FB', fg: '#5B7DBE' },
  green: { bg: '#E8F8F0', fg: '#27AE60' },
  red: { bg: '#FCE8E8', fg: '#DC3545' },
  purple: { bg: '#F0ECFF', fg: '#7B68D6' },
  amber: { bg: '#FFF3CD', fg: '#7A5C00' },
  teal: { bg: '#E3F6F5', fg: '#1B8A84' },
};

/**
 * Resultados que son «no se logró»: la tarjeta va en rojo. `PROMISE_BROKEN` está aunque no sea de llamada o
 * visita: viene de los desenlaces de la agenda y también es «no se logró».
 */
export const FAILED_RESULTS: ReadonlySet<string> = new Set(['NO_ANSWER', 'WRONG_NUMBER', 'NOT_FOUND', 'WRONG_ADDRESS', 'REFUSAL', 'PROMISE_BROKEN']);

const ACTIVITY_ICON: Record<string, string> = { CALL: '📞', VISIT: '📍', MESSAGE: '💬', PAYMENT: '💵', ASSIGNMENT: '👤' };

/** Icono y tono de una gestión: rojo si no se logró; si no, el del tipo (llamada/pago verde, visita violeta, mensaje turquesa, asignación ámbar, el resto azul). */
export function activityLook(type: string, result?: string | null): { tone: LookTone; icon: string } {
  const icon = ACTIVITY_ICON[type] ?? '📝';
  if (result && FAILED_RESULTS.has(result)) return { tone: 'red', icon };
  switch (type) {
    case 'CALL':
    case 'PAYMENT':
      return { tone: 'green', icon };
    case 'VISIT':
      return { tone: 'purple', icon };
    case 'MESSAGE':
      return { tone: 'teal', icon };
    case 'ASSIGNMENT':
      return { tone: 'amber', icon };
    default:
      return { tone: 'blue', icon };
  }
}

// ── Promesas ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cómo se llama y de qué color va cada estado de una promesa (el MISMO color que el panel).
 * 🔴 **Vencida sin cerrar es ámbar, no roja**: nadie registró qué pasó y pintarla de incumplida castigaría al deudor
 * por una gestión que el equipo no cerró. Sólo `BROKEN` (alguien dijo que no pagó) es roja.
 */
export const PROMISE_STATUS_META: Record<MoraPromiseStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Vigente', tone: 'warning' },
  OVERDUE: { label: 'Vencida sin cerrar', tone: 'warning' },
  KEPT: { label: 'Cumplida', tone: 'success' },
  BROKEN: { label: 'Incumplida', tone: 'danger' },
  EXECUTED: { label: 'Ejecutada', tone: 'neutral' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  RESCHEDULED: { label: 'Reagendada', tone: 'neutral' },
};

/**
 * El resumen de promesas, con la regla de `summarizePromises` (shared): el cumplimiento sólo cuenta las que tienen
 * desenlace; sin ninguna no hay porcentaje y se dice, no se muestra 0 %.
 */
export function promiseSummaryLines(promises: readonly MoraPromise[]): { summary: string; compliance: string; unresolved?: string } {
  const s = summarizePromises(promises);
  const made = s.made === 0 ? 'Sin promesas' : s.made === 1 ? '1 promesa' : `${s.made} promesas`;
  return {
    summary: `${made} · ${s.kept} cumplidas · ${s.broken} incumplidas`,
    compliance: s.complianceRate === undefined ? 'Cumplimiento: todavía no hay promesas cerradas' : `Cumplimiento ${Math.round(s.complianceRate * 100)} %`,
    unresolved:
      s.unresolved === 0
        ? undefined
        : s.unresolved === 1
          ? '1 promesa venció sin que nadie registrara qué pasó.'
          : `${s.unresolved} promesas vencieron sin que nadie registrara qué pasó.`,
  };
}

/** Los tipos de nota en español (las palabras del panel). */
export const NOTE_KIND_LABEL: Record<MoraNoteKind, string> = {
  INFO: 'Informativa',
  WARNING: 'Atención',
  IMPORTANT: 'Importante',
};
