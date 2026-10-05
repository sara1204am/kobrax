/**
 * Aritmética de períodos de cobro. Archivo propio porque la usan a la vez el motor (`credit-engine.ts`)
 * y la lectura del metadata (`loan.ts`), y `loan.ts` a su vez lee las condiciones con el motor: con
 * `addPeriods` dentro de `loan.ts` los dos se importarían mutuamente.
 */
import { PaymentFrequency } from '../enums/credit.enum.js';

const DAY_MS = 86_400_000;

/**
 * Suma `n` períodos a una fecha según la frecuencia (§4.1). Base de "avanzar la próxima cuota".
 *
 * En UTC a propósito: las fechas de cobro se anclan a medianoche UTC en todo el sistema. Con
 * `setMonth`/`getMonth` (hora local) un `2026-07-01T00:00Z` + 1 mes caía en el **31 de julio** para
 * cualquier huso al oeste de Greenwich, o sea toda LatAm.
 *
 * Fin de mes (F4/06 · D6): se conserva el día y, si el mes destino no lo tiene, cae en su último
 * día. `31/01 + 1 mes = 28/02`, no `03/03` como hacía `setUTCMonth`. Para un cronograma, sumá
 * siempre desde la PRIMERA fecha (`addPeriods(primera, i, f)`): encadenar desde la anterior perdería
 * el día 31 después del primer febrero.
 */
export function addPeriods(date: Date, n: number, frequency: PaymentFrequency): Date {
  switch (frequency) {
    case PaymentFrequency.DAILY:
      return new Date(date.getTime() + n * DAY_MS);
    case PaymentFrequency.WEEKLY:
      return new Date(date.getTime() + n * 7 * DAY_MS);
    case PaymentFrequency.BIWEEKLY:
      return new Date(date.getTime() + n * 14 * DAY_MS);
    case PaymentFrequency.MONTHLY:
      return addMonthsClamped(date, n);
    case PaymentFrequency.QUARTERLY:
      return addMonthsClamped(date, n * 3);
    case PaymentFrequency.SEMIANNUAL:
      return addMonthsClamped(date, n * 6);
    case PaymentFrequency.ANNUAL:
      return addMonthsClamped(date, n * 12);
  }
}

function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getTime());
  target.setUTCDate(1); // primero ir al mes destino sin desbordar…
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay)); // …y después poner el día que exista
  return target;
}
