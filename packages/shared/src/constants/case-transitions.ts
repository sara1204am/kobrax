import { CaseStatus } from '../enums/case-status.enum.js';

/**
 * Transiciones válidas de estado de un caso. No se pueden saltar estados
 * arbitrariamente: la API debe validar contra este mapa (error CASE_002).
 */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.PENDING]: [CaseStatus.ACTIVE],
  [CaseStatus.ACTIVE]: [
    CaseStatus.IN_NEGOTIATION,
    CaseStatus.PROMISE_TO_PAY,
    CaseStatus.PAID,
    CaseStatus.WRITTEN_OFF,
  ],
  [CaseStatus.IN_NEGOTIATION]: [CaseStatus.PROMISE_TO_PAY, CaseStatus.ACTIVE, CaseStatus.WRITTEN_OFF],
  [CaseStatus.PROMISE_TO_PAY]: [CaseStatus.PAID, CaseStatus.ACTIVE],
  [CaseStatus.PAID]: [CaseStatus.CLOSED],
  [CaseStatus.CLOSED]: [],
  [CaseStatus.WRITTEN_OFF]: [],
};

/** True si `to` es un estado alcanzable desde `from`. */
export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}
