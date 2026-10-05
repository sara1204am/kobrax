/**
 * La lista de mora del cobrador: filtrar, ordenar y armar la tarjeta. **Puro**, sin red ni React.
 *
 * 🔴 **La mora es por crédito.** Por eso esto NO pasa por `groupPortfolio` (que agrupa créditos por
 * cliente): aquí cada fila es un crédito. La fuente es `GET /mora`, que ya viene acotado al cobrador.
 *
 * El teléfono sólo ordena y filtra lo que llegó. Qué es mora, cuánto se debe y qué prioridad tiene lo
 * decide el servidor (`packages/shared` + API).
 */
import type { CollectionPriority, MoraCreditListItem, MoraNoteKind, MoraPromiseStatus } from '@kobrax/shared';
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

export function filterMora(rows: MoraRow[], chip: MoraChip, query: string, asOf: Date = new Date()): MoraRow[] {
  return sortMora(rows.filter((r) => matchesMoraChip(r, chip, asOf) && matchesMoraSearch(r, query)));
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

/** Cómo se llama y de qué color va cada estado de una promesa. El estado lo calcula el servidor. */
export const PROMISE_STATUS_META: Record<MoraPromiseStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Vigente', tone: 'info' },
  OVERDUE: { label: 'Vencida', tone: 'danger' },
  KEPT: { label: 'Cumplida', tone: 'success' },
  BROKEN: { label: 'Incumplida', tone: 'danger' },
  EXECUTED: { label: 'Ejecutada', tone: 'success' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  RESCHEDULED: { label: 'Reagendada', tone: 'warning' },
};

export const NOTE_KIND_LABEL: Record<MoraNoteKind, string> = {
  INFO: 'Informativa',
  WARNING: 'Advertencia',
  IMPORTANT: 'Importante',
};

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  CALL: 'Llamada',
  VISIT: 'Visita',
  MESSAGE: 'Mensaje',
  NOTE: 'Nota',
  PAYMENT: 'Pago',
  ASSIGNMENT: 'Asignación',
};

const RESULT_LABEL: Record<string, string> = {
  CONTACTED: 'Contactado',
  NO_ANSWER: 'No contesta',
  NO_CONTACT: 'No contesta',
  WRONG_NUMBER: 'Número equivocado',
  NOT_FOUND: 'No estaba',
  WRONG_ADDRESS: 'Dirección equivocada',
  REFUSAL: 'Se negó a pagar',
  PROMISE_TO_PAY: 'Promesa de pago',
  PARTIAL_PAYMENT: 'Pago parcial',
  PAID: 'Pagó',
};

/** «Llamada · No contesta». Lo que el servidor mande y no se conozca se muestra tal cual, no se esconde. */
export function activityLine(a: { type: string; result?: string }): string {
  const type = ACTIVITY_TYPE_LABEL[a.type] ?? a.type;
  return a.result ? `${type} · ${RESULT_LABEL[a.result] ?? a.result}` : type;
}
