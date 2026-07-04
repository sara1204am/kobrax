import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Resuelve los permisos efectivos de un rol. role_permissions y permissions son
 * tablas globales (sin RLS) → consultables sin contexto de tenant.
 * (Los overrides por usuario se incorporan en el Slice 4 de RBAC.)
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async forRole(roleId: string): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { code: true } } },
    });
    return rows.map((r) => r.permission.code);
  }
}
