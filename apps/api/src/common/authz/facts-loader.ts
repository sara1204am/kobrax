import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../context/tenant-context.service';
import { OfficeScopeService } from '../office-scope/office-scope.service';

/**
 * Carga los HECHOS que las políticas necesitan (oficinas de una persona, oficina de un crédito…) en consultas acotadas al tenant.
 * Es la única puerta de las políticas a la DB: la política en sí queda pura y se prueba sin base de datos.
 */
@Injectable()
export class FactsLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly office: OfficeScopeService,
  ) {}

  /** Rutas de las oficinas vigentes de una persona (vacío = sin oficina). */
  officePathsOf(userId: string): Promise<string[]> {
    return this.prisma.withTenant(this.tenant.accountId, (tx) => this.office.pathsOf(tx, userId));
  }

  /** Ruta de la oficina de un crédito (`null` = sin oficina o no existe en esta cuenta). */
  async creditOfficePath(creditId: string): Promise<string | null> {
    const map = await this.prisma.withTenant(this.tenant.accountId, (tx) => this.office.creditOfficePaths(tx, [creditId]));
    return map.get(creditId) ?? null;
  }
}
