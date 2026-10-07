import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AgendaItemStatus, NotificationType } from '@prisma/client';
import { civilTodayUTC, timezoneOf } from '../../common/context/tenant-clock.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Cada cuánto corre el barrido (tarea de sistema). Con la ventana de abajo, alcanza para un aviso por día. */
export const AGENDA_OVERDUE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** No repetir el resumen a la misma persona dentro de esta ventana: un aviso por día civil, no uno por barrido. */
export const AGENDA_OVERDUE_DEDUPE_MS = 20 * 60 * 60 * 1000;

interface OverdueTarget {
  userId: string;
  count: number;
}

/**
 * Resumen diario de gestiones vencidas (F4/11 · E4): a cada responsable con gestiones pendientes de días anteriores le
 * llega UN aviso con cuántas tiene, y la campanita lo lleva a la agenda.
 *
 * 🔴 «Vencida» es la misma regla que en la lista: `SCHEDULED` con fecha anterior al día civil de LA EMPRESA (no el UTC
 * del servidor). No es un aviso por gestión —eso convertiría la campanita en una segunda agenda— sino un resumen.
 *
 * Mismo patrón que `PROMISE_DUE`: tarea de sistema que enumera los tenants vivos y escanea cada uno bajo su RLS;
 * idempotente por persona en una ventana de ~20 h, así que es seguro ante reintentos y varias instancias.
 */
@Injectable()
export class AgendaOverdueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgendaOverdueService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), AGENDA_OVERDUE_INTERVAL_MS);
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
        this.logger.error(`Resumen de vencidas falló en tenant ${accountId}: ${this.msg(err)}`);
      }
    }
    if (total > 0) this.logger.log(`Resumen de vencidas: ${total} avisos creados`);
    return total;
  }

  /** Un tenant. Devuelve cuántos avisos NUEVOS salieron. */
  async scanAccount(accountId: string, now: Date = new Date()): Promise<number> {
    const targets = await this.collectTargets(accountId, now);
    for (const t of targets) {
      await this.notifications.notifyUser(accountId, t.userId, {
        type: NotificationType.AGENDA_OVERDUE,
        title: 'Tienes gestiones vencidas',
        body: t.count === 1 ? 'Hay 1 gestión vencida en tu agenda.' : `Hay ${t.count} gestiones vencidas en tu agenda.`,
      });
    }
    return targets.length;
  }

  /** Fase de lectura (una transacción RLS): vencidas por responsable → solo miembros activos → sin aviso reciente. */
  private async collectTargets(accountId: string, now: Date): Promise<OverdueTarget[]> {
    const since = new Date(now.getTime() - AGENDA_OVERDUE_DEDUPE_MS);
    return this.prisma.withTenant(accountId, async (tx) => {
      const account = await tx.account.findFirst({ where: { id: accountId }, select: { timezone: true, countryCode: true } });
      const today = civilTodayUTC(timezoneOf(account), now);

      const groups = await tx.agendaItem.groupBy({
        by: ['assigneeId'],
        where: { deletedAt: null, status: AgendaItemStatus.SCHEDULED, scheduledDate: { lt: today } },
        _count: { _all: true },
      });
      if (groups.length === 0) return [];

      // Alguien dado de baja no lee avisos: no se le crean.
      const active = await tx.userAccount.findMany({
        where: { accountId, isActive: true, userId: { in: groups.map((g) => g.assigneeId) } },
        select: { userId: true },
      });
      const activeIds = new Set(active.map((a) => a.userId));

      const targets: OverdueTarget[] = [];
      for (const g of groups) {
        if (!activeIds.has(g.assigneeId)) continue;
        const dup = await tx.notification.findFirst({
          where: { userId: g.assigneeId, type: NotificationType.AGENDA_OVERDUE, createdAt: { gte: since } },
          select: { id: true },
        });
        if (dup) continue;
        targets.push({ userId: g.assigneeId, count: g._count._all });
      }
      return targets;
    });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
