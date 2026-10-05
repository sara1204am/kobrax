import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { ResponseDto, validateArrearCategories, type ApiResponse, type ArrearCategory } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { arrearCategoriesInvalid } from './arrear-categories.errors';
import type { ReplaceArrearCategoriesDto } from './dto/arrear-categories.dto';

/**
 * Los rangos de la categoría de mora de la cuenta (F4/08 · D1-b). Se configuran en Administración y **no se
 * guardan en el crédito**: la categoría se calcula con los rangos vigentes (`categoryForDays`). Cada lectura va
 * a la base —no hay caché—, así que un cambio rige en la siguiente petición de la lista, la ficha y la exportación.
 */
@Injectable()
export class ArrearCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async list(): Promise<ApiResponse<ArrearCategory[]>> {
    return ResponseDto.ok(await this.tx((tx) => this.read(tx)));
  }

  /**
   * Reemplaza el juego completo. Valida primero (400 con los códigos de error) y escribe en una transacción:
   * las que ya existían por código se actualizan (conservan su id), las que faltan en el nuevo juego se borran y las
   * nuevas se crean. El orden (`sort_order`) es el de los rangos, no el que mande la pantalla.
   * Una sola entrada de auditoría con el antes y el después.
   */
  async replace(dto: ReplaceArrearCategoriesDto): Promise<ApiResponse<ArrearCategory[]>> {
    const errors = validateArrearCategories(dto.categories.map((c) => ({ code: c.code, fromDays: c.fromDays, toDays: c.toDays })));
    if (errors.length > 0) throw arrearCategoriesInvalid(errors);

    const accountId = this.tenant.accountId;
    const next = dto.categories
      .map((c) => ({ code: c.code.trim(), name: c.name.trim() || c.code.trim(), fromDays: c.fromDays, toDays: c.toDays, color: c.color?.trim() || null }))
      .sort((a, b) => a.fromDays - b.fromDays)
      .map((c, i) => ({ ...c, sortOrder: i + 1 }));

    const { before, after } = await this.tx(async (tx) => {
      const before = await this.read(tx);
      await tx.arrearCategory.deleteMany({ where: { accountId, code: { notIn: next.map((c) => c.code) } } });
      for (const c of next) {
        const data = { name: c.name, fromDays: c.fromDays, toDays: c.toDays, color: c.color, sortOrder: c.sortOrder };
        await tx.arrearCategory.upsert({
          where: { accountId_code: { accountId, code: c.code } },
          create: { accountId, code: c.code, ...data },
          update: data,
        });
      }
      return { before, after: await this.read(tx) };
    });

    await this.audit.record({
      entity: 'arrear_categories',
      entityId: accountId,
      action: before.length === 0 ? 'CREATE' : 'UPDATE',
      before: before.map(brief),
      after: after.map(brief),
    });
    return ResponseDto.ok(after);
  }

  private async read(tx: PrismaClient): Promise<ArrearCategory[]> {
    const rows = await tx.arrearCategory.findMany({
      where: { accountId: this.tenant.accountId },
      orderBy: [{ sortOrder: 'asc' }, { fromDays: 'asc' }],
    });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, fromDays: r.fromDays, toDays: r.toDays, color: r.color, sortOrder: r.sortOrder }));
  }
}

/** Lo que va a la auditoría: los rangos, sin ids. */
function brief(c: ArrearCategory) {
  return { code: c.code, name: c.name, fromDays: c.fromDays, toDays: c.toDays, color: c.color };
}
