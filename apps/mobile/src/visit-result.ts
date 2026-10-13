/**
 * Las reglas del sheet de resultado (Rutas S5 · RT-6): qué variantes hay, qué escribe cada una y
 * cuándo se puede guardar. Puras, sin React ni red — la pantalla sólo despacha y pinta.
 *
 * La validación de `details` NO se reescribe acá: la decide `validateVisitDetails` de
 * `@kobrax/shared`, el mismo validador que corre el server.
 */
import { VisitOutcome, validateVisitDetails } from '@kobrax/shared';

/** Las 6 tarjetas del mockup, en su orden. */
export type VariantKey = 'PAID' | 'PROMISE' | 'NO_ANSWER' | 'NO_CONTACT_VISIT' | 'WRONG_ADDRESS' | 'SPECIAL';

export interface VariantMeta {
  key: VariantKey;
  icon: string;
  title: string;
  /** Texto del botón que confirma. */
  cta: string;
  outcome: VisitOutcome;
  /** Tono del CTA — el mockup usa un color por variante. */
  tone: 'success' | 'warning' | 'danger' | 'navy' | 'purple' | 'muted';
}

export const VISIT_VARIANTS: readonly VariantMeta[] = [
  { key: 'PAID', icon: '✅', title: 'Cobrado', cta: 'Confirmar cobro', outcome: VisitOutcome.PAID, tone: 'success' },
  { key: 'PROMISE', icon: '🤝', title: 'Promesa de pago', cta: 'Registrar promesa', outcome: VisitOutcome.PROMISE_TO_PAY, tone: 'warning' },
  { key: 'NO_ANSWER', icon: '📵', title: 'No contesta', cta: 'Registrar', outcome: VisitOutcome.NO_CONTACT, tone: 'warning' },
  { key: 'NO_CONTACT_VISIT', icon: '🚶', title: 'Visita sin contacto', cta: 'Finalizar visita', outcome: VisitOutcome.NO_CONTACT, tone: 'muted' },
  { key: 'WRONG_ADDRESS', icon: '📍', title: 'Dirección incorrecta', cta: 'Reportar error', outcome: VisitOutcome.WRONG_ADDRESS, tone: 'danger' },
  { key: 'SPECIAL', icon: '✳️', title: 'Gestión especial', cta: 'Guardar gestión', outcome: VisitOutcome.SPECIAL, tone: 'purple' },
] as const;

export function variantMeta(key: VariantKey): VariantMeta {
  return VISIT_VARIANTS.find((v) => v.key === key)!;
}

/** Lo que el cobrador cargó en el sheet. Todo texto: el parseo pasa por acá. */
export interface ResultForm {
  amount: string;
  paymentMethodCode: string;
  promiseDate: string;
  channel: 'CALL' | 'DOOR';
  noticeLeft: boolean;
  categoryCode: string;
  notes: string;
  /**
   * La foto de la visita. Con señal se sube al tomarla y quedan `url`+`hash`; **sin señal queda
   * sólo `local`**, la ruta del archivo en el teléfono, y la sube el motor de sync al drenar.
   * Que no haya red no puede impedir sacar la foto: es la evidencia de que estuvo ahí.
   */
  photo?: { url?: string; hash?: string; local?: { uri: string; mimeType?: string } };
}

export function initialResult(todayIso: string): ResultForm {
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

/**
 * Qué avisarle al cobrador cuando la visita SÍ se registró pero algo posterior falló (la foto, el
 * pago, la promesa). `null` = salió todo bien y la pantalla puede navegar.
 *
 * Vive acá y no en la pantalla porque es la regla que decide si se navega, y navegar de más fue
 * exactamente el bug: los tres avisos se pintaban con `setError` y `router.replace` corría igual,
 * así que la pantalla se desmontaba antes de mostrarlos. Un pago que no se guardó desaparecía sin
 * que nadie se enterara — el cobrador ya había cobrado el efectivo.
 */
export function postVisitWarning(failed: string[], queued: string[] = []): string | null {
  if (failed.length === 0 && queued.length === 0) return null;
  // `queued`: lo que no salió pero QUEDÓ guardado en el teléfono y sube solo — se avisa igual (el cobrador
  // tiene que saber que todavía no llegó), pero sin pedirle que lo anote: no se perdió.
  const guardado =
    queued.length > 0 ? `${queued.join(' y ')} quedó guardado en el teléfono y se sube solo cuando haya señal.` : '';
  if (failed.length === 0) return `La visita quedó registrada; ${guardado}`;
  const perdido = `La visita quedó registrada, pero ${failed.join(' y ')}. Anotalo y avisá a tu supervisor.`;
  return guardado ? `${perdido} Además, ${guardado}` : perdido;
}

/** El `details` que viaja al server, por variante. Lo que no corresponde no se manda. */
export function buildDetails(key: VariantKey, f: ResultForm): Record<string, unknown> {
  if (key === 'NO_ANSWER') return { channel: f.channel };
  // La visita sin contacto es siempre en la puerta: el cobrador fue hasta el domicilio.
  if (key === 'NO_CONTACT_VISIT') return { channel: 'DOOR', noticeLeft: f.noticeLeft };
  if (key === 'SPECIAL') return { categoryCode: f.categoryCode };
  return {};
}

/**
 * ¿Se puede guardar? Se apoya en el validador compartido para los campos propios y agrega lo que es
 * de esta pantalla (el monto, que no viaja en `details` sino al endpoint de pagos o de agenda).
 */
export function canSubmitResult(key: VariantKey, f: ResultForm, maxAmount?: number): boolean {
  const meta = variantMeta(key);
  if (!validateVisitDetails(meta.outcome, buildDetails(key, f)).ok) return false;

  if (key === 'PAID') {
    const n = Number(f.amount);
    // El cobro no puede ser cero ni superar el saldo del crédito de ESTA parada.
    return n > 0 && (maxAmount == null || n <= maxAmount + 0.005);
  }
  if (key === 'PROMISE') {
    return Number(f.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.promiseDate);
  }
  // La dirección incorrecta pide explicar qué pasó: sin eso nadie sabe qué corregir.
  if (key === 'WRONG_ADDRESS') return f.notes.trim().length > 0;
  return true;
}

/**
 * Hasta cuánto se puede cobrar en la parada. `undefined` = sin tope.
 *
 * 🔴 **Un crédito de fuente externa (PSF) no tiene tope** (D3). Su saldo es el que reportó el banco a
 * su fecha de corte, no uno que Kobrax lleve: el deudor puede estar pagando además cargos o cuotas
 * que el reporte todavía no refleja, y el pago no baja ese saldo. Topearlo con él rechazaba en la
 * puerta un cobro que la ficha del cliente y la API aceptan.
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

/**
 * La cuota que el cliente debe pagar, para ofrecerla («Usar este monto»). Solo si la API la calculó y es positiva:
 * nunca se inventa. No se precarga el campo a ciegas: el cobrador decide.
 */
export function installmentHint(
  stop: { suggestedPaymentAmount?: number; nextDueDate?: string } | null | undefined,
): { amount: number; dueLabel?: string } | null {
  const amount = stop?.suggestedPaymentAmount;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const due = stop?.nextDueDate;
  const dueLabel = due && /^\d{4}-\d{2}-\d{2}/.test(due) ? `${due.slice(8, 10)}/${due.slice(5, 7)}` : undefined;
  return { amount, ...(dueLabel ? { dueLabel } : {}) };
}
