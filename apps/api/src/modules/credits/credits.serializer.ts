import type { Credit, CreditInstallment, LatePolicyVersion } from '@prisma/client';
import {
  balanceBasisOf,
  calculateCredit,
  creditTotalToCollect,
  creditView,
  CreditOrigin,
  DEFAULT_ARREARS_METHOD,
  oldestUnpaid,
  priorPaidAmountOf,
  suggestedPaymentAmount,
  type CreditTerms,
  type ImportTrackedField,
  DEFAULT_REPORT_STALE_AFTER_DAYS,
  categoryForDays,
  isReportStale,
  moraSituation,
  type ArrearRange,
  type UpdatedPlan,
} from '@kobrax/shared';

/** Lo que sólo la ficha (`GET /credits/:id`) calcula: la situación y la categoría de mora (F4/08 · D1). */
export interface CreditMoraContext {
  /** ¿Hay un episodio de mora abierto? Es lo único que decide Al día / En mora. */
  hasOpenEpisode: boolean;
  /** Los rangos de la cuenta (una consulta por petición). Sin rangos no hay categoría. */
  categories: readonly (ArrearRange & { code: string; name: string; color: string | null })[];
}

/** Etiquetas de concepto por defecto (las sobreescribe `account.configuration.creditLabels`). */
export const DEFAULT_CREDIT_LABELS: Record<string, string> = {
  principalAmount: 'Capital',
  interestRate: 'Tasa',
  outstandingBalance: 'Saldo',
};

const num = (d: unknown): number => (d == null ? 0 : Number(d));
/** Una columna `DATE` como `YYYY-MM-DD` (sin hora: es una fecha de corte, no un instante). */
const isoDay = (d: Date | null | undefined): string | undefined => (d ? d.toISOString().slice(0, 10) : undefined);

export function serializeInstallment(i: CreditInstallment) {
  return {
    id: i.id,
    number: i.number,
    dueDate: i.dueDate,
    amount: num(i.amount),
    principal: num(i.principal),
    interest: num(i.interest),
    paidAmount: num(i.paidAmount),
    status: i.status,
    paidAt: i.paidAt ?? undefined,
  };
}

type CreditWithRelations = Credit & {
  installments?: CreditInstallment[];
  /** Sólo en la ficha: la política de mora con que nació el crédito (sellada, inmutable). */
  latePolicyVersion?: LatePolicyVersion | null;
  /** Sólo en la ficha: la activación explícita del interés moratorio (F3-e), si la hay. */
  lateActivation?: { startsOn: Date; reason: string; createdAt: Date } | null;
  /** Sólo en la ficha: si hay pagos, las condiciones ya no se redefinen (D13). */
  _count?: { payments?: number };
};

