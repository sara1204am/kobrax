import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { startJob } from '../../common/jobs/start-job';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { findPaymentIntegrityViolations, type IntegrityViolation } from './payment-integrity';

/** Una vez al día: es una verificación, no una operación. */
export const PAYMENT_INTEGRITY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Trabajo nocturno que verifica que la imputación de pagos cuadra (ver `payment-integrity.ts`). **Reporta, no corrige**: un desvío se
 * investiga, no se parcha en silencio. Mismo patrón que los demás trabajos de sistema: enumera las empresas vivas y revisa cada una bajo
 * su RLS; un fallo en una no detiene a las demás.
 */
@Injectable()
export class PaymentIntegrityService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentIntegrityService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS) private readonly redis?: Redis,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = startJob({ name: 'payment-integrity', intervalMs: PAYMENT_INTEGRITY_INTERVAL_MS, run: () => this.run(), redis: this.redis, logger: this.logger });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Devuelve cuántos desvíos encontró en total. */
  async run(): Promise<number> {
    let accountIds: string[];
    try {
      const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM promise_due_account_ids()`;
      accountIds = rows.map((r) => r.account_id);
    } catch (err) {
      this.logger.warn(`promise_due_account_ids() no disponible — verificación omitida: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
    let total = 0;
    for (const accountId of accountIds) {
      try {
        const found = await this.scanAccount(accountId);
        total += found.length;
        if (found.length > 0) {
          const byKind = found.reduce<Record<string, number>>((m, v) => ({ ...m, [v.kind]: (m[v.kind] ?? 0) + 1 }), {});
          this.logger.warn(`Imputación de pagos con desvíos en la empresa ${accountId}: ${JSON.stringify(byKind)} (ej.: ${JSON.stringify(found[0])})`);
        }
      } catch (err) {
        this.logger.error(`Verificación de pagos falló en la empresa ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return total;
  }

  scanAccount(accountId: string): Promise<IntegrityViolation[]> {
    return this.prisma.withSystemTenant(accountId, (tx) => findPaymentIntegrityViolations(tx, accountId));
  }
}
