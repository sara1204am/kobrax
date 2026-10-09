/**
 * Las reglas de «registrar el resultado de una visita» (Rutas S5 · RT-6): qué variantes hay, qué escribe cada una y
 * cuándo se puede guardar. Puras, sin React ni red.
 *
 * 🔴 **Salieron del móvil (F4/12) para que el panel registre una gestión con LAS MISMAS reglas.** Las dos pantallas
 * deciden igual qué variante es un cobro, cuánto se puede cobrar y cuándo una gestión está completa; lo que cada una
 * pinta (íconos, textos, colores) sigue siendo suyo.
 *
 * La validación de `details` NO se reescribe acá: la decide `validateVisitDetails`, el mismo validador que corre la API.
 */
import { VisitOutcome } from '../enums/visit-outcome.enum.js';
import { validateVisitDetails } from '../validation/visit-details.js';

/** Las 6 variantes, en el orden en que se ofrecen. */
export const VISIT_VARIANT_KEYS = ['PAID', 'PROMISE', 'NO_ANSWER', 'NO_CONTACT_VISIT', 'WRONG_ADDRESS', 'SPECIAL'] as const;
export type VariantKey = (typeof VISIT_VARIANT_KEYS)[number];

/** El resultado que se guarda en la visita por cada variante. Dos variantes distintas pueden compartirlo (no contesta / sin contacto). */
export const VARIANT_OUTCOME: Record<VariantKey, VisitOutcome> = {
  PAID: VisitOutcome.PAID,
  PROMISE: VisitOutcome.PROMISE_TO_PAY,
  NO_ANSWER: VisitOutcome.NO_CONTACT,
  NO_CONTACT_VISIT: VisitOutcome.NO_CONTACT,
  WRONG_ADDRESS: VisitOutcome.WRONG_ADDRESS,
  SPECIAL: VisitOutcome.SPECIAL,
};

/** Lo que se cargó en el formulario. Todo texto: el parseo pasa por acá. */
export interface VisitResultForm {
  amount: string;
  paymentMethodCode: string;
  promiseDate: string;
  channel: 'CALL' | 'DOOR';
  noticeLeft: boolean;
  categoryCode: string;
  notes: string;
}

export function initialVisitResult(todayIso: string): VisitResultForm {
  return {
    amount: '',
    paymentMethodCode: 'CASH',
    promiseDate: todayIso,
    channel: 'CALL',
    noticeLeft: false,
    categoryCode: '',
    notes: '',
  };
}

/** El `details` que viaja a la API, por variante. Lo que no corresponde no se manda. */
export function buildVisitDetails(key: VariantKey, f: VisitResultForm): Record<string, unknown> {
  if (key === 'NO_ANSWER') return { channel: f.channel };
  // La visita sin contacto es siempre en la puerta: se fue hasta el domicilio.
  if (key === 'NO_CONTACT_VISIT') return { channel: 'DOOR', noticeLeft: f.noticeLeft };
  if (key === 'SPECIAL') return { categoryCode: f.categoryCode };
  return {};
}

/**
 * ¿Se puede guardar? Se apoya en el validador compartido para los campos propios y agrega lo que es del formulario (el
 * monto, que no viaja en `details` sino al endpoint de pagos o de agenda).
 */
export function canSubmitVisitResult(key: VariantKey, f: VisitResultForm, maxAmount?: number): boolean {
  if (!validateVisitDetails(VARIANT_OUTCOME[key], buildVisitDetails(key, f)).ok) return false;

  if (key === 'PAID') {
    const n = Number(f.amount);
    // El cobro no puede ser cero ni superar el saldo del crédito de ESTA parada.
    return n > 0 && (maxAmount == null || n <= maxAmount + 0.005);
  }
  if (key === 'PROMISE') return Number(f.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.promiseDate);
  // La dirección incorrecta pide explicar qué pasó: sin eso nadie sabe qué corregir.
  if (key === 'WRONG_ADDRESS') return f.notes.trim().length > 0;
  return true;
}

/**
 * Hasta cuánto se puede cobrar en la parada. `undefined` = sin tope.
 *
 * 🔴 **Un crédito de fuente externa (PSF) no tiene tope** (D3): su saldo es el que reportó el banco a su fecha de corte,
 * no uno que Kobrax lleve, y un pago no lo baja. Topearlo con él rechazaba en la puerta un cobro que la ficha del
 * cliente y la API aceptan.
 */
export function paymentCap(stop: { overdueAmount?: number; externalSource?: string } | null | undefined): number | undefined {
  if (!stop || stop.externalSource) return undefined;
  return stop.overdueAmount;
}

/** Si el monto cubre el saldo es PAID; si no, fue un pago parcial. */
export function paymentOutcome(amount: number, outstanding?: number): VisitOutcome {
  if (outstanding == null) return VisitOutcome.PAID;
  return amount + 0.005 >= outstanding ? VisitOutcome.PAID : VisitOutcome.PARTIAL_PAYMENT;
}