export function serializeCredit(
  credit: CreditWithRelations,
  labels: Record<string, string> = DEFAULT_CREDIT_LABELS,
  staleAfterDays: number = DEFAULT_REPORT_STALE_AFTER_DAYS,
  mora?: CreditMoraContext,
  /** Sólo la ficha: el plan actualizado (plan original + pagos imputados), de `loadCreditPlan`. */
  plan?: UpdatedPlan | null,
) {
  // Sólo con contexto (la ficha): `situation` del episodio abierto y `category` por días de mora (nunca se guarda;
  // ninguna si el crédito está al día —< 1 día— o ningún rango lo cubre).
  const writtenOff = credit.writtenOffAt != null;
  const situation = mora ? moraSituation({ hasOpenEpisode: mora.hasOpenEpisode, daysPastDue: credit.daysPastDue, writtenOffAt: credit.writtenOffAt }).situation : undefined;
  const cat = mora ? categoryForDays(credit.daysPastDue, mora.categories) : null;
  // La ficha (§5.4) necesita cuota, frecuencia, próxima fecha y el candado del importado.
  // Misma función que la lista de mora y que el móvil: una sola regla, tres consumidores.
  const view = creditView({
    metadata: credit.metadata,
    origin: credit.origin,
    installments: credit.installments?.map((i) => ({ dueDate: i.dueDate, amount: num(i.amount), status: i.status })),
  });
  // Importado: lo que el archivo nunca trajo (D9). Frecuencia y nº de cuotas no se inventan: la columna
  // guarda 0 («abierto») y el metadata cae a MONTHLY, y ninguno de los dos es cierto.
  const unknownFields = view.importMissing?.length ? view.importMissing : undefined;
  const unknown = (f: ImportTrackedField): boolean => unknownFields?.includes(f) ?? false;
  // 🔴 El importador nunca escribe el nº de cuotas: la columna queda en su default (1), y con él el
  // total por cobrar salía = una cuota. Vale también para los importados anteriores a la Fase 4.
  const imported = view.origin === CreditOrigin.IMPORT;
  const countUnknown = unknown('installmentsCount') || imported;
  // La frecuencia tampoco la escribe nunca: `readCreditMetadata` cae a MONTHLY. Y una cuota en 0 no es
  // una cuota (el alta exige > 0): es el relleno de algún archivo viejo.
  const frequencyUnknown = unknown('frequency') || imported;
  const installmentAmount = imported && !(view.installmentAmount && view.installmentAmount > 0) ? undefined : view.installmentAmount;
  return {
    id: credit.id,
    code: credit.code ?? undefined,
    typeCode: credit.typeCode ?? undefined,
    clientId: credit.clientId,
    branchId: credit.branchId ?? undefined,
    principalAmount: num(credit.principalAmount),
    outstandingBalance: num(credit.outstandingBalance),
    interestRate: num(credit.interestRate),
    currency: credit.currency,
    installmentsCount: countUnknown ? undefined : credit.installmentsCount,
    status: credit.status,
    // D1-a: el castigo es una condición aparte (`written_off_at`).
    writtenOff,
    writtenOffAt: credit.writtenOffAt ?? undefined,
    writtenOffReason: credit.writtenOffReason ?? undefined,
    daysPastDue: credit.daysPastDue,
    situation,
    category: cat ? { code: cat.code, name: cat.name, color: cat.color ?? undefined } : undefined,
    assignedManagerId: credit.assignedManagerId ?? undefined,
    disbursedAt: credit.disbursedAt ?? undefined,
    createdAt: credit.createdAt,
    updatedAt: credit.updatedAt,
    labels: { ...DEFAULT_CREDIT_LABELS, ...labels },
    installmentAmount,
    nextDueDate: view.nextDueDate,
    frequency: frequencyUnknown ? undefined : view.frequency,
    origin: view.origin,
    locked: view.locked, // candado de los campos financieros (§4.3)
    externalRef: view.externalRef,
    notes: view.notes,
    hasSchedule: view.hasSchedule,
    // Las condiciones con que se definió (F4/06): el detalle regenera el plan con el mismo motor.
    terms: view.terms,
    // D15: qué representa `outstandingBalance`, y el total contra el que se mide el progreso.
    balanceBasis: balanceBasisOf(view),
    totalToCollect: creditTotalToCollect({
      principalAmount: num(credit.principalAmount),
      installmentAmount,
      installmentsCount: countUnknown ? undefined : credit.installmentsCount,
      installments: credit.installments?.map((i) => ({ amount: num(i.amount) })),
      terms: view.terms,
    }),
    initialState: view.initialState,
    unknownFields,
    importedAt: view.importedAt,
    // Operación de una fuente externa (D1, D4, D9). Ausentes en los créditos de Kobrax.
    externalSource: credit.externalSource ?? undefined,
    externalId: credit.externalId ?? undefined,
    syncStatus: credit.syncStatus ?? undefined,
    absentSince: isoDay(credit.absentSince),
    reportedAsOf: isoDay(credit.reportedAsOf),
    // D9: pasado el umbral desde el corte, la mora y el saldo reportados ya no se presentan como de hoy.
    reportedStale: credit.syncStatus ? isReportStale(credit.reportedAsOf, new Date(), staleAfterDays) : undefined,
    reportStaleAfterDays: credit.syncStatus ? staleAfterDays : undefined,
    // Con plan, lo que se sugiere cobrar es el PRÓXIMO PAGO del plan actualizado (lo vencido, o lo que falta de la siguiente cuota), nunca más que el saldo.
    suggestedPaymentAmount: plan?.nextPayment ? Math.min(plan.nextPayment.amount, num(credit.outstandingBalance)) : suggestedPaymentAmount({
      external: view.locked,
      outstandingBalance: num(credit.outstandingBalance),
      installmentAmount,
      reportedPastDueAmount: view.pastDueAmount,
      installments: credit.installments?.map((i) => ({ number: i.number, amount: num(i.amount), paidAmount: num(i.paidAmount), status: i.status })),
    }),
    // D13: lo pagado antes de registrarlo; «Recuperado» lo descuenta.
    priorPaidAmount: priorPaidAmountOf(view.terms, view.initialState),
    // D20: cómo se cuenta la mora, desde cuándo (bancario) y qué cuota reclamar hoy.
    arrearsMethod: view.arrearsMethod ?? DEFAULT_ARREARS_METHOD,
    arrearsSince: view.arrearsSince,
    oldestUnpaid: oldestUnpaidOf(credit.installments, view.terms, view.nextDueDate),
    hasPayments: credit._count?.payments !== undefined ? credit._count.payments > 0 : undefined,
    installments: credit.installments?.map(serializeInstallment),
    plan: plan ?? undefined,
    // La política de mora con que nació el crédito: sellada, no cambia aunque la cuenta cambie la suya después.
    latePolicy: credit.latePolicyVersion
      ? {
          kind: credit.latePolicyVersion.kind,
          scope: credit.latePolicyVersion.scope,
          version: credit.latePolicyVersion.version,
          graceDays: credit.latePolicyVersion.graceDays,
          annualRate: credit.latePolicyVersion.annualRate != null ? Number(credit.latePolicyVersion.annualRate) : undefined,
          dayCount: credit.latePolicyVersion.dayCount ?? undefined,
          effectiveFrom: credit.latePolicyVersion.effectiveFrom,
        }
      : undefined,
    // F3-e: activación explícita del interés moratorio en un crédito que nació sin él (`undefined` fuera de la ficha, `null` si no tiene).
    lateActivation:
      credit.lateActivation === undefined
        ? undefined
        : credit.lateActivation
          ? { startsOn: credit.lateActivation.startsOn.toISOString().slice(0, 10), reason: credit.lateActivation.reason, createdAt: credit.lateActivation.createdAt }
          : null,
  };
}

/**
 * La cuota impaga más antigua, la que hay que reclamar (D20). Con cronograma guardado, la fila; sin él,
 * la próxima fecha, y su número sale del plan de las condiciones si coincide una fecha.
 */
function oldestUnpaidOf(
  rows: CreditInstallment[] | undefined,
  terms: CreditTerms | undefined,
  nextDueDate: string | undefined,
): { number?: number; dueDate: string } | undefined {
  if (rows && rows.length > 0) {
    const r = oldestUnpaid(rows);
    return r ? { number: r.number, dueDate: r.dueDate.toISOString().slice(0, 10) } : undefined;
  }
  if (!nextDueDate) return undefined;
  const due = nextDueDate.slice(0, 10);
  const number = terms ? calculateCredit(terms).schedule?.find((s) => s.dueDate === due)?.number : undefined;
  return { ...(number ? { number } : {}), dueDate: due };
}
