import type { Arrear, Credit, CreditInstallment } from '@prisma/client';
import { creditView } from '@kobrax/shared';

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
    installmentsCount: credit.installmentsCount,
    status: credit.status,
    daysPastDue: credit.daysPastDue,
    assignedManagerId: credit.assignedManagerId ?? undefined,
    disbursedAt: credit.disbursedAt ?? undefined,
    createdAt: credit.createdAt,
    updatedAt: credit.updatedAt,
    labels: { ...DEFAULT_CREDIT_LABELS, ...labels },
    installmentAmount: view.installmentAmount,
    nextDueDate: view.nextDueDate,
    frequency: view.frequency,
    origin: view.origin,
    locked: view.locked, // candado de los campos financieros (§4.3)
    externalRef: view.externalRef,
    notes: view.notes,
    hasSchedule: view.hasSchedule,
    installments: credit.installments?.map(serializeInstallment),
    arrears: credit.arrears?.map(serializeArrear),
  };
}
