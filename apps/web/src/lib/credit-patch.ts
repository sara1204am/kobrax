import type { CreditDetail, PaymentFrequency, UpdateCreditPatch } from '@kobrax/shared';

export interface CreditForm {
  /** Texto: es lo que hay en el input. Vacío ≠ cero. */
  installmentAmount: string;
  frequency: PaymentFrequency;
  /** ISO date (YYYY-MM-DD) o vacío. */
  nextDueDate: string;
  notes: string;
}

const num = (s: string): number | undefined => {
  const n = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/**
 * Qué mandarle a `PATCH /credits/:id`: **sólo lo que cambió**.
 *
 * La API corre con `forbidNonWhitelisted`, así que reenviar la ficha entera es un 400. Y hay un
 * borde que decide solo: **vaciar la cuota no la borra**. Es plata congelada —es cómo se cobra este
 * crédito—, no un campo opcional; un input en blanco es alguien que lo limpió para escribirlo de
 * nuevo, no alguien pidiendo que el préstamo deje de tener cuota. Se ignora, y la vieja queda.
 *
 * Lo mismo con la fecha: vaciarla manda `undefined`, no una fecha vacía que la API rechazaría.
 */
export function creditPatch(credit: CreditDetail, form: CreditForm): UpdateCreditPatch {
  const patch: UpdateCreditPatch = {};

  const installment = num(form.installmentAmount);
  if (installment !== undefined && installment !== credit.installmentAmount) {
    patch.installmentAmount = installment;
  }
  if (form.frequency !== credit.frequency) patch.frequency = form.frequency;
  if (form.nextDueDate && form.nextDueDate !== (credit.nextDueDate ?? '')) {
    patch.nextDueDate = form.nextDueDate;
  }
  if (form.notes !== (credit.notes ?? '')) patch.notes = form.notes;

  return patch;
}

/** ¿Hay algo que mandar? Guardar sin tocar nada no llama a la red. */
export function hasCreditChanges(patch: UpdateCreditPatch): boolean {
  return Object.keys(patch).length > 0;
}
