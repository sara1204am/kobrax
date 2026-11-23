import { Injectable } from '@nestjs/common';
import { Prisma, CreditStatus, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { accountTimezone, accountToday } from '../../common/context/tenant-clock.service';
import { AuditService } from '../../common/audit/audit.service';
import { moraScopeOf, seesWholeAccount, visibleCreditIdsSql } from '../mora/mora-query';
import { LATE_POLICY_INCLUDE } from './late-context';
import { loadLateSummary } from './late-summary';
import { planSourceOf } from './payment-apply';
import { isExternalOrigin, readCreditMetadata } from '@kobrax/shared';
import { paymentInvalid, resourceNotFound } from './payments.errors';
import type { CreateLateWaiverDto } from './dto/late-waiver.dto';
import type { CreateLateActivationDto } from './dto/late-activation.dto';

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
    const credit = await tx.credit.findFirst({ where: { id: creditId, deletedAt: null }, include: { installments: true, ...LATE_POLICY_INCLUDE } });
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
   * F3-e — activa el interés moratorio en un crédito que nació sin él. Crea un HECHO (única por crédito) que sella la política de la cuenta
   * vigente ahora y el primer día que puede correr el devengo, que tiene que ser POSTERIOR a hoy: nunca cobra hacia atrás (D8).
   */
  async activate(creditId: string, dto: CreateLateActivationDto) {
    return this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      await this.assertInScope(tx, creditId);
      await tx.$queryRaw`SELECT id FROM credits WHERE id = ${creditId} AND account_id = ${this.tenant.accountId} FOR UPDATE`;
      const credit = await tx.credit.findFirst({ where: { id: creditId, deletedAt: null }, include: { installments: true, ...LATE_POLICY_INCLUDE } });
      if (!credit) throw resourceNotFound();
      if (isExternalOrigin(readCreditMetadata(credit.metadata, credit.origin).origin)) throw paymentInvalid('Una cartera de fuente externa no devenga interés moratorio');
      if (credit.status !== CreditStatus.ACTIVE || credit.writtenOffAt) throw paymentInvalid('Sólo se activa la mora en un crédito activo y no castigado');
      if (!planSourceOf(credit)) throw paymentInvalid('Este crédito no tiene un plan con capital e interés por cuota: no hay base para el interés moratorio');
      if (credit.lateActivation) throw paymentInvalid('Este crédito ya tiene el interés moratorio activado');
      if (credit.latePolicyVersion?.kind === 'ANNUAL_RATE') throw paymentInvalid('Este crédito ya devenga interés moratorio');

      const policy = await tx.latePolicyVersion.findFirst({ where: { accountId: this.tenant.accountId, scope: 'ACCOUNT' }, orderBy: { version: 'desc' } });
      if (!policy || policy.kind !== 'ANNUAL_RATE') throw paymentInvalid('La cuenta no tiene activado el interés moratorio: actívalo primero en Configuración financiera');

      const today = (await accountToday(tx, this.tenant.accountId)).toISOString().slice(0, 10);
      if (Number.isNaN(Date.parse(`${dto.startsOn}T00:00:00Z`)) || new Date(`${dto.startsOn}T00:00:00Z`).toISOString().slice(0, 10) !== dto.startsOn) {
        throw paymentInvalid('La fecha de inicio no es válida');
      }
      if (dto.startsOn <= today) throw paymentInvalid('La fecha de inicio debe ser posterior a hoy: el interés moratorio no se cobra hacia atrás');

      const activation = await tx.creditLateActivation.create({
        data: { accountId: this.tenant.accountId, creditId, policyVersionId: policy.id, startsOn: new Date(`${dto.startsOn}T00:00:00Z`), reason: dto.reason.trim(), createdBy: this.tenant.userId },
      });
      await this.audit.recordInTx(tx, {
        entity: 'credit_late_activation',
        entityId: activation.id,
        action: 'CREATE',
        after: { creditId, startsOn: dto.startsOn, reason: activation.reason, policyVersion: policy.version, annualRate: Number(policy.annualRate), graceDays: policy.graceDays },
      });
      return { id: activation.id, startsOn: dto.startsOn, policyVersion: policy.version };
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
