import { Injectable } from '@nestjs/common';
import { effectiveLimits, type PlanLimits } from '@kobrax/shared';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../context/tenant-context.service';
import { TenantClockService } from '../context/tenant-clock.service';
import { planLimitReached } from './plan.errors';

/** Los topes que hoy se cuentan de verdad. Cada fase que agrega un contador agrega su clave acá. */
export type CountedLimit = 'users' | 'credits' | 'clients';

/**
 * Los topes mensuales (L2). Tipo aparte a propósito: **nunca frenan** (R1 — la foto y la visita
 * llegan de la calle, ya ocurridas), y que `assertRoom` no los acepte lo dice el compilador, no
 * una convención.
 */
export type MonthlyCounter = 'photosPerMonth' | 'actionsPerMonth';

/**
 * Qué cuenta como crédito «activo» (LIMITES §5.2, Pregunta 9): con saldo pendiente y sin dar de
 * baja. `DEFAULTED` es el que está en mora —debe más que nunca— y `RESTRUCTURED` se refinanció,
 * así que los dos siguen debiendo.
 *
 * 🔴 `PAID`, `WRITTEN_OFF` y `CANCELLED` **no cuentan**: el crédito cobrado libera lugar. Si
 * contaran, el cliente que cobra bien sería castigado por su propio éxito — justo al revés de lo
 * que vende Kobrax.
 */
const CREDITOS_ACTIVOS = ['ACTIVE', 'DEFAULTED', 'RESTRUCTURED'] as const;

/**
 * Los topes del plan de la cuenta del request, y el freno cuando no entra uno más.
 *
 * **Sin caché a propósito.** Es una consulta más por mutación, y las mutaciones que frena son
 * altas —invitar, crear un crédito—, no lecturas. Una caché por request obligaría a hacer el
 * servicio `REQUEST` scoped y a arrastrar ese scope a todo lo que lo inyecte.
 *
 * 🔴 **El conteo va DENTRO de la transacción que escribe**, por eso `assertRoom` recibe el `tx`.
 * Contar afuera y escribir adentro deja pasar dos invitaciones simultáneas: las dos leen «quedan
 * asientos» antes de que ninguna haya escrito. Ese defecto ya se pagó una vez.
 */
@Injectable()
export class PlanLimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly clock: TenantClockService,
  ) {}

  /** Los topes que rigen: los del plan de la cuenta, con su excepción encima. */
  async limitsOf(tx?: PrismaClient): Promise<PlanLimits> {
    const read = async (client: PrismaClient) =>
      client.account.findFirst({
        where: { id: this.tenant.accountId, deletedAt: null },
        select: { planCode: true, limitsOverride: true },
      });
    const account = tx
      ? await read(tx)
      : await this.prisma.withTenant(this.tenant.accountId, read);
    // Sin cuenta no hay plan; el tope más chico es lo seguro. Quien llegó hasta acá sin cuenta ya
    // va a chocar con un 404 en la operación de verdad.
    return effectiveLimits(account?.planCode ?? 'FREE', account?.limitsOverride);
  }

  /**
   * Cuánto hay hoy de lo que el tope mide.
   *
   * Las tres consultas caen en índices que ya existían: `idx_credits_analytics`
   * —`(account_id, status)` parcial por `deleted_at IS NULL`— e `idx_clients_account_active`.
   */
  async usage(kind: CountedLimit, tx: PrismaClient): Promise<number> {
    switch (kind) {
      case 'users':
        // Un invitado que todavía no aceptó YA ocupa asiento (LIMITES §5.1, Pregunta 6): si no
        // ocupara, alguien invita a 50 personas para reservarse los cupos.
        return tx.userAccount.count({ where: { isActive: true } });
      case 'credits':
        return tx.credit.count({
          where: { deletedAt: null, status: { in: [...CREDITOS_ACTIVOS] } },
        });
      case 'clients':
        return tx.client.count({ where: { deletedAt: null } });
    }
  }

  /**
   * Lo que va del mes de un tope mensual. El mes arranca el 1 **del huso de la cuenta**, no del
   * servidor (el mismo bug de «hoy» que ya se pagó en la agenda). Cae en los índices
   * `(account_id, created_at)` de la migración de L2.
   */
  async monthlyUsage(kind: MonthlyCounter, tx: PrismaClient): Promise<number> {
    const since = await this.clock.monthStart();
    return kind === 'photosPerMonth'
      ? tx.fieldEvidence.count({ where: { createdAt: { gte: since } } })
      : tx.fieldVisit.count({ where: { createdAt: { gte: since } } });
  }

  /** Lo usado de cada tope contable, para la pantalla. Una consulta por tope, todas indexadas. */
  async usageAll(tx: PrismaClient): Promise<Record<CountedLimit | MonthlyCounter, number>> {
    const [users, credits, clients, photosPerMonth, actionsPerMonth] = await Promise.all([
      this.usage('users', tx),
      this.usage('credits', tx),
      this.usage('clients', tx),
      this.monthlyUsage('photosPerMonth', tx),
      this.monthlyUsage('actionsPerMonth', tx),
    ]);
    return { users, credits, clients, photosPerMonth, actionsPerMonth };
  }

  /**
   * Cuántos más entran. `null` = sin tope.
   *
   * Existe para **avisar antes de que alguien confirme**: la vista previa de un import tiene que
   * poder decir «el archivo trae 500 y te quedan 80» en vez de fallar al final.
   */
  async roomLeft(kind: CountedLimit, tx: PrismaClient): Promise<number | null> {
    const max = (await this.limitsOf(tx))[kind];
    if (max === null) return null;
    return Math.max(0, max - (await this.usage(kind, tx)));
  }

  /**
   * Frena si no entran `cuantos` más. `soft` deja pasar y no cuenta: es para lo que **ya ocurrió**
   * y llega después —el alta que el cobrador cargó en la calle y sube al reconectar—, que
   * rechazar sería borrar trabajo hecho (LIMITES-BUILD-PLAN §4).
   */
  async assertRoom(
    kind: CountedLimit,
    tx: PrismaClient,
    opts: { cuantos?: number; soft?: boolean } = {},
  ): Promise<void> {
    if (opts.soft) return;
    const max = (await this.limitsOf(tx))[kind];
    if (max === null) return;
    const used = await this.usage(kind, tx);
    if (used + (opts.cuantos ?? 1) > max) throw planLimitReached(kind, used, max);
  }
}
