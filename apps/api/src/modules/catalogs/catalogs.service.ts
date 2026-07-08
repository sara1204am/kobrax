import { Injectable } from '@nestjs/common';
import type { CatalogType, Prisma, PrismaClient } from '@prisma/client';
import { type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { serializeCatalogItem } from './catalogs.serializer';
import { CreateCatalogItemDto, UpdateCatalogItemDto } from './dto/catalog.dto';
import { catalogItemNotFound } from './catalogs.errors';

/** Catálogos configurables por tenant (una tabla genérica para los 11 tipos). */
@Injectable()
export class CatalogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Ítems activos de un catálogo, ordenados. */
  async list(catalog: CatalogType): Promise<ApiResponse<ReturnType<typeof serializeCatalogItem>[]>> {
    const rows = await this.tx((tx) =>
      tx.catalogItem.findMany({
        where: { catalog, isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      }),
    );
    return ResponseDto.ok(rows.map(serializeCatalogItem));
  }

  async create(catalog: CatalogType, dto: CreateCatalogItemDto): Promise<ReturnType<typeof serializeCatalogItem>> {
    const created = await this.tx((tx) =>
      tx.catalogItem.create({
        data: {
          accountId: this.tenant.accountId,
          catalog,
          code: dto.code,
          label: dto.label,
          sortOrder: dto.sortOrder ?? 0,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      }),
    );
    await this.audit.record({ entity: 'catalog_item', entityId: created.id, action: 'CREATE', after: created });
    return serializeCatalogItem(created);
  }

  async update(id: string, dto: UpdateCatalogItemDto): Promise<ReturnType<typeof serializeCatalogItem>> {
    const updated = await this.tx(async (tx) => {
      const found = await tx.catalogItem.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!found) throw catalogItemNotFound();
      return tx.catalogItem.update({
        where: { id },
        data: {
          label: dto.label,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
          ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
        },
      });
    });
    await this.audit.record({ entity: 'catalog_item', entityId: id, action: 'UPDATE', after: updated });
    return serializeCatalogItem(updated);
  }

  /** Soft-delete. */
  async remove(id: string): Promise<void> {
    await this.tx(async (tx) => {
      const found = await tx.catalogItem.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!found) throw catalogItemNotFound();
      await tx.catalogItem.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
    await this.audit.record({ entity: 'catalog_item', entityId: id, action: 'DELETE' });
  }
}
