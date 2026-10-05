import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CreditAssignmentKind, CreditStatus, InstallmentStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from './notifications.service';

/** Ventana hacia adelante: cuotas que vencen dentro de N días entran al aviso. */
export const PROMISE_DUE_HORIZON_DAYS = 3;
/** No repetir el aviso al mismo cobrador por el mismo crédito dentro de esta ventana. */
export const PROMISE_DUE_DEDUPE_MS = 20 * 60 * 60 * 1000;
/** Cada cuánto corre el barrido (tarea de sistema). */
export const PROMISE_DUE_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface PromiseDueTarget {
  userId: string;
  creditId: string;
  installmentNumber: number;
  dueDate: Date;
}

/**
 * Job `PROMISE_DUE` (F8): avisa al responsable del crédito de cuotas próximas a vencer (F4/08: el destinatario
 * sale del crédito —responsable principal más el reemplazo TEMPORAL vigente—, no de un caso).
 * Como tarea de sistema enumera los tenants vivos (`promise_due_account_ids()`,
 * SECURITY DEFINER) y escanea cada uno bajo su RLS. Idempotente por (usuario, crédito)
 * en una ventana de ~20 h → seguro ante reintentos / múltiples instancias.
 */
@Injectable()
export class PromiseDueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PromiseDueService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), PROMISE_DUE_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref(); // no bloquea el apagado
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Barre todos los tenants vivos. Resiliente: un fallo en uno no detiene los demás. */
  async run(now: Date = new Date()): Promise<number> {
    let accountIds: string[];
    try {
      const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM promise_due_account_ids()`;
      accountIds = rows.map((r) => r.account_id);
    } catch (err) {
      this.logger.warn(
        `promise_due_account_ids() no disponible (aplica prisma/rls/004) — job omitido: ${this.msg(err)}`,
      );
      return 0;
    }

    let total = 0;
    for (const accountId of accountIds) {
      try {
        total += await this.scanAccount(accountId, now);
      } catch (err) {
        this.logger.error(`PROMISE_DUE falló en tenant ${accountId}: ${this.msg(err)}`);
      }
    }
    if (total > 0) this.logger.log(`PROMISE_DUE: ${total} avisos creados`);
    return total;
  }

  /** Escanea un tenant: detecta objetivos (fase lectura) y luego emite los avisos. */
  async scanAccount(accountId: string, now: Date = new Date()): Promise<number> {
    const targets = await this.collectTargets(accountId, now);
    for (const t of targets) {
      await this.notifications.notifyUser(accountId, t.userId, {
        type: NotificationType.PROMISE_DUE,
        title: 'Cuota próxima a vencer',
        body: `La cuota ${t.installmentNumber} vence el ${t.dueDate.toISOString().slice(0, 10)}.`,
        creditId: t.creditId,
      });
    }
    return targets.length;
  }

  /** Fase de lectura (una sola transacción RLS): cuotas próximas → responsable (+ temporal) del crédito → dedupe. */
  private async collectTargets(accountId: string, now: Date): Promise<PromiseDueTarget[]> {
    const horizon = new Date(now.getTime() + PROMISE_DUE_HORIZON_DAYS * 86_400_000);
    const since = new Date(now.getTime() - PROMISE_DUE_DEDUPE_MS);

    return this.prisma.withTenant(accountId, async (tx) => {
      const installments = await tx.creditInstallment.findMany({
        where: {
          dueDate: { gte: now, lte: horizon },
          status: { not: InstallmentStatus.PAID },
          // Un crédito saldado, castigado o borrado ya no se cobra. Antes lo filtraba el estado del caso.
          credit: { deletedAt: null, writtenOffAt: null, status: { notIn: [CreditStatus.PAID, CreditStatus.CANCELLED] } },
        },
        select: { creditId: true, number: true, dueDate: true, credit: { select: { assignedManagerId: true } } },
        orderBy: { dueDate: 'asc' },
      });
      if (installments.length === 0) return [];

      // Primer vencimiento próximo por crédito (evita avisar varias cuotas del mismo crédito).
      const firstByCredit = new Map<string, { number: number; dueDate: Date; manager: string | null }>();
      for (const i of installments) {
        if (!firstByCredit.has(i.creditId)) firstByCredit.set(i.creditId, { number: i.number, dueDate: i.dueDate, manager: i.credit?.assignedManagerId ?? null });
      }

      // El reemplazo temporal vigente también atiende el crédito mientras dura: recibe el aviso.
      const temporals = await tx.creditAssignment.findMany({
        where: {
          creditId: { in: [...firstByCredit.keys()] },
          kind: CreditAssignmentKind.TEMPORAL,
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { creditId: true, userId: true },
      });
      const temporalByCredit = new Map<string, string[]>();
      for (const t of temporals) temporalByCredit.set(t.creditId, [...(temporalByCredit.get(t.creditId) ?? []), t.userId]);

      const targets: PromiseDueTarget[] = [];
      for (const [creditId, inst] of firstByCredit) {
        const recipients = [...new Set([inst.manager, ...(temporalByCredit.get(creditId) ?? [])].filter((u): u is string => !!u))];
        for (const userId of recipients) {
          const dup = await tx.notification.findFirst({
            where: { userId, creditId, type: NotificationType.PROMISE_DUE, createdAt: { gte: since } },
            select: { id: true },
          });
          if (dup) continue;
          targets.push({ userId, creditId, installmentNumber: inst.number, dueDate: inst.dueDate });
        }
      }
      return targets;
    });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
