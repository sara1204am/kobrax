/**
 * Interés moratorio de UNA cuota (F17 · F3-a). Función pura, en centavos enteros, sin Nest ni Prisma: la usan la API (al imputar un pago),
 * la web (al mostrar) y el verificador de coherencia, así que los tres cuentan la misma historia.
 *
 * Reglas (decisiones D1–D10 de F17, y P1–P6 de `F3-PLAN.md`):
 *  · **Base (D2)**: el capital vencido PENDIENTE de la cuota. Nunca la cuota entera, nunca el interés corriente ni la mora ya devengada
 *    (no hay interés sobre interés). Cada pago que toca el capital de la cuota **cierra un tramo** y reduce la base.
 *  · **Convención (D3)**: Actual/365 o Actual/360 sobre días corridos reales (los años bisiestos cuentan sus días).
 *  · **Gracia (D9, P2)**: `díasDevengados = max(0, díasDeAtraso − gracia)`. Durante la gracia no corre nada y al terminar **no se cobra hacia atrás**.
 *  · **Corte (D4, P3)**: cada pago corta el devengo en su FECHA DE COBRO. Los pagos llegan en orden de REGISTRO y su fecha puede ir hacia atrás;
 *    el corte es `max(últimoCorte, fechaDeCobro)`: el devengo **nunca retrocede** ni genera días negativos.
 *  · **Castigado (D7)**: `stopAt` (la fecha del castigo) congela el devengo.
 *  · **Redondeo (P1)**: por tramo, half-up a centavo, con `BigInt` (sin flotantes: `base × tasa × días` no cabe en un `number` exacto).
 *  · **Tope (D5, P6)**: Σ de los tramos de la cuota ≤ `capPctOfPrincipal %` de su capital original. Al llegar, el devengo se detiene.
 *
 * Lo que esta función NO hace: decidir cómo se reparte un pago entre mora, interés y capital (eso es la imputación, F3-c) ni leer la política
 * de la cuenta. Recibe la ya sellada en el crédito.
 */

const DAY_MS = 86_400_000;

/** Versión del algoritmo (redondeo, gracia, corte). Se sella junto a la política: si cambia la regla, cambia este número. */
export const LATE_INTEREST_ALGORITHM_VERSION = 1;

/** La política sellada del crédito, tal como la necesita el cálculo. */
export interface LateInterestParams {
  /** Tasa nominal anual en % (p. ej. 18 ó 12.5). Hasta 4 decimales. */
  annualRate: number;
  dayCount: 360 | 365;
  graceDays: number;
  /** Tope acumulado por cuota, en % de su capital. `null`/ausente = sin tope. Hasta 4 decimales. */
  capPctOfPrincipal?: number | null;
}

/** Un pago que tocó el CAPITAL de la cuota. Va en orden de REGISTRO; `date` es la fecha de cobro (`YYYY-MM-DD`). */
export interface LatePrincipalEvent {
  date: string;
  /** Capital de la cuota que ese pago cubrió (>0). Lo que el pago puso en mora o interés corriente NO va acá. */
  principal: number;
}

export interface LateTranche {
  /** Último día que ya estaba cubierto por el tramo anterior (exclusivo). */
  from: string;
  /** Día hasta el que corre el tramo (inclusivo). */
  to: string;
  days: number;
  /** Capital vencido pendiente durante el tramo, en centavos. */
  baseCents: number;
  chargeCents: number;
}

export interface LateAccrual {
  tranches: LateTranche[];
  /** Σ de los tramos, ya con el tope aplicado. */
  accruedCents: number;
  /** `true` si el tope por cuota recortó o detuvo el devengo. */
  capped: boolean;
  /** Σ de los días que corrieron (sin contar gracia ni días después del tope). */
  daysAccrued: number;
}

const toCents = (units: number): number => Math.round(units * 100);

