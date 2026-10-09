import type { Payment, PaymentRequest } from '@prisma/client';

const num = (d: unknown): number => (d == null ? 0 : Number(d));

export function serializePayment(p: Payment, names?: ReadonlyMap<string, string>) {
  return {
    id: p.id,
    creditId: p.creditId,
    amount: num(p.amount),
    method: p.method,
    provider: p.provider ?? undefined,
    externalTransactionId: p.externalTransactionId ?? undefined,
    receiptNumber: p.receiptNumber ?? undefined,
    receiptUrl: p.receiptUrl ?? undefined, // comprobante subido (§5.4); no es PII
    paymentDate: p.paymentDate,
    registeredBy: p.registeredBy ?? undefined,
    // La visita en la que se cobró, si salió de una (F4/12).
    visitId: p.visitId ?? undefined,
    // Sólo el nombre (resuelto por el servidor): el cobrador lo lee sin tener `user:read`.
    registeredByName: p.registeredBy ? names?.get(p.registeredBy) : undefined,
    channel: p.channel,
    notes: p.notes ?? undefined,
    createdAt: p.createdAt,
  };
}

export function serializePaymentRequest(r: PaymentRequest) {
  return {
    id: r.id,
    creditId: r.creditId ?? undefined,
    clientId: r.clientId ?? undefined,
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
