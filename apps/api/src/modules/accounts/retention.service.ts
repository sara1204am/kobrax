import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { effectiveLimits } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { accountNotFound } from './accounts.errors';

export interface RetentionReport {
  /** Cuántos meses conserva las fotos el plan de esta cuenta; `null` = sin límite. */
  retentionMonths: number | null;
  /** Fotos de evidencia que tiene la cuenta. */
  total: number;
  /** Cuántas son más viejas que ese plazo. Siempre 0 si el plan no tiene límite. */
  older: number;
}

/**
 * Cuántas fotos ya pasaron el plazo de conservación del plan (Refactor de Cuenta · F8, **modo simulación**).
 *
 * 🔴 **Sólo cuenta; no borra ni archiva nada.** Aplicar la retención choca con la evidencia inmutable (el hash SHA-256
 * de cada foto se guarda en base al registrarla y respalda la gestión): antes de eliminar un archivo hace falta decidir
 * si se borra o se pasa a almacenamiento frío, qué pasa con las fotos de una gestión en disputa o de un pago, y que el
 * hash y los metadatos se conserven. Hasta esa decisión, la pantalla informa y Kobrax no elimina nada.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Hace `months` meses, por calendario (no 30 días × n): coincide con cómo lo entiende quien lee «24 meses». */
  static cutoff(months: number, now: Date = new Date()): Date {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  }

  async report(now: Date = new Date()): Promise<RetentionReport> {
    return this.tx(async (tx) => {
      const account = await tx.account.findFirst({
        where: { id: this.tenant.accountId, deletedAt: null },
        select: { planCode: true, limitsOverride: true },
      });
      if (!account) throw accountNotFound();

      const retentionMonths = effectiveLimits(account.planCode, account.limitsOverride).photoRetentionMonths;
      const total = await tx.fieldEvidence.count();
      const older = retentionMonths === null ? 0 : await tx.fieldEvidence.count({ where: { createdAt: { lt: RetentionService.cutoff(retentionMonths, now) } } });
      return { retentionMonths, total, older };
    });
  }
}
