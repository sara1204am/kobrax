/**
 * El plan de pagos ACTUALIZADO de un crédito: el plan original (inmutable) con lo pagado encima.
 *
 * Una sola función para las dos pantallas y para el servidor que escribe el pago: Mora y Cartera no calculan nada por su
 * cuenta, así que no pueden contar dos historias del mismo crédito.
 *
 * Reglas (acordadas en la auditoría «Mora vs Cartera»):
 *  · **Imputación FIFO**: cada pago cubre la cuota impaga más antigua y el excedente pasa a la siguiente. Las fechas y los
 *    montos de las cuotas NO cambian por pagar (ni siquiera un pago anticipado): sólo cambia lo pagado de cada una.
 *  · **Orden de REGISTRO**: los pagos se imputan en el orden en que se registraron, no en el de su fecha de cobro. Un pago
 *    cobrado hace diez días y registrado hoy se aplica a lo que está pendiente hoy y NO reescribe cómo se aplicaron los
 *    pagos posteriores. Es lo que hace reproducible el historial (y lo que permite persistir las aplicaciones como hechos).
 *  · **Vencido pendiente** = Σ pendiente de las cuotas con fecha anterior a hoy. **Vigente** sólo si es 0.
 *  · **Próximo pago**: en mora, TODO lo vencido pendiente (con la fecha de la cuota impaga más antigua); al día, lo que
 *    falta de la siguiente cuota con saldo.
 *  · Las cuotas pagadas ANTES de registrar el crédito (`prepaidInstallments`) cuentan como pagadas en el plan pero no son
 *    cobranza de Kobrax: no suman a lo recuperado.
 *
 * Todo en centavos enteros: ni un céntimo de deriva de punto flotante. Función pura, sin Nest ni Prisma.
 */

const DAY_MS = 86_400_000;

/** Una fila del plan ORIGINAL (de `calculateCredit` o de `credit_installments`). */
export interface PlanScheduleRow {
  number: number;
  /** YYYY-MM-DD */
  dueDate: string;
  amount: number;
  /** Capital e interés corriente de la cuota (el motor y el cronograma guardado los traen). Sin ellos no se separa capital de interés. */
  principal?: number;
  interest?: number;
}

/** Un pago del ledger, con lo mínimo que hace falta para imputarlo. */
export interface PlanPayment {
  id: string;
  amount: number;
  /** Cuándo se REGISTRÓ (`payments.created_at`): manda el orden de la imputación. */
  registeredAt: Date | string;
}

/** Una aplicación de un pago a una cuota (lo que se persiste en `payment_applications`). */
export interface PlanAllocation {
  paymentId: string;
  installmentNumber: number;
  /** Con signo: una compensación futura es negativa. */
  amount: number;
}

export type PlanRowStatus = 'PAID' | 'PARTIAL' | 'OVERDUE' | 'PENDING';

export interface UpdatedPlanRow {
  number: number;
  dueDate: string;
  /** Importe de la cuota en el plan original (nunca cambia). */
  amount: number;
  /** Lo cubierto (incluye lo pagado antes de registrar el crédito). */
  paid: number;
  pending: number;
  /** `PAID`; si no, `OVERDUE` si su fecha ya pasó; si no, `PARTIAL` si ya tiene algo pagado; si no, `PENDING`. */
  status: PlanRowStatus;
  /** Días de atraso DE ESTA CUOTA (desde su vencimiento hasta hoy); 0 si no está vencida o ya está pagada. La mora se mide por cuota, no sobre el saldo. */
  daysPastDue: number;
  /**
   * Lo pendiente de la cuota partido en capital e interés corriente. **Un pago cubre primero el interés de la cuota y después el capital**
   * (regla de la política de imputación). Ausentes si la cuota no trae esa partición.
   */
  principalPending?: number;
  interestPending?: number;
  /** Pagada antes de registrar el crédito en Kobrax (no es cobranza de Kobrax). */
  prepaid: boolean;
}

export interface NextPayment {
  /** En mora: la cuota impaga más antigua. Al día: la siguiente con saldo. */
  number: number;
  dueDate: string;
  /** En mora: TODO lo vencido pendiente. Al día: lo que falta de esa cuota. */
  amount: number;
  overdue: boolean;
}

