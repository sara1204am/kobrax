/**
 * Créditos (alta). Thin sobre `apiMutate`. La cuota viaja **congelada** (D1/D2): el móvil calcula el
 * panel con `quoteLoan` de shared y manda `installmentAmount`; la API no recalcula nada.
 */
import type { CreditOrigin, PaymentFrequency } from '@kobrax/shared';
import { apiMutate, type MutateResult } from './api-client';

/** Payload del alta de préstamo (§4.1/§4.2). `openCase` siempre true desde el móvil (§5.2). */
export interface NewCreditInput {
  clientId: string;
  principalAmount: number;
  installmentAmount: number; // cuota congelada (Modo A directa, Modo B calculada y editada)
  frequency: PaymentFrequency;
  nextDueDate: string; // ISO date (YYYY-MM-DD)
  installmentsCount?: number; // vacío = préstamo abierto (§4.1)
  interestRate?: number; // informativo (§4.2), no recalcula la cuota
  outstandingBalance?: number; // "ya está en curso" (§4.1)
  daysPastDue?: number; // "ya está en curso"
  notes?: string;
  origin?: CreditOrigin;
  openCase?: boolean;
}

export interface CreatedCredit {
  id: string;
  outstandingBalance: number;
  currency: string;
}

/** Crea el préstamo; con `openCase` el server abre el caso y el recordatorio de agenda (§5.2). */
export function createCredit(input: NewCreditInput): Promise<MutateResult<CreatedCredit>> {
  return apiMutate<CreatedCredit>('/credits', 'POST', { openCase: true, origin: 'manual', ...input });
}
