import type { PrismaClient } from '@prisma/client';
import { isExternalOrigin, lateStateAt, readCreditMetadata } from '@kobrax/shared';
import { accountTimezone, accountToday, civilDayOf } from '../../common/context/tenant-clock.service';
import { lateParamsOf, loadLateContext } from './late-context';
import { planSourceOf } from './payment-apply';

export interface LateSummaryInstallment {
  installmentNumber: number;
  dueDate: string;
  accrued: number;
  collected: number;
  waived: number;
  pending: number;
}

export interface LateSummary {
  asOf: string;
  accrued: number;
  collected: number;
  waived: number;
  pending: number;
  /** Sólo las cuotas con algo devengado. */
  installments: LateSummaryInstallment[];
  policy: { annualRate: number; dayCount: 360 | 365; graceDays: number; capPctOfPrincipal: number | null };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * El interés moratorio de UN crédito a `today` (día civil de la cuenta), reproducido de los hechos (aplicaciones + exoneraciones).
 * `null` = el crédito no devenga: sin política sellada, operación de una fuente externa, o sin plan con partición capital/interés.
 * Una sola fuente para la ficha, el historial de pagos, la exoneración y el verificador.
 */
export async function loadLateSummary(
  tx: Pick<PrismaClient, 'paymentApplication' | 'creditLateWaiver'>,
  p: {
    accountId: string;
    tz: string;
    today: string;
    credit: {
      id: string;
      metadata: unknown;
      origin?: string | null;
      writtenOffAt: Date | null;
      installments: { number: number; paidAmount: unknown; dueDate: Date; amount: unknown; principal?: unknown; interest?: unknown }[];
      latePolicyVersion: Parameters<typeof lateParamsOf>[0];
    };
  },
): Promise<LateSummary | null> {
  const { credit } = p;
  if (isExternalOrigin(readCreditMetadata(credit.metadata, credit.origin).origin)) return null;
  const policy = lateParamsOf(credit.latePolicyVersion);
  const source = planSourceOf(credit);
  if (!policy || !source) return null;

  const ctx = await loadLateContext(tx, {
    accountId: p.accountId,
    creditId: credit.id,
    tz: p.tz,
    rows: source.rows,
    policy,
    stopAt: credit.writtenOffAt ? civilDayOf(credit.writtenOffAt, p.tz) : null,
    prepaidInstallments: source.prepaidInstallments,
    storedPaid: source.stored ? Object.fromEntries(credit.installments.map((i) => [i.number, Number(i.paidAmount)])) : undefined,
  });
  const dueOf = new Map(source.rows.map((r) => [r.number, r.dueDate]));
  const installments: LateSummaryInstallment[] = lateStateAt(ctx, p.today)
    .map((s) => ({
      installmentNumber: s.installmentNumber,
      dueDate: dueOf.get(s.installmentNumber)!,
      accrued: s.accrued,
      collected: ctx.lateCollected[s.installmentNumber] ?? 0,
      waived: ctx.lateWaived[s.installmentNumber] ?? 0,
      pending: s.pending,
    }))
    .filter((s) => s.accrued > 0 || s.collected > 0 || s.waived > 0);
  const total = (f: (s: LateSummaryInstallment) => number): number => round2(installments.reduce((sum, s) => sum + Math.round(f(s) * 100), 0) / 100);
  return {
    asOf: p.today,
    accrued: total((s) => s.accrued),
    collected: total((s) => s.collected),
    waived: total((s) => s.waived),
    pending: total((s) => s.pending),
    installments,
    policy: { annualRate: policy.annualRate, dayCount: policy.dayCount, graceDays: policy.graceDays, capPctOfPrincipal: policy.capPctOfPrincipal ?? null },
  };
}

/**
 * Lo mismo por id de crédito, para las vistas de detalle (Cartera, Mora, Pagos): carga el crédito con su política sellada y cuenta el día con la zona
 * de la cuenta. `null` si no devenga o no existe.
 */
export async function lateSummaryOfCredit(
  tx: Pick<PrismaClient, 'paymentApplication' | 'creditLateWaiver' | 'credit' | 'account'>,
  accountId: string,
  creditId: string,
): Promise<LateSummary | null> {
  const credit = await tx.credit.findFirst({ where: { id: creditId, accountId, deletedAt: null }, include: { installments: true, latePolicyVersion: true } });
  if (!credit || !credit.latePolicyVersion) return null; // sin política sellada no hay nada que reproducir (camino barato de siempre)
  const tz = await accountTimezone(tx, accountId);
  const today = (await accountToday(tx, accountId)).toISOString().slice(0, 10);
  return loadLateSummary(tx, { accountId, tz, today, credit });
}
