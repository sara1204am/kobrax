import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Payment, PaymentChannel, PaymentMethod, Prisma, PrismaClient } from '@prisma/client';
import { CreditStatus } from '@prisma/client';
import { isExternalOrigin, readCreditMetadata, resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { TenantClockService, civilDayStartInstant, civilMonthStartUTC, civilTodayUTC } from '../../common/context/tenant-clock.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { applyPayment, creditPatchAfterPayment } from './payment-apply';
import { loadNames } from '../mora/mora-names';
import { serializePayment, serializePaymentRequest } from './payments.serializer';
import { ConfirmPaymentRequestDto, CreatePaymentDto, CreatePaymentRequestDto, ListPaymentRequestsQueryDto, ListPaymentsQueryDto } from './dto/payment.dto';
import { creditNotActive, paymentDuplicate, paymentInvalid, requestNotPending, resourceNotFound } from './payments.errors';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Hasta cuántos días atrás puede fecharse un cobro. Cubre al cobrador que pasa una semana sin señal y
 * sincroniza al volver; más atrás ya no es un pago offline, es una corrección de historia.
 */
export const PAYMENT_BACKDATE_DAYS = 30;
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

  // ── Registro de pago (ledger inmutable) ──────────────────────────────────────
  async register(dto: CreatePaymentDto, idempotencyKey?: string, viaHint?: 'WEB' | 'MOBILE') {
    const run = () => this.tx(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.payment.findFirst({ where: { idempotencyKey } });
        if (existing) return { payment: existing, replay: true, external: false }; // reintento → no duplica
      }
      const { payment, external } = await this.applyCore(tx, { ...dto, registeredVia: dto.registeredVia ?? viaHint, idempotencyKey });
      return { payment, replay: false, external };
    });
    // Dos envíos con la misma clave a la vez (el intento en vivo y la cola offline) pasan los dos el chequeo y uno
    // choca con la unicidad (account_id, idempotency_key): su transacción se deshace y se repite UNA vez, y esta vez
    // el chequeo encuentra el pago que registró el otro y responde igual que un reintento normal, no un 500/409.
    const { payment, replay, external } = await run().catch((err: unknown) =>
      idempotencyKey && isPaymentDuplicate(err) ? run() : Promise.reject(err),
    );

    if (!replay) {
      // Qué se cobró, cuándo y por qué canal, y si fue sobre una operación externa: con esto y los
      // snapshots del reporte se contesta «quién consiguió el pago, cuándo y cómo» (§13).
      await this.audit.record({
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
        },
      });
      this.events.emit(DomainEvent.PAYMENT_REGISTERED, { paymentId: payment.id, creditId: payment.creditId, amount: Number(payment.amount), accountId: this.tenant.accountId });
    }
    return { ...serializePayment(payment), idempotentReplay: replay };
  }

  /** Aplicación atómica del pago a la deuda (cuota → saldo → mora). Dentro de una transacción. */
  private async applyCore(tx: PrismaClient, p: ApplyParams): Promise<{ payment: Payment; creditPaid: boolean; external: boolean }> {
    if (p.amount <= 0) throw paymentInvalid('El monto debe ser mayor a 0');
    if (p.paymentDate) assertPaymentDate(new Date(p.paymentDate));

    const credit = await tx.credit.findFirst({ where: { id: p.creditId, deletedAt: null }, include: { installments: true } });
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
     * estado. Lo único que escribe es el `Payment`, que es lo que cuenta como recuperado.
     */
    if (isExternalOrigin(readCreditMetadata(credit.metadata, credit.origin).origin)) {
      const payment = await this.insertPayment(tx, credit, p);
      return { payment, creditPaid: false, external: true };
    }

    if (credit.status !== CreditStatus.ACTIVE) throw creditNotActive();

    const balance = Number(credit.outstandingBalance);
    if (p.amount > balance + 0.005) throw paymentInvalid('El monto excede el saldo pendiente');

    const lite = credit.installments.map((i) => ({ id: i.id, number: i.number, amount: Number(i.amount), paidAmount: Number(i.paidAmount), status: i.status, dueDate: i.dueDate }));
    const result = applyPayment(lite, p.amount);
    for (const u of result.updates) {
      await tx.creditInstallment.update({ where: { id: u.id }, data: { paidAmount: u.paidAmount, status: u.status, paidAt: u.paidAt } });
    }

    // El pago SIEMPRE descuenta el saldo (spec §5.4). Antes se restaba `result.applied`, que es 0
    // cuando el crédito no tiene cronograma (el del móvil): el dinero se registraba y la deuda
    // quedaba intacta. El cronograma dice a qué cuota imputar, no cuánto vale el pago.
    const now = new Date();
    const newBalance = round2(Math.max(0, balance - p.amount));
    const creditPaid = newBalance <= 0.005;

    // Estado efectivo del cronograma tras el pago → días de mora.
    const byId = new Map(result.updates.map((u) => [u.id, u]));
    const effective = lite.map((i) => ({ ...i, status: byId.get(i.id)?.status ?? i.status, paidAmount: byId.get(i.id)?.paidAmount ?? i.paidAmount }));

    await tx.credit.update({
      where: { id: credit.id },
      data: {
        outstandingBalance: newBalance,
        ...(creditPaid ? { status: CreditStatus.PAID } : {}),
        ...creditPatchAfterPayment({
          metadata: credit.metadata,
          installments: effective,
          amount: p.amount,
          newBalance,
          creditPaid,
          now,
        }),
      },
    });

    // Saldada la deuda el crédito queda `PAID` y el trigger de episodios termina la mora (F4/08): el pago
    // cuelga solo del crédito.

    const payment = await this.insertPayment(tx, credit, p);
    return { payment, creditPaid, external: false };
  }

  /** La fila del ledger (inmutable), con su número de recibo. La comparten el crédito propio y el externo. */
  private async insertPayment(tx: PrismaClient, credit: { id: string; branchId: string | null }, p: ApplyParams): Promise<Payment> {
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
      const [found, count, agg, today, month] = await Promise.all([
        // La fuente del crédito viaja con la fila (D7): el ledger dice qué cobro fue sobre un PSF.
        tx.payment.findMany({ where, orderBy, skip, take: limit, include: { credit: { select: { externalSource: true } } } }),
        tx.payment.count({ where }),
        // Lo cobrado en TODO el filtro, no en la página: la lista no puede sumar lo que no trajo.
        tx.payment.aggregate({ where, _sum: { amount: true } }),
        windows ? tx.payment.aggregate({ where: { ...base, paymentDate: windows.today }, _sum: { amount: true } }) : undefined,
        windows ? tx.payment.aggregate({ where: { ...base, paymentDate: windows.month }, _sum: { amount: true } }) : undefined,
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
      const row = await tx.payment.findFirst({ where: { id } });
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
    const req = await this.tx((tx) =>
      tx.paymentRequest.create({
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
      }),
    );
    await this.audit.record({ entity: 'payment_request', entityId: req.id, action: 'CREATE', after: { amount: Number(req.amount), method: req.method } });
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
      const [found, count] = await Promise.all([
        tx.paymentRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        tx.paymentRequest.count({ where }),
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
    const req = await this.tx((tx) => tx.paymentRequest.findFirst({ where: { id } }));
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
      return r;
    });

    await this.audit.record({ entity: 'payment', entityId: payment.id, action: 'CREATE', after: { creditId: payment.creditId, amount: Number(payment.amount), source: 'payment_request' } });
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
