import type { Payment, PaymentRequest } from '@prisma/client';

const num = (d: unknown): number => (d == null ? 0 : Number(d));

export function serializePayment(p: Payment) {
  return {
    id: p.id,
    creditId: p.creditId,
    caseId: p.caseId ?? undefined,
    amount: num(p.amount),
    method: p.method,
    provider: p.provider ?? undefined,
    externalTransactionId: p.externalTransactionId ?? undefined,
    receiptNumber: p.receiptNumber ?? undefined,
    paymentDate: p.paymentDate,
    registeredBy: p.registeredBy ?? undefined,
    createdAt: p.createdAt,
  };
}

export function serializePaymentRequest(r: PaymentRequest) {
  return {
    id: r.id,
    creditId: r.creditId ?? undefined,
    clientId: r.clientId ?? undefined,
    caseId: r.caseId ?? undefined,
    amount: num(r.amount),
    method: r.method,
    status: r.status,
    reference: r.reference ?? undefined,
    qrPayload: r.qrPayload ?? undefined,
    url: r.url ?? undefined,
    expiresAt: r.expiresAt ?? undefined,
    paidPaymentId: r.paidPaymentId ?? undefined,
    createdAt: r.createdAt,
  };
}
