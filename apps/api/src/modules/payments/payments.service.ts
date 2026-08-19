import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Payment, PaymentMethod, Prisma, PrismaClient } from '@prisma/client';
import { CaseStatus, CreditStatus } from '@prisma/client';
import { resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { applyPayment, creditPatchAfterPayment } from './payment-apply';
import { serializePayment, serializePaymentRequest } from './payments.serializer';
import { ConfirmPaymentRequestDto, CreatePaymentDto, CreatePaymentRequestDto, ListPaymentsQueryDto } from './dto/payment.dto';
import { creditNotActive, paymentDuplicate, paymentInvalid, requestNotPending, resourceNotFound } from './payments.errors';

const round2 = (x: number): number => Math.round(x * 100) / 100;

interface ApplyParams {
  creditId: string;
  amount: number;
  method: PaymentMethod;
  caseId?: string;
  provider?: string;
  externalTransactionId?: string;
  idempotencyKey?: string;
  /** Comprobante (§5.4). El hash lo calcula `POST /uploads` sobre el buffer original. */
  receiptUrl?: string;
  receiptHash?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  // ── Registro de pago (ledger inmutable) ──────────────────────────────────────
  async register(dto: CreatePaymentDto, idempotencyKey?: string) {
    const { payment, replay } = await this.tx(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.payment.findFirst({ where: { idempotencyKey } });
        if (existing) return { payment: existing, replay: true }; // reintento → no duplica
      }
      const { payment } = await this.applyCore(tx, { ...dto, idempotencyKey });
      return { payment, replay: false };
    });

    if (!replay) {
      await this.audit.record({ entity: 'payment', entityId: payment.id, action: 'CREATE', after: { creditId: payment.creditId, amount: Number(payment.amount), method: payment.method } });
      this.events.emit(DomainEvent.PAYMENT_REGISTERED, { paymentId: payment.id, creditId: payment.creditId, amount: Number(payment.amount), accountId: this.tenant.accountId });
    }
    return { ...serializePayment(payment), idempotentReplay: replay };
  }

  /** Aplicación atómica del pago a la deuda (cuota → saldo → mora). Dentro de una transacción. */
  private async applyCore(tx: PrismaClient, p: ApplyParams): Promise<{ payment: Payment; creditPaid: boolean }> {
    if (p.amount <= 0) throw paymentInvalid('El monto debe ser mayor a 0');

    const credit = await tx.credit.findFirst({ where: { id: p.creditId, deletedAt: null }, include: { installments: true } });
    if (!credit) throw resourceNotFound();
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

    /*
     * 🔴 **Saldada la deuda, el caso se cierra acá mismo.** Antes el pago dejaba el crédito en `PAID`
     * y **no tocaba el caso**: quedaba abierto, seguía entrando a las rutas y el cobrador volvía a
     * visitar a quien ya había pagado. Cerrarlo era tres pasos a mano, con permiso `case:close` y
     * una gestión registrada — que si cobró por transferencia nunca existió.
     *
     * Va en la misma transacción que el pago, no en el trabajo diario: entre que se cobra y que
     * corre el job hay horas, y en esas horas el caso sigue en la ruta de alguien.
     *
     * Sin `CASE_TRANSITIONS` y sin exigir gestión, por lo mismo que el cierre automático del job:
     * la máquina de estados gobierna la negociación, y acá no hay negociación — hay una deuda que
     * dejó de existir. `closedBy` nulo: no lo cerró una persona.
     */
    if (creditPaid) {
      await tx.collectionCase.updateMany({
        where: { creditId: credit.id, deletedAt: null, status: { notIn: [CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF] } },
        data: { status: CaseStatus.CLOSED, closedAt: now, closedReason: 'PAID', lastActionAt: now },
      });
    }

    const agg = await tx.payment.aggregate({ _max: { receiptNumber: true } });
    const receiptNumber = (agg._max.receiptNumber ?? 0) + 1;
    try {
      const payment = await tx.payment.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: credit.id,
          branchId: credit.branchId,
          caseId: p.caseId,
          amount: p.amount,
          method: p.method,
          provider: p.provider,
          externalTransactionId: p.externalTransactionId,
          idempotencyKey: p.idempotencyKey,
          receiptNumber,
          receiptUrl: p.receiptUrl,
          receiptHash: p.receiptHash,
          registeredBy: this.tenant.userId,
        },
      });
      return { payment, creditPaid };
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') throw paymentDuplicate();
      throw e;
    }
  }

  async list(query: ListPaymentsQueryDto): Promise<ApiResponse<ReturnType<typeof serializePayment>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.PaymentWhereInput = {};
    if (query.creditId) where.creditId = query.creditId;
    if (query.caseId) where.caseId = query.caseId;
    /*
     * 🔴 **El pago no tiene `client_id`, y no hace falta que lo tenga.** Cuelga del crédito, y el
     * crédito del cliente: preguntar «los pagos de esta persona» es un `JOIN`, no una llamada por
     * cada crédito suyo. La ficha del cliente muestra las últimas cobranzas de TODOS sus créditos
     * juntos, que es como se mira un historial — nadie pregunta «cuánto pagó del crédito 2».
     */
    if (query.clientId) where.credit = { clientId: query.clientId };
    if (query.from || query.to) where.paymentDate = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) };

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

    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.payment.findMany({ where, orderBy, skip, take: limit }),
        tx.payment.count({ where }),
      ]),
    );
    return ResponseDto.paginated(rows.map(serializePayment), total, page, limit);
  }

  async findOne(id: string) {
    const payment = await this.tx((tx) => tx.payment.findFirst({ where: { id } }));
    if (!payment) throw resourceNotFound();
    return serializePayment(payment);
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
          caseId: dto.caseId,
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

      const r = await this.applyCore(tx, { creditId: req.creditId, amount: Number(req.amount), method: req.method, caseId: req.caseId ?? undefined, externalTransactionId: dto.externalTransactionId, provider: 'payment_request' });
      await tx.paymentRequest.update({ where: { id }, data: { status: 'PAID', paidPaymentId: r.payment.id } });
      return r;
    });

    await this.audit.record({ entity: 'payment', entityId: payment.id, action: 'CREATE', after: { creditId: payment.creditId, amount: Number(payment.amount), source: 'payment_request' } });
    this.events.emit(DomainEvent.PAYMENT_REGISTERED, { paymentId: payment.id, creditId: payment.creditId, amount: Number(payment.amount), accountId: this.tenant.accountId });
    return serializePayment(payment);
  }
}
