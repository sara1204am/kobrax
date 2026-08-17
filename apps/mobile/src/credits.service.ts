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
export type { CreditDetail, CreditInstallmentDetail, CreditOption, UpdateCreditPatch } from '@kobrax/shared';
import type { CreditDetail, CreditOption, UpdateCreditPatch } from '@kobrax/shared';

export function getCredit(id: string): Promise<QueryResult<CreditDetail>> {
  return apiQuery<CreditDetail>(`/credits/${id}`);
}

export function updateCredit(id: string, patch: UpdateCreditPatch): Promise<MutateResult<CreditDetail>> {
  return apiMutate<CreditDetail>(`/credits/${id}`, 'PATCH', patch);
}

/**
 * «Este préstamo está en mora», dicho por el cobrador — y **la cobranza se abre en el acto**.
 *
 * Es el caso del que presta sin cronograma: no hay fecha que se venza sola, así que si nadie lo dice
 * el préstamo nunca entra a Mora. Los días son opcionales; el server guarda **desde cuándo**, no
 * cuántos, para que el número envejezca solo.
 *
 * Idempotente: mandarla dos veces vuelve a escribir la misma fecha y no abre una segunda cobranza.
 * Por eso se puede encolar (`arrears.mark`).
 */
export function markArrears(creditId: string, days?: number): Promise<MutateResult<CreditDetail>> {
  return apiMutate<CreditDetail>(`/credits/${creditId}/arrears`, 'POST', days != null ? { days } : {});
}

/** Cómo queda el préstamo al ponerlo al día. La regla de cuáles hay vive en el DTO de la API. */
export interface ClearArrearsInput {
  mode: 'next_period' | 'date' | 'none';
  /** Obligatoria con `mode: 'date'`, y futura. */
  date?: string;
}

/**
 * Poner al día. **Mueve la fecha de vencimiento**, no baja un número: con la fecha vencida el
 * trabajo diario del servidor volvería a marcarlo esta misma noche.
 *
 * Idempotente con `date` y con `none` (escriben un valor fijo). Con `next_period` **no lo es**:
 * mandarla dos veces avanza dos períodos. Por eso la cola guarda la fecha ya resuelta y no el modo.
 */
export function clearArrears(creditId: string, input: ClearArrearsInput): Promise<MutateResult<CreditDetail>> {
  return apiMutate<CreditDetail>(`/credits/${creditId}/arrears/clear`, 'POST', input);
}

/**
 * Los préstamos de un cliente, para elegir a cuál respalda un garante o una garantía.
 *
 * Trae `CreditOption` y no la ficha entera: para distinguir dos préstamos del mismo deudor alcanza
 * con su código y su saldo, y pedir el cronograma completo de cada uno para dibujar una lista de dos
 * ítems es traerse la base al teléfono.
 */
export function listClientCredits(clientId: string): Promise<QueryResult<CreditOption[]>> {
  return apiQuery<CreditOption[]>(`/credits?clientId=${clientId}&limit=100`);
}