/** `YYYY-MM-DD` (o una fecha, cortada a su día UTC) → nº de día. Lanza con una fecha inválida: un cargo con dinero no se calcula a ciegas. */
function dayNumber(d: Date | string): number {
  const iso = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Fecha inválida para el interés moratorio: ${String(d)}`);
  return ms / DAY_MS;
}

const isoOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Un porcentaje con hasta 4 decimales → entero en diezmilésimas (12.5 → 125000). Redondea el ruido binario de `12.3456 * 10000`. */
const scaled4 = (pct: number): bigint => BigInt(Math.round(pct * 10_000));

/** Cociente entero redondeado half-up de `num / den` (ambos positivos). */
function divRoundHalfUp(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n);
}

/** Interés de UN tramo en centavos: `base × (tasa/100) × días / convención`, half-up. */
export function lateTrancheCharge(baseCents: number, annualRatePct: number, days: number, dayCount: 360 | 365): number {
  if (baseCents <= 0 || days <= 0 || annualRatePct <= 0) return 0;
  // tasa en diezmilésimas de % ⇒ tasa/100 = scaled/1_000_000.
  const num = BigInt(baseCents) * scaled4(annualRatePct) * BigInt(days);
  return Number(divRoundHalfUp(num, BigInt(dayCount) * 1_000_000n));
}

/** El tope en centavos: `capPct %` del capital de la cuota, half-up. `null` = sin tope. */
function capCentsOf(principalCents: number, capPct: number | null | undefined): number | null {
  if (capPct === null || capPct === undefined) return null;
  return Number(divRoundHalfUp(BigInt(principalCents) * scaled4(capPct), 1_000_000n));
}

/**
 * El interés moratorio devengado de una cuota hasta `asOf`.
 *
 * @param dueDate  vencimiento de la cuota (`YYYY-MM-DD`). El día del vencimiento todavía no está en mora.
 * @param principal  capital ORIGINAL de la cuota (la base inicial y la del tope), en unidades.
 * @param events  pagos que tocaron su capital, en orden de registro.
 * @param asOf  «hoy» del tenant (`accountToday`); nunca el instante UTC.
 * @param stopAt  fecha en que se castigó el crédito (D7): el devengo no pasa de ahí.
 */
export function accrueLateInterest(input: {
  dueDate: string;
  principal: number;
  events?: readonly LatePrincipalEvent[];
  policy: LateInterestParams;
  asOf: Date | string;
  stopAt?: Date | string | null;
}): LateAccrual {
  const { policy } = input;
  const principalCents = toCents(input.principal);
  const empty: LateAccrual = { tranches: [], accruedCents: 0, capped: false, daysAccrued: 0 };
  if (principalCents <= 0 || policy.annualRate <= 0) return empty;

  const grace = Math.max(0, Math.floor(policy.graceDays));
  const end = Math.min(dayNumber(input.asOf), input.stopAt ? dayNumber(input.stopAt) : Infinity);
  const capCents = capCentsOf(principalCents, policy.capPctOfPrincipal);

  // El devengo cuenta los días POSTERIORES a `vencimiento + gracia`.
  let cursor = dayNumber(input.dueDate) + grace;
  let base = principalCents;
  let accrued = 0;
  let daysAccrued = 0;
  let capped = false;
  const tranches: LateTranche[] = [];

  const close = (cut: number): void => {
    const days = cut - cursor;
    if (days > 0 && base > 0 && !capped) {
      let charge = lateTrancheCharge(base, policy.annualRate, days, policy.dayCount);
      if (capCents !== null && accrued + charge >= capCents) {
        charge = Math.max(0, capCents - accrued);
        capped = true;
      }
      if (charge > 0) tranches.push({ from: isoOf(cursor), to: isoOf(cut), days, baseCents: base, chargeCents: charge });
      accrued += charge;
      daysAccrued += days;
    }
    // El cursor avanza aunque el tramo no cobre: un tramo con base 0 o ya topado igual consumió esos días.
    if (cut > cursor) cursor = cut;
  };

  for (const e of input.events ?? []) {
    const eventCents = toCents(e.principal);
    if (eventCents <= 0) continue;
    // P3: el corte nunca retrocede (`max` con el cursor) ni pasa del final (`min`).
    close(Math.min(Math.max(cursor, dayNumber(e.date)), end));
    base = Math.max(0, base - eventCents);
  }
  close(end);

  return { tranches, accruedCents: accrued, capped, daysAccrued };
}