export interface PaymentBreakdown {
  paymentId: string;
  amount: number;
  allocations: { installmentNumber: number; amount: number; /** ¿la cuota quedó cubierta del todo tras este pago? */ coversInstallment: boolean }[];
  applied: number;
  /** Lo que no cupo en el plan (pago mayor que lo pendiente): no se inventa una cuota. */
  unapplied: number;
  /** Lo que quedaba por pagar del plan después de este pago. */
  balanceAfter: number;
  /**
   * `true` si el pago NO tiene imputación guardada (se registró antes de existir `payment_applications`): no se inventa un reparto,
   * se dice que no hay. Sólo en el desglose de lo persistido.
   */
  unrecorded?: boolean;
}

export type PlanSituation = 'CURRENT' | 'OVERDUE' | 'PAID';

export interface UpdatedPlan {
  rows: UpdatedPlanRow[];
  /** Total del plan original. */
  planTotal: number;
  /** Lo pagado antes de registrar el crédito. */
  prepaidAmount: number;
  /** Lo cobrado en Kobrax y aplicado al plan (neto de compensaciones). */
  collectedAmount: number;
  /** Lo que ningún pago pudo aplicar al plan. */
  unappliedAmount: number;
  /** Σ pendiente de las cuotas. */
  balance: number;
  /** Σ pendiente de las cuotas ya vencidas. */
  overdueAmount: number;
  /** De lo vencido, el capital y el interés corriente (sólo si las cuotas traen la partición). Suman `overdueAmount`. */
  overduePrincipal?: number;
  overdueInterest?: number;
  overdueCount: number;
  nextPayment: NextPayment | null;
  situation: PlanSituation;
  /** Vencimiento de la cuota vencida impaga más antigua. */
  oldestOverdueDueDate?: string;
  /** Días desde esa cuota (el método de mora del crédito se aplica ENCIMA, con `withArrearsMethod`). 0 al día. */
  baseDaysPastDue: number;
  /** Un renglón por pago, en orden de registro. Sólo con `payments`. */
  payments: PaymentBreakdown[];
}

const toCents = (units: number): number => Math.round(units * 100);
const fromCents = (cents: number): number => cents / 100;
const dayOf = (d: Date | string): string => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const dayNumber = (isoDay: string): number => Date.parse(`${isoDay}T00:00:00Z`) / DAY_MS;
const timeOf = (d: Date | string): number => (typeof d === 'string' ? Date.parse(d) : d.getTime());

interface Ledger {
  rows: readonly PlanScheduleRow[];
  /** Centavos cubiertos por cuota (índice = posición en `rows`, ordenadas por número). */
  paid: number[];
  /** Lo que ya venía cubierto SIN ser un pago de este ledger (prepago al registrar, o pagado antes de que existieran las aplicaciones). */
  prior: number[];
}

/** Lo cubierto de cada cuota que NO sale de los pagos/aplicaciones que se pasan: número de cuota → importe. */
export type PriorPaid = Readonly<Record<number, number>>;

function sortedRows(rows: readonly PlanScheduleRow[]): PlanScheduleRow[] {
  return [...rows].sort((a, b) => a.number - b.number);
}

function openLedger(rows: readonly PlanScheduleRow[], prepaidInstallments: number, priorPaid: PriorPaid = {}): Ledger {
  const sorted = sortedRows(rows);
  const k = Math.max(0, Math.floor(prepaidInstallments));
  const prior = sorted.map((r, i) => {
    const full = toCents(r.amount);
    return i < k ? full : Math.min(full, Math.max(0, toCents(priorPaid[r.number] ?? 0)));
  });
  return { rows: sorted, paid: [...prior], prior };
}

/** Reparte un pago FIFO sobre el libro. Devuelve las aplicaciones y lo que no cupo; muta `ledger.paid`. */
function applyToLedger(ledger: Ledger, amountCents: number): { applied: { index: number; cents: number }[]; unapplied: number } {
  let remaining = Math.max(0, amountCents);
  const applied: { index: number; cents: number }[] = [];
  for (let i = 0; i < ledger.rows.length && remaining > 0; i++) {
    const pending = toCents(ledger.rows[i]!.amount) - ledger.paid[i]!;
    if (pending <= 0) continue;
    const cents = Math.min(remaining, pending);
    ledger.paid[i]! += cents;
    remaining -= cents;
    applied.push({ index: i, cents });
  }
  return { applied, unapplied: remaining };
}

