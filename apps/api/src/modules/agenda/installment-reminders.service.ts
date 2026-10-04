import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgendaItemStatus, AgendaItemType, CreditStatus, InstallmentStatus } from '@prisma/client';
import { isExternalOrigin, isReportStale, readCreditMetadata, staleAfterDaysOf } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';

/** Ventana hacia adelante: las cuotas que vencen dentro de N días generan su recordatorio (F4/08 · D11). */
export const INSTALLMENT_REMINDER_HORIZON_DAYS = 3;
/**
 * Cada cuánto corre el barrido. La ventana mira 3 días adelante y el alta es idempotente, así que basta con que
 * corra al menos una vez al día; correr más veces (o dos instancias a la vez) no duplica nada.
 */
export const INSTALLMENT_REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const INSTALLMENT_REMINDER_TEXT = 'Cobrar cuota';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Id determinista de un recordatorio: md5(`creditId|cuota-o-fecha`) con forma de uuid. Es lo que vuelve el job
 * idempotente: volver a correrlo calcula el mismo id y el alta lo salta (`ON CONFLICT DO NOTHING`), incluso si la
 * persona ya ejecutó, canceló o borró el recordatorio.
 */
export function reminderId(creditId: string, key: string | number): string {
  const h = createHash('md5').update(`${creditId}|${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

interface Reminder {
  id: string;
  creditId: string;
  clientId: string;
  assigneeId: string;
  dueDate: Date;
}

/**
 * Job «Cobrar cuota» (D11): crea un recordatorio de agenda para el responsable del crédito cuando una cuota vence
 * en los próximos días.
 *
 *  · Créditos de Kobrax: una cuota impaga del cronograma (`credit_installments`).
 *  · Importados SIN cronograma: la fecha de próximo pago del reporte (`metadata.nextDueDate`), sólo si el reporte
 *    no está viejo (`isReportStale` con los `staleAfterDays` de la cuenta): una fecha de un reporte viejo no es
 *    una guía confiable.
 *
 * Sin responsable no hay a quién recordarle: el crédito se omite. «Hoy» es el día UTC del servidor (la columna
 * `scheduled_date` es una fecha y la ventana de 3 días absorbe la diferencia horaria).
 */
@Injectable()
export class InstallmentReminderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InstallmentReminderService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), INSTALLMENT_REMINDER_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref(); // no bloquea el apagado
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Barre todos los tenants vivos (mismo enumerador que `PROMISE_DUE`). Un fallo en uno no detiene los demás. */
  async run(now: Date = new Date()): Promise<number> {
    let accountIds: string[];
    try {
      const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM promise_due_account_ids()`;
      accountIds = rows.map((r) => r.account_id);
    } catch (err) {
      this.logger.warn(`promise_due_account_ids() no disponible — job omitido: ${this.msg(err)}`);
      return 0;
    }
    let total = 0;
    for (const accountId of accountIds) {
      try {
        total += await this.scanAccount(accountId, now);
      } catch (err) {
        this.logger.error(`Recordatorio de cuota falló en tenant ${accountId}: ${this.msg(err)}`);
      }
    }
    if (total > 0) this.logger.log(`Recordatorios «Cobrar cuota»: ${total} creados`);
    return total;
  }

  /** Un tenant. Devuelve cuántos recordatorios NUEVOS se crearon (los ya existentes no cuentan). */
  async scanAccount(accountId: string, now: Date = new Date()): Promise<number> {
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const horizon = new Date(today.getTime() + INSTALLMENT_REMINDER_HORIZON_DAYS * DAY_MS);

    return this.prisma.withTenant(accountId, async (tx) => {
      const account = await tx.account.findUnique({ where: { id: accountId } });
      const cfg = (account?.configuration ?? {}) as { importConfig?: { staleAfterDays?: unknown } };
      const staleAfterDays = staleAfterDaysOf(cfg.importConfig?.staleAfterDays);
      const live = {
        deletedAt: null,
        writtenOffAt: null,
        status: { notIn: [CreditStatus.PAID, CreditStatus.CANCELLED, CreditStatus.WRITTEN_OFF] },
      };

      const reminders: Reminder[] = [];

      // 1) Créditos de Kobrax: cuotas impagas que vencen dentro de la ventana.
      const installments = await tx.creditInstallment.findMany({
        where: { dueDate: { gte: today, lte: horizon }, status: { not: InstallmentStatus.PAID }, credit: live },
        select: {
          creditId: true,
          number: true,
          dueDate: true,
          credit: { select: { clientId: true, assignedManagerId: true, origin: true, metadata: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      });
      for (const i of installments) {
        const c = i.credit;
        if (isExternalOrigin(readCreditMetadata(c.metadata, c.origin).origin)) continue; // el reporte manda en los importados
        if (!c.assignedManagerId) continue;
        reminders.push({ id: reminderId(i.creditId, i.number), creditId: i.creditId, clientId: c.clientId, assigneeId: c.assignedManagerId, dueDate: dayOf(i.dueDate) });
      }

      // 2) Importados sin cronograma: la fecha del reporte, si el reporte no está viejo.
      const imported = await tx.credit.findMany({
        where: { ...live, installments: { none: {} }, assignedManagerId: { not: null } },
        select: { id: true, clientId: true, assignedManagerId: true, origin: true, metadata: true, reportedAsOf: true },
      });
      for (const c of imported) {
        const meta = readCreditMetadata(c.metadata, c.origin);
        if (!isExternalOrigin(meta.origin) || !c.assignedManagerId) continue;
        if (!meta.nextDueDate || !ISO_DATE.test(meta.nextDueDate)) continue;
        if (isReportStale(c.reportedAsOf, today, staleAfterDays)) continue;
        const day = meta.nextDueDate.slice(0, 10);
        const due = new Date(`${day}T00:00:00.000Z`);
        if (Number.isNaN(due.getTime()) || due < today || due > horizon) continue;
        reminders.push({ id: reminderId(c.id, day), creditId: c.id, clientId: c.clientId, assigneeId: c.assignedManagerId, dueDate: due });
      }

      if (reminders.length === 0) return 0;
      const res = await tx.agendaItem.createMany({
        data: reminders.map((r) => ({
          id: r.id,
          accountId,
          clientId: r.clientId,
          creditId: r.creditId,
          assigneeId: r.assigneeId,
          type: AgendaItemType.REMINDER,
          status: AgendaItemStatus.SCHEDULED,
          scheduledDate: r.dueDate,
          details: { description: INSTALLMENT_REMINDER_TEXT },
        })),
        skipDuplicates: true, // ON CONFLICT DO NOTHING sobre el id determinista
      });
      return res.count;
    });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Medianoche UTC del día de una fecha (`scheduled_date` es una fecha, sin hora). */
function dayOf(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
