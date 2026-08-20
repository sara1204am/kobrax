import { Injectable } from '@nestjs/common';
import { effectiveLimits, type PlanLimits } from '@kobrax/shared';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../context/tenant-context.service';
import { planLimitReached } from './plan.errors';

/** Los topes que hoy se cuentan de verdad. Cada fase que agrega un contador agrega su clave acá. */
export type CountedLimit = 'users';

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

  /** Cuánto hay hoy de lo que el tope mide. */
  async usage(kind: CountedLimit, tx: PrismaClient): Promise<number> {
    switch (kind) {
      case 'users':
        // Un invitado que todavía no aceptó YA ocupa asiento (LIMITES §5.1, Pregunta 6): si no
        // ocupara, alguien invita a 50 personas para reservarse los cupos.
        return tx.userAccount.count({ where: { isActive: true } });
    }
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
