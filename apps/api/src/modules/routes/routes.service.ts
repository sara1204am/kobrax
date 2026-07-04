import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CaseStatus, RouteStatus, RouteStopStatus } from '@prisma/client';
import { resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { serializeRoute } from './routes.serializer';
import { CreateRouteDto, GenerateRouteDto, ListRoutesQueryDto, UpdateRouteDto, UpdateStopDto } from './dto/route.dto';
import { invalidCollector, noStopsToRoute, resourceNotFound } from './routes.errors';

const OPEN_CASE_STATUSES = { notIn: [CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF] };

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private async assertCollector(tx: PrismaClient, collectorId: string): Promise<void> {
    const ua = await tx.userAccount.findFirst({ where: { userId: collectorId, isActive: true }, select: { id: true } });
    if (!ua) throw invalidCollector();
  }

  async create(dto: CreateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const route = await this.tx(async (tx) => {
      await this.assertCollector(tx, dto.collectorId);
      return tx.routePlan.create({
        data: {
          accountId: this.tenant.accountId,
          collectorId: dto.collectorId,
          branchId: dto.branchId,
          plannedDate: new Date(dto.plannedDate),
          status: RouteStatus.PLANNED,
        },
      });
    });
    await this.audit.record({ entity: 'route', entityId: route.id, action: 'CREATE', after: { collectorId: route.collectorId } });
    return serializeRoute(route);
  }

  async generate(dto: GenerateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const route = await this.tx(async (tx) => {
      await this.assertCollector(tx, dto.collectorId);

      const cases = dto.caseIds?.length
        ? await tx.collectionCase.findMany({ where: { id: { in: dto.caseIds }, status: OPEN_CASE_STATUSES, deletedAt: null }, orderBy: { priority: 'desc' } })
        : await tx.collectionCase.findMany({ where: { assigneeId: dto.collectorId, status: OPEN_CASE_STATUSES, deletedAt: null }, orderBy: { priority: 'desc' } });
      if (cases.length === 0) throw noStopsToRoute();

      const created = await tx.routePlan.create({
        data: {
          accountId: this.tenant.accountId,
          collectorId: dto.collectorId,
          branchId: dto.branchId,
          plannedDate: new Date(dto.plannedDate),
          status: RouteStatus.PLANNED,
          totalCases: cases.length,
          stops: {
            create: cases.map((c, i) => ({
              accountId: this.tenant.accountId,
              clientId: c.clientId,
              caseId: c.id,
              sequenceOrder: i + 1, // ordenado por prioridad (CRITICAL primero)
            })),
          },
        },
        include: { stops: { orderBy: { sequenceOrder: 'asc' } } },
      });
      return created;
    });
    await this.audit.record({ entity: 'route', entityId: route.id, action: 'GENERATE', after: { collectorId: route.collectorId, totalCases: route.totalCases } });
    return serializeRoute(route);
  }

  async list(query: ListRoutesQueryDto): Promise<ApiResponse<ReturnType<typeof serializeRoute>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.RoutePlanWhereInput = {};
    if (query.collectorId) where.collectorId = query.collectorId;
    if (query.status) where.status = query.status;
    if (query.date) {
      const d = new Date(query.date);
      where.plannedDate = d;
    }
    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.routePlan.findMany({ where, orderBy: { plannedDate: 'desc' }, skip, take: limit }),
        tx.routePlan.count({ where }),
      ]),
    );
    return ResponseDto.paginated(rows.map((r) => serializeRoute(r)), total, page, limit);
  }

  async findOne(id: string): Promise<ReturnType<typeof serializeRoute>> {
    const route = await this.tx((tx) =>
      tx.routePlan.findFirst({ where: { id }, include: { stops: { orderBy: { sequenceOrder: 'asc' } } } }),
    );
    if (!route) throw resourceNotFound();
    return serializeRoute(route);
  }

  async updateStatus(id: string, dto: UpdateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const route = await this.tx(async (tx) => {
      const found = await tx.routePlan.findFirst({ where: { id }, select: { id: true } });
      if (!found) throw resourceNotFound();
      return tx.routePlan.update({ where: { id }, data: { status: dto.status } });
    });
    await this.audit.record({ entity: 'route', entityId: id, action: 'UPDATE', after: { status: route.status } });
    if (route.status === RouteStatus.COMPLETED) {
      this.events.emit(DomainEvent.ROUTE_COMPLETED, { routeId: id, collectorId: route.collectorId, accountId: this.tenant.accountId });
    }
    return serializeRoute(route);
  }

  async updateStop(routeId: string, stopId: string, dto: UpdateStopDto) {
    const stop = await this.tx(async (tx) => {
      const found = await tx.routeStop.findFirst({ where: { id: stopId, routeId }, select: { id: true } });
      if (!found) throw resourceNotFound();
      return tx.routeStop.update({
        where: { id: stopId },
        data: {
          status: dto.status,
          sequenceOrder: dto.sequenceOrder,
          ...(dto.status === RouteStopStatus.VISITED ? { visitedAt: new Date() } : {}),
        },
      });
    });
    return { id: stop.id, status: stop.status, sequenceOrder: stop.sequenceOrder };
  }
}
