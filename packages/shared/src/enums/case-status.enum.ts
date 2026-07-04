/** Estados del ciclo de vida de un caso de cobranza. */
export enum CaseStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  IN_NEGOTIATION = 'IN_NEGOTIATION',
  PROMISE_TO_PAY = 'PROMISE_TO_PAY',
  PAID = 'PAID',
  CLOSED = 'CLOSED',
  WRITTEN_OFF = 'WRITTEN_OFF',
}
