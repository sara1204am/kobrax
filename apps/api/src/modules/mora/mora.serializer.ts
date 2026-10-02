import {
  arrearsSourceOf,
  creditView,
  DEFAULT_REPORT_STALE_AFTER_DAYS,
  isReportStale,
  readCreditMetadata,
  suggestedPaymentAmount,
  type ImportTrackedField,
  type MoraCaseSummary,
  type MoraCreditListItem,
  type OverdueSource,
} from '@kobrax/shared';
import { clientDisplayName } from '../clients/clients.serializer';

const TERMINAL = ['CLOSED', 'WRITTEN_OFF'];

/** Lo que `MoraService` trae de Prisma por crédito. */
export interface MoraCreditRow {
  id: string;
  code: string | null;
  clientId: string;
  currency: string;
  outstandingBalance: unknown;
  principalAmount: unknown;
  daysPastDue: number;
  metadata: unknown;
  origin: string | null;
  externalSource: string | null;
  syncStatus: string | null;
  reportedAsOf: Date | null;
  branchId: string | null;
  branch?: { name: string } | null;
  client: { firstName: string | null; lastName: string | null; businessName: string | null };
  installments: { number: number; dueDate: Date; amount: unknown; paidAmount: unknown; status: string }[];
  /** A lo sumo uno: el caso abierto. */
  cases: {
    id: string;
    status: string;
    priority: string;
    priorityPinnedAt: Date | null;
    assigneeId: string | null;
    slaDueAt: Date | null;
    lastActionAt: Date | null;
    activities: { type: string; result: string | null }[];
  }[];
  /** El último pago registrado en Kobrax (a lo sumo uno). */
  payments: { paymentDate: Date }[];
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const startOfTodayUtc = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Σ de lo que falta de cada cuota cuyo vencimiento ya pasó (`dueDate < hoy`) y no está pagada.
 * Sólo tiene sentido con cronograma: sin cuotas no hay nada que sumar y quien llama no debe llamarla.
 */
export function overdueFromSchedule(installments: MoraCreditRow['installments'], now: Date): number {
  const today = startOfTodayUtc(now).getTime();
  let sum = 0;
  for (const i of installments) {
    if (i.status === 'PAID' || i.dueDate.getTime() >= today) continue;
    sum += Math.max(Number(i.amount) - Number(i.paidAmount ?? 0), 0);
  }
  return Math.round(sum * 100) / 100;
}

export function serializeMoraCredit(
  c: MoraCreditRow,
  opts: { now: Date; staleAfterDays?: number; hasActivePromise: boolean },
): MoraCreditListItem {
  const { now } = opts;
  const meta = readCreditMetadata(c.metadata, c.origin);
  const view = creditView({
    metadata: c.metadata,
    origin: c.origin,
    installments: c.installments.map((i) => ({ dueDate: i.dueDate, amount: Number(i.amount), status: i.status })),
  });
  const arrearsSource = arrearsSourceOf(meta);
  const unknown = (f: ImportTrackedField): boolean => meta.importMissing?.includes(f) ?? false;

  /*
   * 🔴 **Lo realmente vencido, no el saldo.** Importado: lo que dijo el archivo (si lo trajo). Propio con
   * cronograma y mora calculada: lo que falta de las cuotas ya vencidas. Cualquier otro caso —mora
   * marcada a mano, crédito sin cronograma— no tiene un monto vencido que se pueda afirmar: queda sin dato
   * y la pantalla muestra «—». Un 0 acá diría «no debe nada vencido» de alguien con 40 días de mora.
   */
  let overdueAmount: number | undefined;
  let overdueSource: OverdueSource | undefined;
  if (arrearsSource === 'IMPORTED') {
    if (meta.pastDueAmount !== undefined) {
      overdueAmount = meta.pastDueAmount;
      overdueSource = 'REPORTED';
    }
  } else if (arrearsSource === 'CALCULATED' && c.installments.length > 0) {
    overdueAmount = overdueFromSchedule(c.installments, now);
    overdueSource = 'SCHEDULE';
  }

  // El último pago: el mayor entre lo que reportó el archivo y lo cobrado en Kobrax.
  const lastPayments = [meta.lastPaymentDate, c.payments[0] ? iso(c.payments[0].paymentDate) : undefined].filter(
    (v): v is string => !!v,
  );
  const lastPaymentAt = lastPayments.length > 0 ? lastPayments.sort().at(-1) : undefined;

  const open = c.cases[0];
  const activity = open?.activities[0];
  const caseSummary: MoraCaseSummary | undefined = open
    ? {
        id: open.id,
        status: open.status as MoraCaseSummary['status'],
        priority: open.priority as MoraCaseSummary['priority'],
        priorityPinned: open.priorityPinnedAt !== null,
        assigneeId: open.assigneeId ?? undefined,
        slaDueAt: open.slaDueAt?.toISOString(),
        isOverdue: !!open.slaDueAt && !TERMINAL.includes(open.status) && open.slaDueAt.getTime() < now.getTime(),
        lastActionAt: open.lastActionAt?.toISOString(),
      }
    : undefined;

  return {
    creditId: c.id,
    code: c.code ?? undefined,
    clientId: c.clientId,
    clientName: clientDisplayName(c.client),
    currency: c.currency,
    balance: unknown('outstandingBalance') ? undefined : Number(c.outstandingBalance),
    principalAmount: unknown('principalAmount') ? undefined : Number(c.principalAmount),
    installmentAmount: view.installmentAmount,
    nextDueDate: view.nextDueDate,
    // Con qué arranca el formulario de pago: la misma regla que el móvil (`suggestedPaymentAmount` de shared).
    suggestedPaymentAmount: unknown('outstandingBalance')
      ? undefined
      : suggestedPaymentAmount({
          external: view.locked,
          outstandingBalance: Number(c.outstandingBalance),
          installmentAmount: view.installmentAmount,
          reportedPastDueAmount: view.pastDueAmount,
          installments: c.installments.map((i) => ({ number: i.number, amount: Number(i.amount), paidAmount: Number(i.paidAmount ?? 0), status: i.status })),
        }),
    overdueAmount,
    overdueSource,
    lastPaymentAt,
    daysPastDue: c.daysPastDue,
    arrearsSource,
    // Un importado sólo trae días: no se estima el inicio restándolos al corte.
    moraSince: arrearsSource === 'IMPORTED' ? undefined : (meta.moraSince ?? meta.arrearsSince),
    externalSource: c.externalSource ?? undefined,
    syncStatus: (c.syncStatus ?? undefined) as MoraCreditListItem['syncStatus'],
    reportedAsOf: c.reportedAsOf ? iso(c.reportedAsOf) : undefined,
    reportedStale: c.syncStatus
      ? isReportStale(c.reportedAsOf, now, opts.staleAfterDays ?? DEFAULT_REPORT_STALE_AFTER_DAYS)
      : undefined,
    reportedStatus: meta.reportedStatus,
    branchId: c.branchId ?? undefined,
    branchName: c.branch?.name,
    case: caseSummary,
    lastActivityType: activity?.type,
    lastActivityResult: activity?.result ?? undefined,
    hasActivePromise: opts.hasActivePromise,
  };
}
