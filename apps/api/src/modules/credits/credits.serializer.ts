import type { Arrear, Credit, CreditInstallment } from '@prisma/client';
import { balanceBasisOf, creditTotalToCollect, creditView, CreditOrigin, type ImportTrackedField } from '@kobrax/shared';

/** Etiquetas de concepto por defecto (las sobreescribe `account.configuration.creditLabels`). */
export const DEFAULT_CREDIT_LABELS: Record<string, string> = {
  principalAmount: 'Capital',
  interestRate: 'Tasa',
  outstandingBalance: 'Saldo',
};

const num = (d: unknown): number => (d == null ? 0 : Number(d));

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

export function serializeArrear(a: Arrear) {
  return {
    id: a.id,
    daysOverdue: a.daysOverdue,
    overdueAmount: num(a.overdueAmount),
    interest: num(a.interest),
    penalty: num(a.penalty),
    calculatedAt: a.calculatedAt,
  };
}

type CreditWithRelations = Credit & {
  installments?: CreditInstallment[];
  arrears?: Arrear[];
  /** Sólo en la ficha: si hay pagos, las condiciones ya no se redefinen (D13). */
  _count?: { payments?: number };
};

export function serializeCredit(
  credit: CreditWithRelations,
  labels: Record<string, string> = DEFAULT_CREDIT_LABELS,
) {
  // La ficha (§5.4) necesita cuota, frecuencia, próxima fecha y el candado del importado.
  // Misma función que el listado de casos y que el móvil: una sola regla, tres consumidores.
  const view = creditView({
    metadata: credit.metadata,
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
    daysPastDue: credit.daysPastDue,
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
    hasPayments: credit._count?.payments !== undefined ? credit._count.payments > 0 : undefined,
    installments: credit.installments?.map(serializeInstallment),
    arrears: credit.arrears?.map(serializeArrear),
  };
}
