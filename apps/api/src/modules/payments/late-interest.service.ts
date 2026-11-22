import { Injectable } from '@nestjs/common';
import { Prisma, CreditStatus, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { accountTimezone, accountToday } from '../../common/context/tenant-clock.service';
import { AuditService } from '../../common/audit/audit.service';
import { moraScopeOf, seesWholeAccount, visibleCreditIdsSql } from '../mora/mora-query';
import { loadLateSummary } from './late-summary';
import { paymentInvalid, resourceNotFound } from './payments.errors';
import type { CreateLateWaiverDto } from './dto/late-waiver.dto';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Interés moratorio de un crédito: lectura y exoneración (F17 · F3-d). El cobro lo hace `PaymentsService.applyCore`. */
@Injectable()
export class LateInterestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private async assertInScope(tx: PrismaClient, creditId: string): Promise<void> {
    const scope = moraScopeOf(this.tenant);
    if (seesWholeAccount(scope)) return;
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT v.id FROM (${visibleCreditIdsSql(scope)}) v WHERE v.id = ${creditId} LIMIT 1`);
    if (rows.length === 0) throw resourceNotFound();
  }

  private async load(tx: PrismaClient, creditId: string) {
    const credit = await tx.credit.findFirst({ where: { id: creditId, deletedAt: null }, include: { installments: true, latePolicyVersion: true } });
    if (!credit) throw resourceNotFound();
    const tz = await accountTimezone(tx, this.tenant.accountId);
    const today = (await accountToday(tx, this.tenant.accountId)).toISOString().slice(0, 10);
    return { credit, summary: await loadLateSummary(tx, { accountId: this.tenant.accountId, tz, today, credit }) };
  }

  /** `null` = el crédito no devenga mora (política apagada cuando nació, o no aplica). */
  async current(creditId: string) {
    return this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      await this.assertInScope(tx, creditId);
      return (await this.load(tx, creditId)).summary;
    });
  }

  /**
   * Exonera mora de una cuota. Hecho append-only con motivo y quién; audita en la misma transacción. Con el crédito bloqueado (`FOR UPDATE`)
   * para no cruzarse con un pago que cobra esa misma mora. Si con esto el crédito queda sin saldo ni mora, pasa a `PAID` (D6).
   */
  async waive(creditId: string, dto: CreateLateWaiverDto) {
    return this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      await this.assertInScope(tx, creditId);
      await tx.$queryRaw`SELECT id FROM credits WHERE id = ${creditId} AND account_id = ${this.tenant.accountId} FOR UPDATE`;
      const { credit, summary } = await this.load(tx, creditId);
      if (!summary) throw paymentInvalid('Este crédito no devenga interés moratorio');
      const row = summary.installments.find((i) => i.installmentNumber === dto.installmentNumber);
      if (!row || row.pending <= 0) throw paymentInvalid('Esa cuota no tiene interés moratorio pendiente');
      const amount = round2(dto.amount);
      if (amount > row.pending + 0.005) throw paymentInvalid(`El monto excede la mora pendiente de la cuota (${row.pending.toFixed(2)})`);

      const waiver = await tx.creditLateWaiver.create({
        data: { accountId: this.tenant.accountId, creditId, installmentNumber: dto.installmentNumber, amount, reason: dto.reason.trim(), createdBy: this.tenant.userId },
      });
      const pendingAfter = round2(summary.pending - amount);
      const paid = credit.status === CreditStatus.ACTIVE && Number(credit.outstandingBalance) <= 0.005 && pendingAfter <= 0.005;
      if (paid) await tx.credit.update({ where: { id: creditId }, data: { status: CreditStatus.PAID } });

      await this.audit.recordInTx(tx, {
        entity: 'credit_late_waiver',
        entityId: waiver.id,
        action: 'CREATE',
        after: { creditId, installmentNumber: dto.installmentNumber, amount, reason: waiver.reason, pendingBefore: row.pending, creditPaid: paid },
      });
      return { id: waiver.id, installmentNumber: dto.installmentNumber, amount, pendingAfter, creditPaid: paid };
    });
  }
}
