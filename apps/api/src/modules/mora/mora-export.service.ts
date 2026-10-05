import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { PrismaClient } from '@prisma/client';
import type { MoraCreditListItem } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { csvHeader, csvRows } from '../exports/csv';
import type { ListMoraQueryDto } from './dto/mora.dto';
import {
  buildMoraPdf,
  describeFilters,
  describeSort,
  inRequestContext,
  moraCsvRow,
  MORA_CSV_COLUMNS,
  MORA_CSV_MAX_ROWS,
  MORA_PDF_MAX_ROWS,
  type MoraNames,
} from './mora-export';
import { MoraService } from './mora.service';

export interface MoraCsvFile {
  filename: string;
  stream: Readable;
}
export interface MoraPdfFile {
  filename: string;
  content: Buffer;
}

/** Los parámetros de paginación no son parte de lo que se exporta: se baja todo el resultado. */
function exportedFilters(q: ListMoraQueryDto): Record<string, unknown> {
  const { page: _page, limit: _limit, ...rest } = q;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ''));
}

const stamp = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Exportar la lista de Mora, **exactamente lo que se está viendo**: mismo filtro, mismo orden y mismo alcance
 * que `GET /mora`, porque pasa por la misma consulta (`MoraService.batches`). El alcance (cobrador: lo suyo; supervisor: su agencia) sale de la misma consulta.
 *
 * 🔴 **El tope se rechaza antes de empezar.** Con la respuesta ya en camino no se puede contestar un error, y
 * un archivo que se corta a mitad se ve completo: es peor que no tener archivo.
 */
@Injectable()
export class MoraExportService {
  constructor(
    private readonly mora: MoraService,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private async assertWithin(query: ListMoraQueryDto, max: number, label: string, hint: string): Promise<number> {
    const total = await this.mora.count(query);
    if (total > max) {
      throw new UnprocessableEntityException({
        code: 'MORA_001',
        message: `Este filtro devuelve ${total.toLocaleString('es-BO')} créditos y el ${label} admite hasta ${max.toLocaleString('es-BO')}. ${hint}`,
      });
    }
    return total;
  }

  /** Responsables por id, para no mostrar uuids. Lo que no se encuentra queda sin nombre, no con el id. */
  private async resolveNames(items: MoraCreditListItem[], into: MoraNames): Promise<void> {
    const missing = [...new Set(items.map((i) => i.responsibleId).filter((id): id is string => !!id && !into.has(id)))];
    if (missing.length === 0) return;
    const profiles = await this.tx((tx) =>
      tx.profile.findMany({ where: { userId: { in: missing } }, select: { userId: true, firstName: true, lastName: true } }),
    );
    for (const p of profiles) into.set(p.userId, `${p.firstName} ${p.lastName}`.trim());
  }

  private audited(format: 'csv' | 'pdf', rows: number, query: ListMoraQueryDto): Promise<void> {
    return this.audit.record({
      entity: 'export:mora',
      entityId: this.tenant.accountId,
      action: 'EXPORT',
      after: { format, rows, filters: exportedFilters(query) },
    });
  }

  async csv(query: ListMoraQueryDto): Promise<MoraCsvFile> {
    const total = await this.assertWithin(query, MORA_CSV_MAX_ROWS, 'CSV', 'Agregá filtros para bajarlo por partes.');
    await this.audited('csv', total, query);

    const names: MoraNames = new Map();
    const columns = [...MORA_CSV_COLUMNS];
    const mora = this.mora;
    const resolve = this.resolveNames.bind(this);
    async function* chunks(): AsyncGenerator<Buffer> {
      yield Buffer.from(csvHeader(columns), 'utf-8');
      for await (const batch of mora.batches(query)) {
        await resolve(batch, names);
        yield Buffer.from(csvRows(batch.map((c) => moraCsvRow(c, names)), columns), 'utf-8');
      }
    }
    return { filename: `creditos-en-mora-${stamp(new Date())}.csv`, stream: Readable.from(inRequestContext(chunks()), { objectMode: false }) };
  }

  async pdf(query: ListMoraQueryDto): Promise<MoraPdfFile> {
    const total = await this.assertWithin(query, MORA_PDF_MAX_ROWS, 'PDF', 'Agregá filtros, o bajá el CSV para el detalle completo.');
    await this.audited('pdf', total, query);

    const items: MoraCreditListItem[] = [];
    for await (const batch of this.mora.batches(query)) items.push(...batch);

    const names: MoraNames = new Map();
    await this.resolveNames(items, names);

    const scope = this.mora.exportScope();
    const [account, me, assignee, branch] = await this.tx((tx) =>
      Promise.all([
        tx.account.findUnique({ where: { id: this.tenant.accountId }, select: { businessName: true, currencyCode: true } }),
        scope.userId ? tx.profile.findUnique({ where: { userId: scope.userId }, select: { firstName: true, lastName: true } }) : null,
        query.assigneeId ? tx.profile.findUnique({ where: { userId: query.assigneeId }, select: { firstName: true, lastName: true } }) : null,
        query.branchId ? tx.branch.findUnique({ where: { id: query.branchId }, select: { name: true } }) : null,
      ]),
    );
    const full = (p: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}`.trim() : undefined);

    const now = new Date();
    const content = await buildMoraPdf(items, {
      accountName: account?.businessName ?? 'Kobrax',
      currency: account?.currencyCode ?? undefined,
      generatedBy: full(me),
      ownOnly: scope.ownOnly,
      branchScope: scope.kind === 'BRANCH',
      filters: describeFilters(query, { assignee: full(assignee), branch: branch?.name }),
      sort: describeSort(query.sort, query.dir),
      names,
      now,
    });
    return { filename: `creditos-en-mora-${stamp(now)}.pdf`, content };
  }
}
