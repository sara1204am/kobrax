import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { auditAsOwner } from '../../common/plan/plan-tools.service';

/** Los únicos estados a los que puede llevar la consola de plataforma: suspender, o levantar la suspensión. */
export type PlatformAccountTarget = 'SUSPENDED' | 'ACTIVE';

export interface PlatformAccountRow {
  accountId: string;
  businessName: string;
  status: string;
  planCode: string;
  createdAt: Date;
  ownerEmail: string | null;
}

/** Mínimo de caracteres del motivo: la suspensión corta el acceso de toda una empresa, no se hace sin decir por qué. */
export const MIN_REASON = 10;

/**
 * Cuentas de empresa vistas desde la PLATAFORMA (la consola de la persona de plataforma): buscar, suspender y reactivar.
 *
 *  - **Listar** usa `platform_list_accounts` (SECURITY DEFINER, ver `prisma/rls/005d`): devuelve solo lo que identifica a la cuenta, nunca datos
 *    de cartera. Las cuentas están bajo RLS por tenant y sin esa función la aplicación no vería ninguna.
 *  - **Cambiar el estado** exige un motivo, solo permite `SUSPENDED` ⇄ `ACTIVE` y deja una entrada de auditoría en la cuenta con la persona de
 *    plataforma y el motivo. La suspensión corta el inicio de sesión de la cuenta entera (`auth.service` rechaza cuentas que no están activas);
 *    un acceso ya emitido sigue vivo hasta que vence (≤ 15 min).
 */
@Injectable()
export class PlatformAccountsService {
  private readonly logger = new Logger(PlatformAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query?: string, limit = 50): Promise<PlatformAccountRow[]> {
    const rows = await this.prisma.$queryRaw<
      { account_id: string; business_name: string; account_status: string; plan_code: string; created_at: Date; owner_email: string | null }[]
    >`SELECT * FROM platform_list_accounts(${query?.trim() ?? ''}::text, ${limit}::integer)`;
    return rows.map((r) => ({
      accountId: r.account_id,
      businessName: r.business_name,
      status: r.account_status,
      planCode: r.plan_code,
      createdAt: r.created_at,
      ownerEmail: r.owner_email,
    }));
  }

  async setStatus(accountId: string, target: PlatformAccountTarget, reason: string, platformUserId: string) {
    const why = reason.trim();
    if (why.length < MIN_REASON) {
      throw new UnprocessableEntityException({ code: 'PLATFORM_REASON_REQUIRED', message: 'Escribe el motivo (al menos 10 caracteres)' });
    }
    return this.prisma.withSystemTenant(accountId, async (tx) => {
      const before = await tx.account.findFirst({ where: { id: accountId, deletedAt: null }, select: { status: true, businessName: true } });
      if (!before) throw new NotFoundException({ code: 'PLATFORM_ACCOUNT_NOT_FOUND', message: 'Cuenta no encontrada' });
      if (target === 'SUSPENDED' && before.status === 'SUSPENDED') {
        throw new ConflictException({ code: 'PLATFORM_ACCOUNT_ALREADY', message: 'La cuenta ya está suspendida' });
      }
      // Levantar solo sirve para una cuenta suspendida: no se "activa" una cuenta cancelada o en prueba por este camino.
      if (target === 'ACTIVE' && before.status !== 'SUSPENDED') {
        throw new ConflictException({ code: 'PLATFORM_ACCOUNT_NOT_SUSPENDED', message: 'Solo se puede reactivar una cuenta suspendida' });
      }
      const updated = await tx.account.update({ where: { id: accountId }, data: { status: target as AccountStatus }, select: { status: true } });
      await auditAsOwner(tx, this.logger, accountId, target === 'SUSPENDED' ? 'platform:suspend' : 'platform:suspend --lift', {
        before: { status: before.status },
        after: { status: updated.status, reason: why, platformUserId },
      });
      this.logger.warn(`Plataforma ${platformUserId}: cuenta ${accountId} ${before.status} → ${updated.status}`);
      return { accountId, businessName: before.businessName, status: updated.status };
    });
  }
}
