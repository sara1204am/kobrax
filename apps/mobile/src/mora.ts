/**
 * La lista de mora del cobrador: filtrar, ordenar y armar la tarjeta. **Puro**, sin red ni React.
 *
 * 🔴 **La mora es por crédito y existe sin caso.** Por eso esto NO pasa por `groupPortfolio` (que agrupa
 * *casos* por cliente): con datos reales, 21 de 22 créditos en mora no tenían caso abierto y esa lista
 * sólo habría mostrado el que sí. La fuente es `GET /mora`, que ya viene acotado al cobrador.
 *
 * El teléfono sólo ordena y filtra lo que llegó. Qué es mora, cuánto se debe y qué prioridad tiene lo
 * decide el servidor (`packages/shared` + API).
 */
import { CasePriority, type MoraCreditListItem, type MoraNoteKind, type MoraPromiseStatus } from '@kobrax/shared';
import { money } from './agenda-form';
import { CASE_PRIORITY_LABEL } from './ui';
import type { BadgeTone } from './ui';

/** `cachedList` pide un `id`; el crédito es la identidad de la fila. */
export type MoraRow = MoraCreditListItem & { id: string };

export type MoraChip = 'all' | 'critical' | 'promise' | 'noAction';

/** Pasados estos días sin gestionar, el crédito entra al chip «Sin gestión». */
export const NO_ACTION_DAYS = 7;

export const MORA_CHIP_LABEL: Record<MoraChip, string> = {
  all: 'Todos',
  critical: 'Críticos',
  promise: 'Con promesa',
  noAction: `Sin gestión ${NO_ACTION_DAYS}d`,
};

const DAY_MS = 86_400_000;

/** Qué tan arriba va cada prioridad. Sin caso no hay prioridad: va al final de su tramo. */
const PRIORITY_RANK: Record<CasePriority, number> = {
  [CasePriority.CRITICAL]: 3,
  [CasePriority.HIGH]: 2,
  [CasePriority.MEDIUM]: 1,
  [CasePriority.LOW]: 0,
};

/** El servidor manda `MoraCreditListItem`; la fila le suma el `id` que pide el respaldo local. */
export function toMoraRows(items: MoraCreditListItem[]): MoraRow[] {
  return items.map((i) => ({ ...i, id: i.creditId }));
}

/** Días enteros desde la última gestión; `undefined` si nunca hubo (o no hay caso). */
export function daysSinceAction(row: MoraRow, asOf: Date): number | undefined {
  const at = row.case?.lastActionAt;
  if (!at) return undefined;
  return Math.max(0, Math.floor((asOf.getTime() - new Date(at).getTime()) / DAY_MS));
}

export function matchesMoraChip(row: MoraRow, chip: MoraChip, asOf: Date = new Date()): boolean {
  switch (chip) {
    case 'all':
      return true;
    case 'critical':
      return row.case?.priority === CasePriority.CRITICAL;
    case 'promise':
      return row.hasActivePromise;
    case 'noAction': {
      // Nunca gestionado también cuenta: es justo el crédito que nadie está mirando.
      const d = daysSinceAction(row, asOf);
      return d === undefined || d >= NO_ACTION_DAYS;
    }
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

/** Prioridad del caso primero, después más días de mora, después más saldo. */
export function sortMora(rows: MoraRow[]): MoraRow[] {
  return [...rows].sort((a, b) => {
    const pa = a.case ? PRIORITY_RANK[a.case.priority] : -1;
    const pb = b.case ? PRIORITY_RANK[b.case.priority] : -1;
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
}

/** Lo que `CaseCard` pinta para un crédito en mora. Una sola fuente para la tarjeta y su prueba. */
export function moraCardProps(row: MoraRow, asOf: Date = new Date()): MoraCardProps {
  const caption = [row.code ? `Crédito ${row.code}` : undefined, `${row.daysPastDue} ${row.daysPastDue === 1 ? 'día' : 'días'} de mora`]
    .filter(Boolean)
    .join(' · ');

  const since = daysSinceAction(row, asOf);
  const subtitle = row.hasActivePromise
    ? 'Promesa de pago vigente'
    : since === undefined
      ? 'Sin gestión todavía'
      : since === 0
        ? 'Gestionado hoy'
        : `Última gestión hace ${since} ${since === 1 ? 'día' : 'días'}`;

  // «Vencido si existe»: lo que realmente debe hoy; si el archivo no lo trajo, el saldo.
  const owed = row.overdueAmount ?? row.balance;

  // La prioridad es del caso. Sin caso no se inventa una: se dice que nadie lo abrió.
  const badge = row.case
    ? { label: CASE_PRIORITY_LABEL[row.case.priority], tone: priorityTone(row.case.priority) }
    : { label: 'Sin caso', tone: 'neutral' as BadgeTone };

  return { name: row.clientName ?? 'Sin nombre', caption, subtitle, amount: owed === undefined ? undefined : money(owed, row.currency), badge };
}

function priorityTone(p: CasePriority): BadgeTone {
  return p === CasePriority.CRITICAL ? 'danger' : p === CasePriority.HIGH ? 'warning' : 'neutral';
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
  STATUS_CHANGE: 'Cambio de estado',
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
