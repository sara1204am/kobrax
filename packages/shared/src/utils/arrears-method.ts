/**
 * Días de mora según el método del crédito (F4/06 · D20). Función pura: la usan el alta, el pago, el
 * trabajo diario y la edición, así que un mismo crédito no puede tener dos moras según quién pregunte.
 *
 *  · `oldest_unpaid` (default) — desde el vencimiento de la cuota impaga más antigua. Pagar la más
 *    atrasada baja la mora. Es lo que el sistema hacía siempre: nada existente cambia.
 *  · `first_default` (bancario) — desde el **primer atraso**: la fecha se fija la primera vez que una
 *    cuota queda vencida y no se mueve mientras siga habiendo atraso, aunque pague algunas. Vuelve a 0
 *    sólo cuando no queda ninguna cuota vencida; ahí la fecha se borra.
 *
 * Ejemplo: cuotas 4 (12 abr) y 5 (12 may) impagas, hoy 20 may → 38 días en los dos. Paga la 4:
 * `oldest_unpaid` → 8 días (desde la 5); `first_default` → 38 días (sigue desde el 12 abr).
 */
import { ArrearsMethod, DEFAULT_ARREARS_METHOD } from '../enums/credit.enum.js';
import { arrearsFromDueDate } from './loan.js';
import { registeredState } from './credit-edit.js';
import { calculateCredit, type CreditTerms } from './credit-engine.js';

export interface ArrearsReading {
  daysPastDue: number;
  /** YYYY-MM-DD del primer atraso (sólo `first_default` y en mora). `undefined` = borrarla. */
  arrearsSince: string | undefined;
}

const isoDay = (d: Date | string): string => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export function arrearsByMethod(p: {
  method?: ArrearsMethod;
  /** Vencimiento de la cuota impaga más antigua (con cronograma) o la próxima fecha (sin él). */
  oldestUnpaidDue: Date | string | null | undefined;
  /** La fecha de primer atraso guardada, si la hay. */
  arrearsSince?: string;
  balance: number;
  asOf: Date;
}): ArrearsReading {
  return withArrearsMethod({ ...p, baseDays: arrearsFromDueDate(p.oldestUnpaidDue, p.balance, p.asOf) });
}

/**
 * El método aplicado sobre una mora ya calculada «a la de siempre» (`baseDays`, desde la cuota impaga
 * más antigua). Lo usa el trabajo diario, que para los créditos con cronograma calcula la base con
 * `computeArrears` (con sus días de gracia): así el método de siempre queda exactamente igual.
 */
export function withArrearsMethod(p: {
  baseDays: number;
  method?: ArrearsMethod;
  oldestUnpaidDue: Date | string | null | undefined;
  arrearsSince?: string;
  asOf: Date;
}): ArrearsReading {
  // Al día (o saldado): no hay mora, y el primer atraso se olvida.
  if (p.baseDays <= 0 || !p.oldestUnpaidDue) return { daysPastDue: 0, arrearsSince: undefined };
  if ((p.method ?? DEFAULT_ARREARS_METHOD) === ArrearsMethod.OLDEST_UNPAID) return { daysPastDue: p.baseDays, arrearsSince: undefined };

  const since = p.arrearsSince ?? isoDay(p.oldestUnpaidDue);
  const sinceDays = Math.floor((p.asOf.getTime() - new Date(`${since}T00:00:00Z`).getTime()) / 86_400_000);
  return { daysPastDue: Math.max(p.baseDays, sinceDays), arrearsSince: since };
}

/** Cómo queda un crédito al registrarlo con cuotas ya pagadas (D13 + D20): lo que muestra el panel del alta. */
export interface RegistrationSituation {
  paid: number;
  total: number;
  outstanding: number;
  next: { number: number; dueDate: string };
  daysPastDue: number;
  /** Desde cuándo corre la mora (la primera cuota impaga), si está en mora. */
  arrearsSince?: string;
}

/**
 * La situación de un crédito con `paid` cuotas pagadas antes de registrarlo, hoy: la misma regla que
 * aplica la API al guardar (`registeredState` + el método de mora). `null` si el plan no está completo.
 * Al registrar, los dos métodos dan lo mismo: la mora corre desde la primera cuota impaga (k+1).
 */
export function registrationSituation(terms: CreditTerms, paid: number, method: ArrearsMethod | undefined, asOf: Date): RegistrationSituation | null {
  const schedule = calculateCredit(terms).schedule;
  if (!schedule || schedule.length === 0) return null;
  const reg = registeredState(terms, paid > 0 ? { paidInstallments: paid, daysPastDue: 0 } : undefined);
  if (!reg.ok) return null;
  const reading = arrearsByMethod({ method, oldestUnpaidDue: reg.nextDueDate, balance: reg.outstandingBalance, asOf });
  return {
    paid,
    total: schedule.length,
    outstanding: reg.outstandingBalance,
    next: { number: paid + 1, dueDate: reg.nextDueDate },
    daysPastDue: reading.daysPastDue,
    ...(reading.daysPastDue > 0 ? { arrearsSince: reading.arrearsSince ?? reg.nextDueDate } : {}),
  };
}

/** El método por defecto de una cuenta, de su `settings` (JSON de la base). Cualquier otra cosa → el de siempre. */
export function arrearsMethodOf(settings: unknown): ArrearsMethod {
  const raw = (settings as { arrearsMethod?: unknown } | null)?.arrearsMethod;
  return raw === ArrearsMethod.FIRST_DEFAULT ? ArrearsMethod.FIRST_DEFAULT : DEFAULT_ARREARS_METHOD;
}

/** La cuota impaga más antigua de un cronograma guardado, o `null` si no queda ninguna. */
export function oldestUnpaid<T extends { number: number; dueDate: Date | string; status: string }>(rows: readonly T[]): T | null {
  const unpaid = rows.filter((r) => r.status !== 'PAID');
  if (unpaid.length === 0) return null;
  return unpaid.reduce((min, r) => (new Date(r.dueDate).getTime() < new Date(min.dueDate).getTime() ? r : min), unpaid[0]!);
}
