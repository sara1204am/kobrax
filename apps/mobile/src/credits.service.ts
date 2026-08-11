/**
 * Créditos (alta). Thin sobre `apiMutate`. La cuota viaja **congelada** (D1/D2): el móvil calcula el
 * panel con `quoteLoan` de shared y manda `installmentAmount`; la API no recalcula nada.
 */
import { apiMutate, apiQuery, type MutateResult, type QueryResult } from './api-client';

/**
 * Payload del alta de préstamo (§4.1/§4.2). `openCase` siempre true desde el móvil (§5.2).
 * **Vive en `@kobrax/shared`** desde F9 · W3: la supervisora da de alta el mismo préstamo desde
 * el panel web. Se re-exporta para no tocar a quien lo importaba de acá.
 */
export type { NewCreditInput } from '@kobrax/shared';
import type { CreditOrigin, NewCreditInput, PaymentFrequency } from '@kobrax/shared';

export interface CreatedCredit {
  id: string;
  outstandingBalance: number;
  currency: string;
}

/** Crea el préstamo; con `openCase` el server abre el caso y el recordatorio de agenda (§5.2). */
export function createCredit(input: NewCreditInput): Promise<MutateResult<CreatedCredit>> {
  return apiMutate<CreatedCredit>('/credits', 'POST', { openCase: true, origin: 'manual', ...input });
}

/**
 * Detalle del crédito para prellenar la edición (§5.4).
 * **Vive en `@kobrax/shared`** desde F9 · W3: la ficha del panel web lee el mismo contrato.
 */
export type { CreditDetail, CreditInstallmentDetail, UpdateCreditPatch } from '@kobrax/shared';
import type { CreditDetail, UpdateCreditPatch } from '@kobrax/shared';

export function getCredit(id: string): Promise<QueryResult<CreditDetail>> {
  return apiQuery<CreditDetail>(`/credits/${id}`);
}

export function updateCredit(id: string, patch: UpdateCreditPatch): Promise<MutateResult<CreditDetail>> {
  return apiMutate<CreditDetail>(`/credits/${id}`, 'PATCH', patch);
}