/** Los pagos en orden de registro; el empate se resuelve por posición de entrada (estable). */
function inRegistrationOrder(payments: readonly PlanPayment[]): PlanPayment[] {
  return payments
    .map((p, i) => ({ p, i }))
    .sort((a, b) => timeOf(a.p.registeredAt) - timeOf(b.p.registeredAt) || a.i - b.i)
    .map((x) => x.p);
}

/**
 * Cómo se aplica cada pago al plan, en orden de registro. Es lo que `applyCore` escribe en `payment_applications` y lo que
 * el verificador recalcula para comprobar que lo guardado no se desvió.
 */
export function allocatePayments(input: {
  rows: readonly PlanScheduleRow[];
  prepaidInstallments?: number;
  /** Lo ya cubierto por pagos anteriores (aplicaciones guardadas) o por pagos heredados: el pago nuevo se reparte sobre lo que falta. */
  priorPaid?: PriorPaid;
  payments: readonly PlanPayment[];
}): { allocations: PlanAllocation[]; breakdown: PaymentBreakdown[] } {
  const ledger = openLedger(input.rows, input.prepaidInstallments ?? 0, input.priorPaid);
  const totalCents = ledger.rows.reduce((s, r) => s + toCents(r.amount), 0);
  let appliedSoFar = ledger.paid.reduce((s, c) => s + c, 0); // lo prepago ya está cubierto
  const allocations: PlanAllocation[] = [];
  const breakdown: PaymentBreakdown[] = [];

  for (const payment of inRegistrationOrder(input.payments)) {
    const cents = toCents(payment.amount);
    const { applied, unapplied } = applyToLedger(ledger, cents);
    const appliedCents = applied.reduce((s, a) => s + a.cents, 0);
    appliedSoFar += appliedCents;
    const lines = applied.map((a) => ({
      installmentNumber: ledger.rows[a.index]!.number,
      amount: fromCents(a.cents),
      coversInstallment: ledger.paid[a.index]! >= toCents(ledger.rows[a.index]!.amount),
    }));
    for (const l of lines) allocations.push({ paymentId: payment.id, installmentNumber: l.installmentNumber, amount: l.amount });
    breakdown.push({
      paymentId: payment.id,
      amount: fromCents(cents),
      allocations: lines,
      applied: fromCents(appliedCents),
      unapplied: fromCents(unapplied),
      balanceAfter: fromCents(totalCents - appliedSoFar),
    });
  }
  return { allocations, breakdown };
}

/**
 * El desglose por pago a partir de las aplicaciones GUARDADAS (no reproducidas): lo que de verdad se hizo el día que se registró cada
 * pago. En orden de registro; `balanceAfter` cuenta lo cubierto hasta ese pago.
 */
function persistedBreakdown(input: {
  rows: readonly PlanScheduleRow[];
  prepaidInstallments?: number;
  priorPaid?: PriorPaid;
  payments: readonly PlanPayment[];
  allocations: readonly PlanAllocation[];
}): PaymentBreakdown[] {
  const ledger = openLedger(input.rows, input.prepaidInstallments ?? 0, input.priorPaid);
  const indexOf = new Map(ledger.rows.map((r, i) => [r.number, i]));
  const totalCents = ledger.rows.reduce((s, r) => s + toCents(r.amount), 0);
  let coveredCents = ledger.paid.reduce((s, c) => s + c, 0);
  const out: PaymentBreakdown[] = [];

  for (const payment of inRegistrationOrder(input.payments)) {
    const perRow = new Map<number, number>();
    for (const a of input.allocations) {
      if (a.paymentId !== payment.id || !indexOf.has(a.installmentNumber)) continue;
      perRow.set(a.installmentNumber, (perRow.get(a.installmentNumber) ?? 0) + toCents(a.amount));
    }
    const lines = [...perRow.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([installmentNumber, cents]) => {
        const i = indexOf.get(installmentNumber)!;
        ledger.paid[i]! += cents;
        coveredCents += cents;
        return { installmentNumber, amount: fromCents(cents), coversInstallment: ledger.paid[i]! >= toCents(ledger.rows[i]!.amount) };
      });
    const appliedCents = lines.reduce((s, l) => s + toCents(l.amount), 0);
    const unrecorded = lines.length === 0;
    out.push({
      paymentId: payment.id,
      amount: fromCents(toCents(payment.amount)),
      allocations: lines,
      applied: fromCents(appliedCents),
      unapplied: unrecorded ? 0 : fromCents(Math.max(0, toCents(payment.amount) - appliedCents)),
      balanceAfter: fromCents(totalCents - coveredCents),
      ...(unrecorded ? { unrecorded: true } : {}),
    });
  }
  return out;
}

