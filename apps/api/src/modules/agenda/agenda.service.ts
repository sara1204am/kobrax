import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus } from '@prisma/client';
import { Permission, resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { serializeAgendaItem } from './agenda.serializer';
import { ListOverdueQueryDto } from './dto/agenda.dto';

/** Gestiones agendadas (lectura — S1). Escritura (crear/editar/completar) llega en S2–S6. */
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /**
   * Scope por capacidad: sin `AGENDA_ASSIGN` (cobrador) solo ve SUS agendados; quien supervisa
   * (con AGENDA_ASSIGN) ve los de todo el tenant.
   */
  private assigneeScope(): Prisma.AgendaItemWhereInput {
    return this.tenant.can(Permission.AGENDA_ASSIGN) ? {} : { assigneeId: this.tenant.userId };
  }

  /** Resuelve nombre visible del deudor por clientId (ref suave → sin join Prisma). */
  private async clientNames(tx: PrismaClient, ids: string[]): Promise<Map<string, string | undefined>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Map();
    const clients = await tx.client.findMany({
      where: { id: { in: uniq } },
      select: { id: true, firstName: true, lastName: true, businessName: true },
    });
    const m = new Map<string, string | undefined>();
    for (const c of clients) {
      const name = c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || undefined;
      m.set(c.id, name);
    }
    return m;
  }

  /** Agendados de un día (la pantalla principal separa secciones por `status`). */
  async listByDay(dateStr: string): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>[]>> {
    const date = new Date(dateStr);
    const now = new Date();
    const { rows, names } = await this.tx(async (tx) => {
      const rows = await tx.agendaItem.findMany({
        where: { deletedAt: null, scheduledDate: date, ...this.assigneeScope() },
        orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'asc' }],
      });
      return { rows, names: await this.clientNames(tx, rows.map((r) => r.clientId)) };
    });
    return ResponseDto.ok(rows.map((r) => serializeAgendaItem(r, names.get(r.clientId), now)));
  }

  /** Vencidos: SCHEDULED con fecha < hoy, desc por fecha, paginado (`meta.total` → "ver más"). */
  async listOverdue(query: ListOverdueQueryDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const where: Prisma.AgendaItemWhereInput = {
      deletedAt: null,
      status: AgendaItemStatus.SCHEDULED,
      scheduledDate: { lt: today },
      ...this.assigneeScope(),
    };
    const { rows, total, names } = await this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.agendaItem.findMany({ where, orderBy: { scheduledDate: 'desc' }, skip, take: limit }),
        tx.agendaItem.count({ where }),
      ]);
      return { rows, total, names: await this.clientNames(tx, rows.map((r) => r.clientId)) };
    });
    return ResponseDto.paginated(rows.map((r) => serializeAgendaItem(r, names.get(r.clientId), now)), total, page, limit);
  }
}
