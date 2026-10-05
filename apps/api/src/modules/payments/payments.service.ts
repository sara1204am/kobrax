import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Payment, PaymentChannel, PaymentMethod, Prisma, PrismaClient } from '@prisma/client';
import { CreditStatus } from '@prisma/client';
import { isExternalOrigin, readCreditMetadata, resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { applyPayment, creditPatchAfterPayment } from './payment-apply';
import { loadNames } from '../mora/mora-names';
import { serializePayment, serializePaymentRequest } from './payments.serializer';
import { ConfirmPaymentRequestDto, CreatePaymentDto, CreatePaymentRequestDto, ListPaymentsQueryDto } from './dto/payment.dto';
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
  channel?: PaymentChannel;
  notes?: string;
  /** ISO: cuándo se cobró (el pago offline). Ausente = ahora. */
  paymentDate?: string;
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
    const run = () => this.tx(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.payment.findFirst({ where: { idempotencyKey } });
        if (existing) return { payment: existing, replay: true, external: false }; // reintento → no duplica
      }
      const { payment, external } = await this.applyCore(tx, { ...dto, idempotencyKey });
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
    // ya no cierra casos ni escribe `case_id`; cuelga solo del crédito.

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
          registeredBy: this.tenant.userId,
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
    // `caseId` del query se ignora (F4/08): el pago cuelga solo del crédito.
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

    const [rows, total, names] = await this.tx(async (tx) => {
      const [found, count] = await Promise.all([
        // La fuente del crédito viaja con la fila (D7): el ledger dice qué cobro fue sobre un PSF.
        tx.payment.findMany({ where, orderBy, skip, take: limit, include: { credit: { select: { externalSource: true } } } }),
        tx.payment.count({ where }),
      ]);
      // Quién registró cada pago: UNA consulta para la página, sin exigir `user:read`.
      return [found, count, await loadNames(tx, this.tenant.accountId, found.map((p) => p.registeredBy))] as const;
    });
    return ResponseDto.paginated(
      rows.map((p) => ({ ...serializePayment(p, names), creditSource: p.credit.externalSource ?? undefined })),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string) {
    const found = await this.tx(async (tx) => {
      const row = await tx.payment.findFirst({ where: { id } });
      return row ? { row, names: await loadNames(tx, this.tenant.accountId, [row.registeredBy]) } : null;
    });
    if (!found) throw resourceNotFound();
    return serializePayment(found.row, found.names);
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