/**
 * El plan actualizado a hoy. Con `allocations` (lo persistido) las usa tal cual; sin ellas las reproduce de `payments`.
 * `asOf` es «hoy»: una cuota está vencida si su fecha es ANTERIOR al día de `asOf` (el día del vencimiento todavía no).
 */
export function buildUpdatedPlan(input: {
  rows: readonly PlanScheduleRow[];
  prepaidInstallments?: number;
  /** Cobertura heredada que no está en las aplicaciones (cronogramas anteriores a `payment_applications`). */
  priorPaid?: PriorPaid;
  payments?: readonly PlanPayment[];
  allocations?: readonly PlanAllocation[];
  asOf: Date;
}): UpdatedPlan {
  const payments = input.payments ?? [];
  const replay = allocatePayments({ rows: input.rows, prepaidInstallments: input.prepaidInstallments, priorPaid: input.priorPaid, payments });
  const allocations = input.allocations ?? replay.allocations;

  const ledger = openLedger(input.rows, input.prepaidInstallments ?? 0, input.priorPaid);
  const indexOf = new Map(ledger.rows.map((r, i) => [r.number, i]));
  let collected = 0;
  for (const a of allocations) {
    const i = indexOf.get(a.installmentNumber);
    if (i === undefined) continue; // una aplicación a una cuota que ya no existe no puede pintar nada
    ledger.paid[i]! += toCents(a.amount);
    collected += toCents(a.amount);
  }

  const today = dayNumber(dayOf(input.asOf));
  const rows: UpdatedPlanRow[] = ledger.rows.map((r, i) => {
    const amount = toCents(r.amount);
    const paid = Math.min(Math.max(ledger.paid[i]!, 0), amount);
    const pending = amount - paid;
    const overdue = pending > 0 && dayNumber(dayOf(r.dueDate)) < today;
    const status: PlanRowStatus = pending === 0 ? 'PAID' : overdue ? 'OVERDUE' : paid > 0 ? 'PARTIAL' : 'PENDING';
    const split = r.principal !== undefined && r.interest !== undefined;
    // Interés primero: lo pagado de la cuota se come antes el interés que el capital.
    const interestPending = split ? Math.max(0, toCents(r.interest!) - paid) : undefined;
    return {
      number: r.number,
      dueDate: dayOf(r.dueDate),
      amount: fromCents(amount),
      paid: fromCents(paid),
      pending: fromCents(pending),
      status,
      daysPastDue: overdue ? Math.max(0, today - dayNumber(dayOf(r.dueDate))) : 0,
      ...(split ? { interestPending: fromCents(Math.min(interestPending!, pending)), principalPending: fromCents(pending - Math.min(interestPending!, pending)) } : {}),
      prepaid: ledger.prior[i]! > 0,
    };
  });

  const pendingCents = (r: UpdatedPlanRow): number => toCents(r.pending);
  const balance = rows.reduce((s, r) => s + pendingCents(r), 0);
  const overdueRows = rows.filter((r) => r.status === 'OVERDUE');
  const overdueAmount = overdueRows.reduce((s, r) => s + pendingCents(r), 0);
  const oldestOverdue = overdueRows[0];
  const hasSplit = overdueRows.length > 0 && overdueRows.every((r) => r.principalPending !== undefined);
  const overduePrincipalCents = overdueRows.reduce((s2, r) => s2 + toCents(r.principalPending ?? 0), 0);
  const firstOpen = rows.find((r) => pendingCents(r) > 0);

  const nextPayment: NextPayment | null = oldestOverdue
    ? { number: oldestOverdue.number, dueDate: oldestOverdue.dueDate, amount: fromCents(overdueAmount), overdue: true }
    : firstOpen
      ? { number: firstOpen.number, dueDate: firstOpen.dueDate, amount: firstOpen.pending, overdue: false }
      : null;

  const prepaidCents = ledger.prior.reduce((s, c) => s + c, 0);
  // Con aplicaciones guardadas el desglose sale de ellas (lo que se hizo, no lo que se reproduciría hoy).
  const breakdown = input.allocations
    ? persistedBreakdown({ rows: input.rows, prepaidInstallments: input.prepaidInstallments, priorPaid: input.priorPaid, payments, allocations })
    : replay.breakdown;
  const unappliedCents = breakdown.reduce((s, b) => s + toCents(b.unapplied), 0);

  return {
    rows,
    planTotal: fromCents(rows.reduce((s, r) => s + toCents(r.amount), 0)),
    prepaidAmount: fromCents(prepaidCents),
    collectedAmount: fromCents(collected),
    unappliedAmount: fromCents(unappliedCents),
    balance: fromCents(balance),
    overdueAmount: fromCents(overdueAmount),
    ...(hasSplit ? { overduePrincipal: fromCents(overduePrincipalCents), overdueInterest: fromCents(overdueAmount - overduePrincipalCents) } : {}),
    overdueCount: overdueRows.length,
    nextPayment,
    situation: balance === 0 ? 'PAID' : overdueAmount > 0 ? 'OVERDUE' : 'CURRENT',
    ...(oldestOverdue ? { oldestOverdueDueDate: oldestOverdue.dueDate } : {}),
    baseDaysPastDue: oldestOverdue ? Math.max(0, today - dayNumber(oldestOverdue.dueDate)) : 0,
    payments: breakdown,
  };
}

