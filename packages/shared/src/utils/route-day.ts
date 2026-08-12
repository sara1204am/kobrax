/**
 * Las cuentas de la jornada de campo. Puras, sin red ni React.
 *
 * **Se calculan en el cliente a propósito** (`ui-screen-map §8.1`): son contadores intradía de lo
 * que el cobrador acaba de hacer en la calle, y hasta que sincronice, el dispositivo tiene el dato
 * más fresco que el server. Por eso no hay endpoint de agregación — ni acá ni en el panel.
 *
 * 🔴 **`summarizeDay` es la ÚNICA cuenta del día.** Existe porque dos pantallas del mismo día
 * decían cosas distintas; reimplementarla en el escritorio repetiría exactamente ese bug.
 *
 * Los rótulos y los colores de cada categoría **no viven acá**: el panel es bilingüe y el móvil no.
 * Acá va la regla.
 */
import { RouteStopStatus, VisitOutcome } from '../enums/index.js';
import type { RouteItem } from '../types/route.types.js';

/** Las 4 tarjetas del mockup, más un cajón para lo que no entra en ninguna. */
export type ResultCategory = 'COLLECTED' | 'PROMISED' | 'NO_ANSWER' | 'UNREACHABLE' | 'OTHER';

/**
 * De resultado de visita a categoría del resumen.
 *
 * `NOT_FOUND` y `WRONG_ADDRESS` caen juntos en «inubicables»: son cosas distintas para corregir el
 * domicilio, pero para el cierre del día son la misma — fue y no pudo cobrar. **La agrupación vive
 * acá, no en la base**: el dato fino sigue entero en `field_visits`.
 */
export function categoryOf(outcome: VisitOutcome): ResultCategory {
  switch (outcome) {
    case VisitOutcome.PAID:
    case VisitOutcome.PARTIAL_PAYMENT:
      return 'COLLECTED';
    case VisitOutcome.PROMISE_TO_PAY:
      return 'PROMISED';
    case VisitOutcome.NO_CONTACT:
      return 'NO_ANSWER';
    case VisitOutcome.NOT_FOUND:
    case VisitOutcome.WRONG_ADDRESS:
      return 'UNREACHABLE';
    default:
      // CONTACTED, REFUSAL, RESCHEDULED, SPECIAL: existen, pero no tienen tarjeta propia.
      return 'OTHER';
  }
}

/** Estados terminales de una parada = «gestión hecha» (visitada o descartada). */
const STOP_DONE: RouteStopStatus[] = [RouteStopStatus.VISITED, RouteStopStatus.SKIPPED];

/** Progreso de la ruta: paradas resueltas / total. */
export function routeProgress(route: RouteItem): { done: number; total: number } {
  const stops = route.stops ?? [];
  return { done: stops.filter((s) => STOP_DONE.includes(s.status)).length, total: stops.length };
}

/** Lo mínimo que el resumen necesita de un pago. */
export interface DayPayment {
  caseId?: string;
  amount: number;
}

export interface DaySummary {
  /** Lo cobrado hoy en las paradas DE ESTA RUTA. */
  collected: number;
  currency: string;
  done: number;
  total: number;
  /** 0–100, redondeado. `0` si la ruta no tiene paradas (y no `NaN`). */
  percent: number;
  /** Sólo las categorías con al menos una parada, en el orden del mockup. */
  categories: { key: ResultCategory; count: number }[];
}

const ORDER: ResultCategory[] = ['COLLECTED', 'PROMISED', 'NO_ANSWER', 'UNREACHABLE', 'OTHER'];

/**
 * El resumen del día.
 *
 * `payments` son los del día **de todo el tenant** (así los devuelve `GET /payments`): acá se
 * quedan sólo los de las paradas de esta ruta — sin ese filtro, el «recaudado hoy» mostraría lo
 * que cobró otra persona.
 */
export function summarizeDay(route: RouteItem, payments: DayPayment[] = []): DaySummary {
  const stops = route.stops ?? [];

  const counts = new Map<ResultCategory, number>();
  let done = 0;
  for (const s of stops) {
    // Una parada sin visitar no tiene resultado y no entra en ninguna categoría.
    if (!s.lastOutcome) continue;
    done += 1;
    const c = categoryOf(s.lastOutcome);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  const caseIds = new Set(stops.map((s) => s.caseId).filter((id): id is string => !!id));
  const collected = payments
    .filter((p) => p.caseId && caseIds.has(p.caseId))
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    collected: Math.round(collected * 100) / 100,
    // La moneda sale de las paradas: son todas del mismo tenant, así que la primera alcanza.
    currency: stops.find((s) => s.currency)?.currency ?? 'BOB',
    done,
    total: stops.length,
    percent: stops.length > 0 ? Math.round((done / stops.length) * 100) : 0,
    categories: ORDER.map((key) => ({ key, count: counts.get(key) ?? 0 })).filter((c) => c.count > 0),
  };
}
