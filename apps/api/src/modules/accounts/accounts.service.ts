import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { serializeAccount } from './accounts.serializer';
import { UpdateAccountDto } from './dto/account.dto';
import { accountNotFound } from './accounts.errors';

/** Datos del propio tenant (módulo CUENTA · S0). */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async findMine(): Promise<ReturnType<typeof serializeAccount>> {
    const { account, memberCount } = await this.tx(async (tx) => {
      // El id va en el where además de la RLS (policy `tenant_self`): defensa en profundidad.
      const [account, memberCount] = await Promise.all([
        tx.account.findFirst({ where: { id: this.tenant.accountId, deletedAt: null } }),
        tx.userAccount.count({ where: { isActive: true } }),
      ]);
      return { account, memberCount };
    });
    if (!account) throw accountNotFound();
    return serializeAccount(account, memberCount);
  }

  async update(dto: UpdateAccountDto): Promise<ReturnType<typeof serializeAccount>> {
    const { before, updated } = await this.tx(async (tx) => {
      const before = await tx.account.findFirst({
        where: { id: this.tenant.accountId, deletedAt: null },
      });
      if (!before) throw accountNotFound();
      const updated = await tx.account.update({
        where: { id: before.id },
        data: {
          businessName: dto.businessName,
          taxId: dto.taxId,
          countryCode: dto.countryCode,
          currencyCode: dto.currencyCode,
          timezone: dto.timezone,
        },
      });
      return { before, updated };
    });

    await this.audit.record({
      entity: 'account',
      entityId: updated.id,
      action: 'UPDATE',
      before,
      after: updated,
      redactKeys: ['taxId'],
    });
    return this.findMine();
  }
}