/**
 * Verificador: ¿lo persistido coincide con reproducir los pagos en orden de registro? Devuelve las diferencias (vacío = coherente).
 * Sirve de prueba de propiedad y del trabajo nocturno que detecta desvíos. **Reporta, no corrige.**
 */
export function diffAllocations(
  expected: readonly PlanAllocation[],
  persisted: readonly PlanAllocation[],
): { paymentId: string; installmentNumber: number; expected: number; persisted: number }[] {
  const key = (a: PlanAllocation): string => `${a.paymentId}#${a.installmentNumber}`;
  const sum = (list: readonly PlanAllocation[]): Map<string, { a: PlanAllocation; cents: number }> => {
    const m = new Map<string, { a: PlanAllocation; cents: number }>();
    for (const a of list) {
      const cur = m.get(key(a));
      m.set(key(a), { a, cents: (cur?.cents ?? 0) + toCents(a.amount) });
    }
    return m;
  };
  const e = sum(expected);
  const p = sum(persisted);
  const out: { paymentId: string; installmentNumber: number; expected: number; persisted: number }[] = [];
  for (const k of new Set([...e.keys(), ...p.keys()])) {
    const ec = e.get(k)?.cents ?? 0;
    const pc = p.get(k)?.cents ?? 0;
    if (ec !== pc) {
      const ref = (e.get(k) ?? p.get(k))!.a;
      out.push({ paymentId: ref.paymentId, installmentNumber: ref.installmentNumber, expected: fromCents(ec), persisted: fromCents(pc) });
    }
  }
  return out;
}

/**
 * El monto VENCIDO de un crédito con plan, a partir de sólo el plan original y su saldo (`outstanding_balance`), sin cargar sus pagos.
 *
 * Es para las LISTAS (una fila por crédito): cargar el plan actualizado de cada uno costaría una consulta por crédito. Sale exacto porque la
 * imputación es FIFO: lo cubierto (`total del plan − saldo`, que incluye lo pagado antes de registrar el crédito) llena primero las cuotas más
 * antiguas, que son justo las vencidas; lo vencido que queda es `Σ cuotas vencidas − lo cubierto` (mínimo 0). Sólo vale si el saldo es el
 * total pendiente del plan (`balanceBasis = total`); con otra base quien llama NO debe usarlo. La ficha usa el plan actualizado (`buildUpdatedPlan`).
 */
export function overdueAmountFromBalance(input: { rows: readonly PlanScheduleRow[]; balance: number; asOf: Date }): number {
  const today = dayNumber(dayOf(input.asOf));
  const totalCents = input.rows.reduce((s, r) => s + toCents(r.amount), 0);
  const coveredCents = Math.max(0, totalCents - toCents(input.balance));
  const overdueCents = input.rows.filter((r) => dayNumber(dayOf(r.dueDate)) < today).reduce((s, r) => s + toCents(r.amount), 0);
  return fromCents(Math.max(0, overdueCents - coveredCents));
}

