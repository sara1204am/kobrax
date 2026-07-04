import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
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

    const schedule = buildSchedule({
      principal: dto.principalAmount,
      periodicRate: dto.interestRate ?? 0,
      count: dto.installmentsCount,
      type: dto.amortizationType ?? 'FRENCH',
      firstDueDate,
    });
    if (!scheduleIsBalanced(dto.principalAmount, schedule)) throw scheduleInvalid();

    const accountId = this.tenant.accountId;
    const created = await this.tx(async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: dto.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) throw resourceNotFound(); // cliente inexistente o de otro tenant

      return tx.credit.create({
        data: {
          accountId,
          clientId: dto.clientId,
          branchId: dto.branchId,
          code: dto.code,
          principalAmount: dto.principalAmount,
          outstandingBalance: dto.principalAmount, // saldo inicial = principal (recálculo al cobrar = F7)
          interestRate: dto.interestRate ?? 0,
          currency,
          installmentsCount: dto.installmentsCount,
          assignedManagerId: dto.assignedManagerId,
          disbursedAt,
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
    });

    await this.audit.record({ entity: 'credit', entityId: created.id, action: 'CREATE', after: creditSummary(created) });
    return serializeCredit(created, config.labels);
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
