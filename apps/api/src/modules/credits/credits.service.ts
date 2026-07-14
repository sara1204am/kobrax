import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, CasePriority, CaseStatus } from '@prisma/client';
import {
  arrearsFromDueDate,
  CreditOrigin,
  isExternalOrigin,
  PaymentFrequency,
  readCreditMetadata,
  resolvePagination,
  type ApiResponse,
  type CreditMetadata,
  ResponseDto,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  buildSchedule,
  computeArrears,
  scheduleIsBalanced,
  DEFAULT_ARREAR_PARAMS,
  type ArrearParams,
} from './credit-math';
import { serializeCredit } from './credits.serializer';
import { CreateCreditDto, ListCreditsQueryDto, UpdateCreditDto } from './dto/credit.dto';
import { currencyMismatch, resourceNotFound, scheduleInvalid } from './credits.errors';

interface AccountConfig {
  currencyCode: string;
  labels: Record<string, string>;
  arrears: ArrearParams;
}

@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Config del tenant (moneda, etiquetas de concepto, parámetros de mora). `accounts` tiene RLS → leer con contexto. */
  private async accountConfig(): Promise<AccountConfig> {
    const account = await this.tx((tx) => tx.account.findUnique({ where: { id: this.tenant.accountId } }));
    const cfg = (account?.configuration ?? {}) as {
      creditLabels?: Record<string, string>;
      arrears?: Partial<ArrearParams>;
    };
    return {
      currencyCode: account?.currencyCode ?? 'USD',
      labels: cfg.creditLabels ?? {},
      arrears: { ...DEFAULT_ARREAR_PARAMS, ...(cfg.arrears ?? {}) },
    };
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
  async create(dto: CreateCreditDto): Promise<ReturnType<typeof serializeCredit>> {
    const config = await this.accountConfig();
    const currency = dto.currency ?? config.currencyCode;
    if (dto.currency && dto.currency !== config.currencyCode) throw currencyMismatch(config.currencyCode);

    const disbursedAt = dto.disbursedAt ? new Date(dto.disbursedAt) : new Date();
    const firstDueDate = dto.firstDueDate ? new Date(dto.firstDueDate) : addMonths(disbursedAt, 1);

    /**
     * Dos formas de nacer, y las distingue un solo dato (spec §4, §7, §8):
     *  · con `installmentAmount` → crédito de cobranza: la cuota viene **congelada** del móvil y
     *    NO se genera cronograma. Es el único modo que admite el préstamo abierto (sin `n`).
     *  · sin él → comportamiento de siempre (web/importador): cronograma amortizado.
     */
    const frozenInstallment = dto.installmentAmount !== undefined;
    const schedule = frozenInstallment
      ? []
      : buildSchedule({
          principal: dto.principalAmount,
          periodicRate: dto.interestRate ?? 0,
          count: dto.installmentsCount ?? 1,
          type: dto.amortizationType ?? 'FRENCH',
          firstDueDate,
        });
    if (!frozenInstallment && !scheduleIsBalanced(dto.principalAmount, schedule)) throw scheduleInvalid();

    const metadata: CreditMetadata = {
      frequency: dto.frequency ?? PaymentFrequency.MONTHLY,
      origin: dto.origin ?? CreditOrigin.MANUAL,
      installmentAmount: dto.installmentAmount,
      nextDueDate: dto.nextDueDate?.slice(0, 10) ?? (frozenInstallment ? isoDate(firstDueDate) : undefined),
      externalRef: dto.externalRef,
      notes: dto.notes,
    };
    // "Este préstamo ya está en curso" (§4.1): sin el toggle, saldo = capital y mora = 0.
    const outstandingBalance = dto.outstandingBalance ?? dto.principalAmount;
    const daysPastDue = dto.daysPastDue ?? 0;

    const accountId = this.tenant.accountId;
    const created = await this.tx(async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: dto.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) throw resourceNotFound(); // cliente inexistente o de otro tenant

      const credit = await tx.credit.create({
        data: {
          accountId,
          clientId: dto.clientId,
          branchId: dto.branchId,
          code: dto.code,
          principalAmount: dto.principalAmount,
          outstandingBalance,
          interestRate: dto.interestRate ?? 0,
          currency,
          installmentsCount: dto.installmentsCount ?? 0, // 0 = préstamo abierto (§4.1)
          daysPastDue,
          assignedManagerId: dto.assignedManagerId,
          disbursedAt,
          metadata: stripUndefined(metadata),
          installments: {
            create: schedule.map((s) => ({
              accountId,
              number: s.number,
              dueDate: s.dueDate,
              amount: s.amount,
              principal: s.principal,
              interest: s.interest,
            })),
          },
        },
        include: { installments: { orderBy: { number: 'asc' } } },
      });

      // Caso de cobranza automático (§5.2): "para el cobrador, cliente y préstamo son una sola acción".
      if (dto.openCase) {
        const kase = await tx.collectionCase.create({
          data: {
            accountId,
            creditId: credit.id,
            clientId: dto.clientId,
            branchId: dto.branchId,
            assigneeId: this.tenant.userId,
            status: CaseStatus.PENDING,
            priority: priorityFromArrears(daysPastDue),
          },
        });
        // Próxima fecha de cobro en la agenda del cobrador (§5.2). Recordatorio de día (sin hora).
        // Solo por el alta del móvil (`openCase`); la web/import usa `cases/generate` → no genera agenda.
        let agendaId: string | undefined;
        if (metadata.nextDueDate && this.tenant.userId) {
          const item = await tx.agendaItem.create({
            data: {
              accountId,
              caseId: kase.id,
              clientId: dto.clientId,
              creditId: credit.id,
              assigneeId: this.tenant.userId,
              type: AgendaItemType.REMINDER,
              status: AgendaItemStatus.SCHEDULED,
              scheduledDate: new Date(metadata.nextDueDate),
              details: { description: 'Cobrar cuota' },
              createdBy: this.tenant.userId,
            },
          });
          agendaId = item.id;
        }
        return { credit, caseId: kase.id, agendaId };
      }
      return { credit, caseId: undefined, agendaId: undefined };
    });

    await this.audit.record({ entity: 'credit', entityId: created.credit.id, action: 'CREATE', after: creditSummary(created.credit) });
    if (created.caseId) {
      await this.audit.record({ entity: 'collection_case', entityId: created.caseId, action: 'CREATE', after: { creditId: created.credit.id, clientId: dto.clientId, source: 'credit_create' } });
    }
    if (created.agendaId) {
      await this.audit.record({ entity: 'agenda_item', entityId: created.agendaId, action: 'CREATE', after: { creditId: created.credit.id, caseId: created.caseId, source: 'credit_create' } });
    }
    return serializeCredit(created.credit, config.labels);
  }

  async list(query: ListCreditsQueryDto): Promise<ApiResponse<ReturnType<typeof serializeCredit>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const config = await this.accountConfig();
    const where: Prisma.CreditWhereInput = { deletedAt: null };
    if (query.clientId) where.clientId = query.clientId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;

    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.credit.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        tx.credit.count({ where }),
      ]),
    );
    return ResponseDto.paginated(
      rows.map((c) => serializeCredit(c, config.labels)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<ReturnType<typeof serializeCredit>> {
    const config = await this.accountConfig();
    const credit = await this.tx((tx) =>
      tx.credit.findFirst({
        where: { id, deletedAt: null },
        include: { installments: { orderBy: { number: 'asc' } }, arrears: true },
      }),
    );
    if (!credit) throw resourceNotFound();
    return serializeCredit(credit, config.labels);
  }

  async getSchedule(id: string) {
    const credit = await this.findOne(id);
    return { creditId: credit.id, installments: credit.installments ?? [] };
  }

  async update(id: string, dto: UpdateCreditDto): Promise<ReturnType<typeof serializeCredit>> {
    const config = await this.accountConfig();
    const { before, after } = await this.tx(async (tx) => {
      const prev = await tx.credit.findFirst({ where: { id, deletedAt: null } });
      if (!prev) throw resourceNotFound();
      const next = await tx.credit.update({
        where: { id },
        data: {
          status: dto.status,
          assignedManagerId: dto.assignedManagerId,
          branchId: dto.branchId,
          code: dto.code,
        },
      });
      return { before: prev, after: next };
    });
    await this.audit.record({ entity: 'credit', entityId: id, action: 'UPDATE', before: creditSummary(before), after: creditSummary(after) });
    return serializeCredit(after, config.labels);
  }

  // ── Mora ──────────────────────────────────────────────────────────────────
  async recalculateArrears(id: string, asOfInput?: string) {
    const config = await this.accountConfig();
    const asOf = asOfInput ? new Date(asOfInput) : new Date();

    const result = await this.tx(async (tx) => {
      const credit = await tx.credit.findFirst({
        where: { id, deletedAt: null },
        include: { installments: true },
      });
      if (!credit) throw resourceNotFound();

      const meta = readCreditMetadata(credit.metadata);

      // Cartera de un core ajeno: manda el valor del archivo "hasta la siguiente carga" (spec §6).
      // Sin esta guarda, un recálculo le borraba la mora que trajo la importación.
      if (isExternalOrigin(meta.origin)) {
        return { daysOverdue: credit.daysPastDue, overdueAmount: 0, interest: 0, penalty: 0, overdueInstallmentIds: [], skipped: 'EXTERNAL_ORIGIN' as const };
      }

      // Crédito sin cronograma (el del móvil): la mora sale de la próxima fecha, no de las cuotas.
      // `computeArrears` sobre un array vacío devuelve 0 y borraba la mora real.
      if (credit.installments.length === 0) {
        const daysOverdue = arrearsFromDueDate(meta.nextDueDate, Number(credit.outstandingBalance), asOf);
        await tx.credit.update({ where: { id }, data: { daysPastDue: daysOverdue } });
        return { daysOverdue, overdueAmount: daysOverdue > 0 ? Number(credit.outstandingBalance) : 0, interest: 0, penalty: 0, overdueInstallmentIds: [] };
      }

      const arrear = computeArrears(
        credit.installments.map((i) => ({
          id: i.id,
          dueDate: i.dueDate,
          amount: Number(i.amount),
          paidAmount: Number(i.paidAmount),
          status: i.status,
        })),
        config.arrears,
        asOf,
      );

      // Marca como OVERDUE las cuotas vencidas (no pagadas).
      if (arrear.overdueInstallmentIds.length > 0) {
        await tx.creditInstallment.updateMany({
          where: { id: { in: arrear.overdueInstallmentIds }, status: { not: 'PAID' } },
          data: { status: 'OVERDUE' },
        });
      }
      await tx.credit.update({ where: { id }, data: { daysPastDue: arrear.daysOverdue } });
      // Snapshot único por crédito (idempotente): reemplaza el anterior.
      await tx.arrear.deleteMany({ where: { creditId: id } });
      await tx.arrear.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: id,
          daysOverdue: arrear.daysOverdue,
          overdueAmount: arrear.overdueAmount,
          interest: arrear.interest,
          penalty: arrear.penalty,
          calculatedAt: asOf,
        },
      });
      return arrear;
    });

    await this.audit.record({ entity: 'credit', entityId: id, action: 'ARREARS_RECALC', after: result });
    return result;
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Prisma rechaza `undefined` dentro de un JSON. */
function stripUndefined(meta: CreditMetadata): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Prisma.InputJsonObject;
}

/** Prioridad del caso derivada de la mora (spec §5.2). */
export function priorityFromArrears(days: number): CasePriority {
  if (days <= 0) return CasePriority.LOW;
  if (days <= 30) return CasePriority.MEDIUM;
  if (days <= 90) return CasePriority.HIGH;
  return CasePriority.CRITICAL;
}

/** Resumen plano (JSON-safe, sin Decimal/Date crudos de Prisma) para los snapshots de auditoría. */
function creditSummary(c: {
  id: string;
  clientId: string;
  code: string | null;
  principalAmount: unknown;
  outstandingBalance: unknown;
  currency: string;
  installmentsCount: number;
  status: string;
  daysPastDue: number;
  assignedManagerId: string | null;
}): Record<string, unknown> {
  return {
    id: c.id,
    clientId: c.clientId,
    code: c.code ?? undefined,
    principalAmount: Number(c.principalAmount),
    outstandingBalance: Number(c.outstandingBalance),
    currency: c.currency,
    installmentsCount: c.installmentsCount,
    status: c.status,
    daysPastDue: c.daysPastDue,
    assignedManagerId: c.assignedManagerId ?? undefined,
  };
}
