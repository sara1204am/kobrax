import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Payment, PaymentChannel, PaymentMethod, PrismaClient } from '@prisma/client';
import { CreditStatus, InstallmentStatus, Prisma } from '@prisma/client';
import { PAYMENT_BACKDATE_DAYS, allocatePayments, allocateWithLateInterest, type PlanAllocation, buildUpdatedPlan, isExternalOrigin, readCreditMetadata, resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { TenantClockService, accountTimezone, accountToday, civilDayOf, civilDayStartInstant, civilMonthStartUTC, civilTodayUTC } from '../../common/context/tenant-clock.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { creditPatchAfterPayment, creditPatchFromPlan, planSourceOf } from './payment-apply';
import { settlePromisesFromPayments } from './settle-promises';
import { lateParamsOf, loadLateContext } from './late-context';
import { lateSummaryOfCredit } from './late-summary';
import { loadNames } from '../mora/mora-names';
import { moraScopeOf, seesWholeAccount, visibleCreditIdsSql } from '../mora/mora-query';
import { serializePayment, serializePaymentRequest } from './payments.serializer';
import { loadCreditPlan } from '../credits/credit-plan';
import { ConfirmPaymentRequestDto, CreatePaymentDto, CreatePaymentRequestDto, ListPaymentRequestsQueryDto, ListPaymentsQueryDto } from './dto/payment.dto';
import { creditNotActive, paymentDuplicate, paymentInvalid, requestNotPending, resourceNotFound } from './payments.errors';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Hasta cuántos días atrás puede fecharse un cobro. Cubre al cobrador que pasa una semana sin señal y
 * sincroniza al volver; más atrás ya no es un pago offline, es una corrección de historia.
 */
export { PAYMENT_BACKDATE_DAYS };
/** Tolerancia al reloj del teléfono: unos minutos adelantado no es un pago «del futuro». */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

interface ApplyParams {
  creditId: string;
  amount: number;
  method: PaymentMethod;
  provider?: string;
  externalTransactionId?: string;
  idempotencyKey?: string;
  /** Comprobante (§5.4). El hash lo calcula `POST /uploads` sobre el buffer original. */
  receiptUrl?: string;
  receiptHash?: string;
  /** N° del recibo o la factura en papel (opcional). */
  receiptReference?: string;
  /** Desde dónde se registró (`WEB` | `MOBILE`). Ausente = no se sabe. */
  registeredVia?: 'WEB' | 'MOBILE';
  channel?: PaymentChannel;
  notes?: string;
  /** ISO: cuándo se cobró (el pago offline). Ausente = ahora. */
  paymentDate?: string;
  /** La visita en la que se cobró (F4/12). */
  visitId?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly clock: TenantClockService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /**
   * D-7 (F13): ids de los créditos que quien consulta puede ver, con LA regla de Mora; `null` = toda la cuenta (kind ALL, sin
   * filtro alguno). Decisión: Prisma `where` no admite SQL crudo, así que se resuelven los ids con `$queryRaw` (una consulta
   * acotada por oficina) y se filtra con `creditId IN (...)`; el alcance sale del crédito, nunca de `payments.branch_id` (histórico).
   */
  private async visibleCreditIds(tx: PrismaClient): Promise<string[] | null> {
    const scope = moraScopeOf(this.tenant);
    if (seesWholeAccount(scope)) return null;
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT v.id FROM (${visibleCreditIdsSql(scope)}) v`);
    return rows.map((r) => r.id);
  }

  /**
   * S-2: el crédito sobre el que se escribe tiene que estar en el alcance de quien escribe. Los listados ya filtraban,
   * pero registrar/solicitar/confirmar buscaban el crédito sólo por id: con un UUID ajeno un cobrador podía cobrarlo.
   * Fuera de alcance responde como inexistente (404), igual que la lectura, para no confirmar que el id existe.
   */
  private async assertCreditInScope(tx: PrismaClient, creditId: string): Promise<void> {
    const scope = moraScopeOf(this.tenant);
    if (seesWholeAccount(scope)) return;
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT v.id FROM (${visibleCreditIdsSql(scope)}) v WHERE v.id = ${creditId} LIMIT 1`,
    );
    if (rows.length === 0) throw resourceNotFound();
  }

  // ── Registro de pago (ledger inmutable) ──────────────────────────────────────
  async register(dto: CreatePaymentDto, idempotencyKey?: string, viaHint?: 'WEB' | 'MOBILE') {
    const run = () => this.tx(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.payment.findFirst({ where: { idempotencyKey } });
        if (existing) return { payment: existing, replay: true, external: false }; // reintento → no duplica
      }
      const applied = await this.applyCore(tx, { ...dto, registeredVia: dto.registeredVia ?? viaHint, idempotencyKey });
      // Con el candado del crédito ya tomado, otro envío con la misma clave pudo haber registrado el pago: se responde como un reintento.
      if (applied.replay) return { payment: applied.payment, replay: true, external: false };
      const { payment, external } = applied;
      // S-11: el rastro del cobro va EN la misma transacción: un pago sin su auditoría no queda (ni la auditoría de un pago que se deshizo).
      // Qué se cobró, cuándo y por qué canal, y si fue sobre una operación externa: con esto y los snapshots del reporte se contesta
      // «quién consiguió el pago, cuándo y cómo» (§13).
      await this.audit.recordInTx(tx, {
        entity: 'payment',
        entityId: payment.id,
        action: 'CREATE',
        after: {
          creditId: payment.creditId,
          amount: Number(payment.amount),
          method: payment.method,
          channel: payment.channel,
          paymentDate: payment.paymentDate,
          receiptReference: payment.receiptReference ?? undefined,
          visitId: payment.visitId ?? undefined,
          externalCredit: external,
          // A qué cuotas fue cada centavo (imputación FIFO): el reparto también vive en `payment_applications`.
          applications: applied.allocations.length > 0 ? applied.allocations : undefined,
        },
      });
      return { payment, replay: false, external };
    });
    // Dos envíos con la misma clave a la vez (el intento en vivo y la cola offline) pasan los dos el chequeo y uno
    // choca con la unicidad (account_id, idempotency_key): su transacción se deshace y se repite UNA vez, y esta vez
    // el chequeo encuentra el pago que registró el otro y responde igual que un reintento normal, no un 500/409.
    const { payment, replay, external } = await run().catch((err: unknown) =>
      idempotencyKey && isPaymentDuplicate(err) ? run() : Promise.reject(err),
    );

    if (!replay) {
      this.events.emit(DomainEvent.PAYMENT_REGISTERED, { paymentId: payment.id, creditId: payment.creditId, amount: Number(payment.amount), accountId: this.tenant.accountId });
    }
    return { ...serializePayment(payment), idempotentReplay: replay };
  }

  /**
   * Aplicación atómica del pago a la deuda (cuota → saldo → mora). Dentro de una transacción.
   *
   * 🔴 **El crédito se bloquea (`FOR UPDATE`) antes de leerlo.** Antes se leía el saldo, se calculaba `saldo - monto` en memoria y se
   * escribía el valor absoluto: dos pagos simultáneos sobre el mismo crédito se pisaban (uno se perdía). Con el candado el segundo espera,
   * lee el saldo ya descontado y aplica sobre lo que de verdad queda. La idempotencia se vuelve a mirar DESPUÉS del candado, porque el
   * intento en vivo y la cola offline pueden llegar a la vez con la misma clave.
   */
  private async applyCore(
    tx: PrismaClient,
    p: ApplyParams,
  ): Promise<{ payment: Payment; creditPaid: boolean; external: boolean; replay: boolean; allocations: { installmentNumber: number; amount: number }[] }> {
    if (p.amount <= 0) throw paymentInvalid('El monto debe ser mayor a 0');
    if (p.paymentDate) assertPaymentDate(new Date(p.paymentDate));

    await this.assertCreditInScope(tx, p.creditId);
    await tx.$queryRaw`SELECT id FROM credits WHERE id = ${p.creditId} AND account_id = ${this.tenant.accountId} FOR UPDATE`;
    if (p.idempotencyKey) {
      const existing = await tx.payment.findFirst({ where: { idempotencyKey: p.idempotencyKey } });
      if (existing) return { payment: existing, creditPaid: false, external: false, replay: true, allocations: [] };
    }
    const credit = await tx.credit.findFirst({ where: { id: p.creditId, deletedAt: null }, include: { installments: true, latePolicyVersion: true } });
    if (!credit) throw resourceNotFound();
    // El cobro dice en qué visita se hizo: esa visita tiene que existir y ser de ESTE crédito.
    if (p.visitId) {
      const visit = await tx.fieldVisit.findFirst({ where: { id: p.visitId }, select: { creditId: true } });
      if (!visit || (visit.creditId && visit.creditId !== credit.id)) throw paymentInvalid('La visita no corresponde a ese crédito');
    }

    /*
     * 🔴 **Cartera de una fuente externa (PSF): el pago es un hecho de cobranza, no un movimiento del
     * saldo (D3).** El saldo, la mora y el estado los informa el reporte; el próximo reporte los
     * actualiza. Por eso esta rama no mira el estado ni el saldo reportado —un pago cobrado offline
     * que sube después de un reporte con saldo menor no se pierde— y no toca cuotas, saldo, mora,
     * estado ni aplicaciones. Lo único que escribe es el `Payment`, que es lo que cuenta como recuperado.
     */
    if (isExternalOrigin(readCreditMetadata(credit.metadata, credit.origin).origin)) {
      const payment = await this.insertPayment(tx, credit, p);
      await this.settlePromises(tx, credit);
      return { payment, creditPaid: false, external: true, replay: false, allocations: [] };
    }

    if (credit.status !== CreditStatus.ACTIVE) throw creditNotActive();

    const balance = Number(credit.outstandingBalance);
    const now = new Date();
    // Los días de atraso se cuentan contra el día civil de la cuenta, no contra el instante UTC (`now` queda para `paidAt`).
    const today = await accountToday(tx, this.tenant.accountId, now);
    const source = planSourceOf(credit);

    /*
     * F17 · F3-c — interés moratorio. SÓLO si el crédito nació con una política `ANNUAL_RATE` sellada y tiene plan con partición capital/interés.
     * Sin política (la cuenta lo tiene apagado, o el crédito es anterior) `late` queda en `null` y TODO lo de abajo es el camino de siempre.
     * La mora se calcula a la fecha de cobro del pago (D4), acotada a hoy; el pago puede cubrir saldo del plan + mora pendiente.
     */
    const lateParams = source ? lateParamsOf(credit.latePolicyVersion) : null;
    let late: { ctx: Awaited<ReturnType<typeof loadLateContext>>; result: ReturnType<typeof allocateWithLateInterest> } | null = null;
    if (source && lateParams) {
      const tz = await accountTimezone(tx, this.tenant.accountId);
      const todayIso = today.toISOString().slice(0, 10);
      const payDay = p.paymentDate ? civilDayOf(new Date(p.paymentDate), tz) : todayIso;
      const ctx = await loadLateContext(tx, {
        accountId: this.tenant.accountId,
        creditId: credit.id,
        tz,
        rows: source.rows,
        policy: lateParams,
        // D7: castigado ⇒ el devengo se congela en el día del castigo.
        stopAt: credit.writtenOffAt ? civilDayOf(credit.writtenOffAt, tz) : null,
        prepaidInstallments: source.prepaidInstallments,
        storedPaid: source.stored ? Object.fromEntries(credit.installments.map((i) => [i.number, Number(i.paidAmount)])) : undefined,
      });
      const result = allocateWithLateInterest({ ...ctx, amount: p.amount, date: payDay > todayIso ? todayIso : payDay });
      if (p.amount > result.payable + 0.005) throw paymentInvalid('El monto excede el saldo pendiente más el interés moratorio');
      late = { ctx, result };
    } else if (p.amount > balance + 0.005) {
      throw paymentInvalid('El monto excede el saldo pendiente');
    }

    // El pago descuenta el saldo del PLAN (spec §5.4); con mora, sólo lo que fue a cuotas (la mora no es parte del plan, P5).
    // D6: con mora pendiente el crédito no pasa a `PAID` aunque el plan esté saldado.
    const newBalance = round2(Math.max(0, balance - (late ? late.result.scheduledApplied : p.amount)));
    const creditPaid = newBalance <= 0.005 && (late ? late.result.latePendingAfter <= 0.005 : true);

    const payment = await this.insertPayment(tx, credit, p);
    let allocations: { installmentNumber: number; amount: number }[] = [];

    if (source) {
      /*
       * Con plan (cronograma guardado o condiciones): la imputación FIFO de ESTE pago sobre lo que ya estaba cubierto, guardada como
       * hechos en `payment_applications` (orden de REGISTRO). Lo ya cubierto sale de las aplicaciones previas y, en un cronograma guardado,
       * de su `paid_amount` (que además incluye lo pagado antes de que existieran las aplicaciones).
       */
      const covered: Record<number, number> = {};
      if (late) {
        Object.assign(covered, late.ctx.scheduledPaid);
      } else if (source.stored) {
        for (const i of credit.installments) covered[i.number] = Number(i.paidAmount);
      } else {
        const previous = await tx.paymentApplication.findMany({
          where: { accountId: this.tenant.accountId, creditId: credit.id, component: 'SCHEDULED' },
          select: { installmentNumber: true, amount: true },
        });
        for (const a of previous) covered[a.installmentNumber] = round2((covered[a.installmentNumber] ?? 0) + Number(a.amount));
      }
      const fresh: PlanAllocation[] = late
        ? late.result.allocations.filter((a) => a.component === 'SCHEDULED').map((a) => ({ paymentId: payment.id, installmentNumber: a.installmentNumber, amount: a.amount }))
        : allocatePayments({
            rows: source.rows,
            prepaidInstallments: source.prepaidInstallments,
            priorPaid: covered,
            payments: [{ id: payment.id, amount: p.amount, registeredAt: payment.createdAt }],
          }).allocations;
      allocations = (late ? late.result.allocations : fresh).map((a) => ({ installmentNumber: a.installmentNumber, amount: a.amount }));
      const rowsToWrite = late
        ? late.result.allocations.map((a) => ({ installmentNumber: a.installmentNumber, amount: a.amount, component: a.component, policyVersion: 2 }))
        : fresh.map((a) => ({ installmentNumber: a.installmentNumber, amount: a.amount }));
      if (rowsToWrite.length > 0) {
        await tx.paymentApplication.createMany({
          data: rowsToWrite.map((a) => ({ accountId: this.tenant.accountId, paymentId: payment.id, creditId: credit.id, ...a })),
        });
      }
      const plan = buildUpdatedPlan({ rows: source.rows, prepaidInstallments: source.prepaidInstallments, priorPaid: covered, allocations: fresh, asOf: today });

      // Cronograma guardado: las filas son una COPIA de lectura del plan actualizado (el estado sale de las aplicaciones).
      if (source.stored) {
        for (const row of plan.rows) {
          const stored = credit.installments.find((i) => i.number === row.number);
          if (!stored || row.paid === Number(stored.paidAmount)) continue;
          const full = row.pending === 0;
          await tx.creditInstallment.update({
            where: { id: stored.id },
            data: { paidAmount: row.paid, status: full ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL, paidAt: full ? now : null },
          });
        }
      }

      await tx.credit.update({
        where: { id: credit.id },
        data: {
          outstandingBalance: newBalance,
          ...(creditPaid ? { status: CreditStatus.PAID } : {}),
          ...creditPatchFromPlan({ metadata: credit.metadata, plan, creditPaid, now: today }),
        },
      });
    } else {
      // Sin plan (préstamo abierto o sin condiciones): no hay cuotas a las que imputar. Se conserva la lógica de siempre (sin aplicaciones).
      await tx.credit.update({
        where: { id: credit.id },
        data: {
          outstandingBalance: newBalance,
          ...(creditPaid ? { status: CreditStatus.PAID } : {}),
          ...creditPatchAfterPayment({ metadata: credit.metadata, installments: [], amount: p.amount, newBalance, creditPaid, now: today }),
        },
      });
    }

    // Saldada la deuda el crédito queda `PAID` y el trigger de episodios termina la mora (F4/08): el pago cuelga solo del crédito.
    await this.settlePromises(tx, credit);
    return { payment, creditPaid, external: false, replay: false, allocations };
  }

  /**
   * Con el pago ya escrito, las promesas del crédito que lo pagado cubre pasan solas a «cumplida». Va en la misma transacción y deja su
   * rastro de auditoría: quién la cerró no fue una persona, fue el pago.
   */
  private async settlePromises(tx: PrismaClient, credit: { id: string; clientId: string }): Promise<void> {
    const kept = await settlePromisesFromPayments(tx, { accountId: this.tenant.accountId, creditId: credit.id, clientId: credit.clientId, userId: this.tenant.userId });
    for (const id of kept) {
      await this.audit.recordInTx(tx, { entity: 'agenda_item', entityId: id, action: 'EXECUTE', after: { id, creditId: credit.id, outcome: 'PROMISE_KEPT', by: 'PAYMENT' } });
    }
  }

  /** La fila del ledger (inmutable), con su número de recibo. La comparten el crédito propio y el externo. */
  private async insertPayment(tx: PrismaClient, credit: { id: string; branchId: string | null }, p: ApplyParams): Promise<Payment> {
    // El correlativo es `max + 1` por empresa: sin candado, dos pagos de créditos distintos tomaban el mismo número y uno fallaba por la unicidad.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'receipt:' + this.tenant.accountId}))`;
    const agg = await tx.payment.aggregate({ _max: { receiptNumber: true } });
    const receiptNumber = (agg._max.receiptNumber ?? 0) + 1;
    try {
      return await tx.payment.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: credit.id,
          branchId: credit.branchId,
          amount: p.amount,
          method: p.method,
          provider: p.provider,
          externalTransactionId: p.externalTransactionId,
          idempotencyKey: p.idempotencyKey,
          receiptNumber,
          receiptUrl: p.receiptUrl,
          receiptHash: p.receiptHash,
          receiptReference: p.receiptReference,
          registeredVia: p.registeredVia,
          registeredBy: this.tenant.userId,
          visitId: p.visitId,
          channel: p.channel,
          notes: p.notes,
          ...(p.paymentDate ? { paymentDate: new Date(p.paymentDate) } : {}),
        },
      });
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') throw paymentDuplicate();
      throw e;
    }
  }

  async list(query: ListPaymentsQueryDto): Promise<ApiResponse<ReturnType<typeof serializePayment>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.PaymentWhereInput = {};
    if (query.creditId) where.creditId = query.creditId;
    // Varios oficiales o medios llegan como lista separada por coma (el DTO ya validó cada valor).
    if (query.registeredBy) where.registeredBy = { in: query.registeredBy.split(',') };
    if (query.method) where.method = { in: query.method.split(',') as PaymentMethod[] };
    /*
     * 🔴 **El pago no tiene `client_id`, y no hace falta que lo tenga.** Cuelga del crédito, y el
     * crédito del cliente: preguntar «los pagos de esta persona» es un `JOIN`, no una llamada por
     * cada crédito suyo. La ficha del cliente muestra las últimas cobranzas de TODOS sus créditos
     * juntos, que es como se mira un historial — nadie pregunta «cuánto pagó del crédito 2».
     */
    // Cliente y fuente son del crédito: comparten `where.credit`, o el segundo pisaría al primero.
    if (query.clientId || query.source) {
      where.credit = {
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.source ? { externalSource: query.source === 'KOBRAX' ? null : query.source } : {}),
      };
    }
    /*
     * Todo menos las fechas. Las tarjetas de «hoy» y «este mes» conservan su significado de día y mes civil, así que
     * ignoran el rango pedido y respetan el resto (fuente, medio, oficial, crédito).
     */
    const base: Prisma.PaymentWhereInput = { ...where };
    if (query.day) {
      // El día es el CIVIL de la empresa (mismo criterio que las visitas): [00:00 del día, 00:00 del siguiente).
      const tz = await this.clock.timezone();
      const next = new Date(new Date(`${query.day}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
      where.paymentDate = { gte: civilDayStartInstant(query.day, tz), lt: civilDayStartInstant(next, tz) };
    } else if (query.from || query.to) {
      where.paymentDate = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) };
    }

    /*
     * El orden. Por defecto, lo último cobrado primero: un ledger se abre para ver qué entró recién.
     *
     * 🔴 **Los que faltan van al final en los dos sentidos.** El comprobante es opcional, y en
     * Postgres los nulos van primero al ordenar descendente: pedir «mayor número de comprobante»
     * devolvía una página entera de pagos sin comprobante. Un dato que no está no es el más alto ni
     * el más bajo.
     */
    const dir = query.dir ?? 'desc';
    const orderBy: Prisma.PaymentOrderByWithRelationInput = !query.sort
      ? { paymentDate: 'desc' }
      : query.sort === 'receiptNumber'
        ? // ⚠️ `nulls` va SÓLO en el campo que admite nulos: Prisma lo rechaza en tiempo de
          // ejecución sobre una columna `NOT NULL`, y el tipado no lo agarra con una clave calculada.
          { receiptNumber: { sort: dir, nulls: 'last' } }
        : { [query.sort]: dir };

    // Las ventanas de «hoy» y «este mes» de la empresa: [00:00 del primero, 00:00 del siguiente).
    const windows = query.summary ? await this.summaryWindows() : undefined;

    const [rows, total, names, sum, extra] = await this.tx(async (tx) => {
      const ids = await this.visibleCreditIds(tx);
      const scoped = (w: Prisma.PaymentWhereInput): Prisma.PaymentWhereInput => (ids ? { ...w, AND: [{ creditId: { in: ids } }] } : w);
      const [found, count, agg, today, month] = await Promise.all([
        // La fuente del crédito viaja con la fila (D7): el ledger dice qué cobro fue sobre un PSF.
        tx.payment.findMany({ where: scoped(where), orderBy, skip, take: limit, include: { credit: { select: { externalSource: true } } } }),
        tx.payment.count({ where: scoped(where) }),
        // Lo cobrado en TODO el filtro, no en la página: la lista no puede sumar lo que no trajo.
        tx.payment.aggregate({ where: scoped(where), _sum: { amount: true } }),
        windows ? tx.payment.aggregate({ where: scoped({ ...base, paymentDate: windows.today }), _sum: { amount: true } }) : undefined,
        windows ? tx.payment.aggregate({ where: scoped({ ...base, paymentDate: windows.month }), _sum: { amount: true } }) : undefined,
      ]);
      // Quién registró cada pago: UNA consulta para la página, sin exigir `user:read`.
      return [found, count, await loadNames(tx, this.tenant.accountId, found.map((p) => p.registeredBy)), Number(agg._sum.amount ?? 0), { today: today?._sum.amount, month: month?._sum.amount }] as const;
    });
    return ResponseDto.paginated(
      rows.map((p) => ({ ...serializePayment(p, names), creditSource: p.credit.externalSource ?? undefined })),
      total,
      page,
      limit,
      {
        totalAmount: round2(sum),
        ...(windows ? { todayAmount: round2(Number(extra.today ?? 0)), monthAmount: round2(Number(extra.month ?? 0)) } : {}),
      },
    );
  }

  /**
   * El historial de pagos de UN crédito, con a qué cuotas se aplicó cada uno y el saldo del plan después de cada movimiento.
   *
   * Sale de lo persistido (`payment_applications`) y del MISMO plan actualizado que ven Cartera y Mora (`loadCreditPlan`): nada se
   * recalcula acá. Mismo alcance que la lectura del crédito: fuera de él, 404 (no se confirma que exista). Sin período por defecto:
   * es TODO el historial, a diferencia del ledger general que se mira por mes.
   */
  async forCredit(creditId: string) {
    const out = await this.tx(async (tx) => {
      await this.assertCreditInScope(tx, creditId);
      const credit = await tx.credit.findFirst({ where: { id: creditId, deletedAt: null }, include: { installments: true } });
      if (!credit) return null;
      const [payments, plan] = await Promise.all([
        tx.payment.findMany({ where: { creditId }, orderBy: [{ createdAt: 'asc' }, { receiptNumber: 'asc' }] }),
        accountToday(tx, this.tenant.accountId).then((today) => loadCreditPlan(tx, this.tenant.accountId, credit, today)),
      ]);
      const names = await loadNames(tx, this.tenant.accountId, payments.map((p) => p.registeredBy));
      const lateInterest = credit.latePolicyVersionId ? await lateSummaryOfCredit(tx, this.tenant.accountId, creditId) : null;
      return { credit, payments, plan, names, lateInterest };
    });
    if (!out) throw resourceNotFound();
    const byPayment = new Map((out.plan?.payments ?? []).map((b) => [b.paymentId, b]));
    return {
      creditId,
      code: out.credit.code ?? undefined,
      clientId: out.credit.clientId,
      currency: out.credit.currency,
      // F17: interés moratorio del crédito (línea aparte del plan, P5). `null` = no devenga.
      lateInterest: out.lateInterest,
      // `null` = sin plan (préstamo abierto) o una operación de una fuente externa: se listan los pagos sin imputación.
      plan: out.plan
        ? {
            planTotal: out.plan.planTotal,
            prepaidAmount: out.plan.prepaidAmount,
            collectedAmount: out.plan.collectedAmount,
            balance: out.plan.balance,
            overdueAmount: out.plan.overdueAmount,
            situation: out.plan.situation,
            nextPayment: out.plan.nextPayment,
          }
        : null,
      // Del más reciente al más antiguo, como un ledger; el saldo posterior se calculó en el orden en que se registraron.
      payments: [...out.payments].reverse().map((p) => {
        const b = byPayment.get(p.id);
        return {
          ...serializePayment(p, out.names),
          // «Registrado» es el único estado hoy: no hay anulación. Cuando exista, sale de acá.
          status: 'REGISTERED' as const,
          registeredAt: p.createdAt,
          imputation: b ? { allocations: b.allocations, applied: b.applied, unapplied: b.unapplied, balanceAfter: b.balanceAfter, unrecorded: b.unrecorded === true } : undefined,
        };
      }),
    };
  }

  /** Hoy y este mes **civiles de la empresa**: a las 21:00 en La Paz ya es mañana en UTC, y no por eso se cobró «mañana». */
  private async summaryWindows(): Promise<{ today: { gte: Date; lt: Date }; month: { gte: Date; lt: Date } }> {
    const tz = await this.clock.timezone();
    const day = (d: Date): string => d.toISOString().slice(0, 10);
    const today = civilTodayUTC(tz);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const monthStart = civilMonthStartUTC(tz);
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    return {
      today: { gte: civilDayStartInstant(day(today), tz), lt: civilDayStartInstant(day(tomorrow), tz) },
      month: { gte: civilDayStartInstant(day(monthStart), tz), lt: civilDayStartInstant(day(nextMonth), tz) },
    };
  }

  async findOne(id: string) {
    const found = await this.tx(async (tx) => {
      const ids = await this.visibleCreditIds(tx);
      const row = await tx.payment.findFirst({ where: ids ? { id, creditId: { in: ids } } : { id } });
      if (!row) return null;
      /*
       * La visita en la que se cobró, si la hubo: de ella salen **quién cobró** —que no siempre es quien cargó el pago:
       * desde el panel se carga una visita a nombre de un cobrador— y a qué parada lleva el enlace. Sólo ids y un nombre:
       * nada de lo que revela el detalle de la visita (punto en el mapa, evidencia), que se audita aparte.
       */
      const visit = row.visitId
        ? await tx.fieldVisit.findFirst({
            where: { id: row.visitId },
            select: { collectorId: true, routeStop: { select: { id: true, routeId: true } } },
          })
        : null;
      const names = await loadNames(tx, this.tenant.accountId, [row.registeredBy, visit?.collectorId]);
      return { row, names, visit };
    });
    if (!found) throw resourceNotFound();
    const { row, names, visit } = found;
    return {
      ...serializePayment(row, names),
      ...(visit
        ? {
            visit: {
              collectorId: visit.collectorId,
              collectorName: names.get(visit.collectorId),
              routeId: visit.routeStop?.routeId,
              stopId: visit.routeStop?.id,
            },
          }
        : {}),
    };
  }

  // ── Solicitudes de pago digital (QR / link) ──────────────────────────────────
  async createRequest(dto: CreatePaymentRequestDto) {
    const reference = randomBytes(12).toString('base64url');
    const req = await this.tx(async (tx) => {
      if (dto.creditId) await this.assertCreditInScope(tx, dto.creditId);
      const created = await tx.paymentRequest.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: dto.creditId,
          clientId: dto.clientId,
          amount: dto.amount,
          method: dto.method ?? 'QR',
          reference,
          qrPayload: `KOBRAX|${reference}|${dto.amount}`,
          url: `https://pay.kobrax.demo/${reference}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          createdBy: this.tenant.userId,
        },
      });
      await this.audit.recordInTx(tx, { entity: 'payment_request', entityId: created.id, action: 'CREATE', after: { amount: Number(created.amount), method: created.method } });
      return created;
    });
    return serializePaymentRequest(req);
  }

  /**
   * La bandeja de cobros pedidos. Antes sólo se podía leer uno por id, así que quien confirma no tenía
   * dónde ver qué esperaba. Lo último pedido primero.
   *
   * ⚠️ `status` es el guardado: una solicitud vencida (`expiresAt` pasado) sigue `PENDING` y se puede
   * confirmar — el deudor puede pagar pasadas las 24 h y la plata entró igual. La fila lleva `expiresAt`
   * para que la pantalla lo diga.
   */
  async listRequests(query: ListPaymentRequestsQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.PaymentRequestWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.creditId) where.creditId = query.creditId;
    if (query.createdBy) where.createdBy = query.createdBy;

    const [rows, total, names, credits] = await this.tx(async (tx) => {
      const ids = await this.visibleCreditIds(tx);
      const scoped: Prisma.PaymentRequestWhereInput = ids ? { ...where, AND: [{ creditId: { in: ids } }] } : where;
      const [found, count] = await Promise.all([
        tx.paymentRequest.findMany({ where: scoped, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        tx.paymentRequest.count({ where: scoped }),
      ]);
      // Crédito y cliente de la página: UNA consulta, sin N+1. La solicitud no tiene relación con ellos.
      const creditIds = [...new Set(found.map((r) => r.creditId).filter((id): id is string => !!id))];
      const creditRows = creditIds.length
        ? await tx.credit.findMany({
            where: { id: { in: creditIds } },
            select: { id: true, code: true, client: { select: { firstName: true, lastName: true, businessName: true } } },
          })
        : [];
      return [found, count, await loadNames(tx, this.tenant.accountId, found.map((r) => r.createdBy)), creditRows] as const;
    });

    const byCredit = new Map(credits.map((c) => [c.id, c]));
    return ResponseDto.paginated(
      rows.map((r) => {
        const c = r.creditId ? byCredit.get(r.creditId) : undefined;
        const clientName = c ? c.client.businessName ?? ([c.client.firstName, c.client.lastName].filter(Boolean).join(' ') || undefined) : undefined;
        return serializePaymentRequest(r, { names, creditCode: c?.code ?? undefined, clientName });
      }),
      total,
      page,
      limit,
    );
  }

  async getRequest(id: string) {
    const req = await this.tx(async (tx) => {
      const ids = await this.visibleCreditIds(tx);
      return tx.paymentRequest.findFirst({ where: ids ? { id, creditId: { in: ids } } : { id } });
    });
    if (!req) throw resourceNotFound();
    return serializePaymentRequest(req);
  }

  /** Concilia una solicitud: crea el pago y la marca PAID. */
  async confirmRequest(id: string, dto: ConfirmPaymentRequestDto) {
    const { payment } = await this.tx(async (tx) => {
      const req = await tx.paymentRequest.findFirst({ where: { id } });
      if (!req) throw resourceNotFound();
      if (req.status !== 'PENDING') throw requestNotPending();
      if (!req.creditId) throw paymentInvalid('La solicitud no tiene crédito asociado');

      const r = await this.applyCore(tx, { creditId: req.creditId, amount: Number(req.amount), method: req.method, externalTransactionId: dto.externalTransactionId, provider: 'payment_request' });
      await tx.paymentRequest.update({ where: { id }, data: { status: 'PAID', paidPaymentId: r.payment.id } });
      await this.audit.recordInTx(tx, { entity: 'payment', entityId: r.payment.id, action: 'CREATE', after: { creditId: r.payment.creditId, amount: Number(r.payment.amount), source: 'payment_request' } });
      return r;
    });

    this.events.emit(DomainEvent.PAYMENT_REGISTERED, { paymentId: payment.id, creditId: payment.creditId, amount: Number(payment.amount), accountId: this.tenant.accountId });
    return serializePayment(payment);
  }
}

/** Un cobro no puede ser del futuro ni de hace más de `PAYMENT_BACKDATE_DAYS` días. */
function assertPaymentDate(d: Date, now: Date = new Date()): void {
  if (Number.isNaN(d.getTime())) throw paymentInvalid('La fecha del pago no es válida');
  if (d.getTime() > now.getTime() + CLOCK_SKEW_MS) throw paymentInvalid('La fecha del pago no puede ser futura');
  if (now.getTime() - d.getTime() > PAYMENT_BACKDATE_DAYS * 86_400_000) {
    throw paymentInvalid(`La fecha del pago no puede ser de hace más de ${PAYMENT_BACKDATE_DAYS} días`);
  }
}

/** `insertPayment` traduce la violación de unicidad (P2002) a `PAYMENT_DUP`. */
function isPaymentDuplicate(err: unknown): boolean {
  return (err as { response?: { code?: string } } | null)?.response?.code === 'PAYMENT_DUP';
}
