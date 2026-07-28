import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CaseStatus, RouteStatus, RouteStopStatus } from '@prisma/client';
import { Permission, resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { serializeRoute, serializeStop } from './routes.serializer';
import { AddStopDto, CreateRouteDto, GenerateRouteDto, ListRoutesQueryDto, UpdateRouteDto, UpdateStopDto } from './dto/route.dto';
import { invalidCollector, noStopsToRoute, resourceNotFound, routeForbidden, stopDuplicate, stopNotPending } from './routes.errors';

const OPEN_CASE_STATUSES = { notIn: [CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF] };

/**
 * Lo que la parada necesita del cliente para poder pintarse: nombre y dirección.
 * `relationId: null` = ubicaciones del cliente, no las de sus garantes/contactos.
 */
const STOP_CLIENT = {
  select: {
    firstName: true,
    lastName: true,
    businessName: true,
    locations: { where: { relationId: null }, select: { locationType: true, address: true }, orderBy: { createdAt: 'asc' } },
  },
} satisfies Prisma.ClientDefaultArgs;

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly crypto: CryptoService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private async assertCollector(tx: PrismaClient, collectorId: string): Promise<void> {
    const ua = await tx.userAccount.findFirst({ where: { userId: collectorId, isActive: true }, select: { id: true } });
    if (!ua) throw invalidCollector();
  }

  /**
   * Para qué cobrador se arma la ruta, según la capacidad de quien pide (mismo modelo que `list`):
   * quien administra rutas elige; el ejecutor de campo sólo puede armar la suya (se ignora el
   * `collectorId` del body); quien no hace ninguna de las dos, no arma nada.
   */
  private collectorFor(requested: string, action: string): string {
    if (this.tenant.can(Permission.ROUTE_ASSIGN) || this.tenant.can(Permission.ROUTE_WRITE)) return requested;
    if (!this.tenant.can(Permission.ROUTE_EXECUTE)) throw routeForbidden(action);
    return this.tenant.userId!;
  }

  /**
   * La ruta existe y este usuario la puede modificar: quien administra rutas, cualquiera del tenant;
   * el ejecutor de campo, sólo la suya. Una ruta ajena responde 404 y no 403 — no se filtra que exista.
   */
  private async assertOwnRoute(tx: PrismaClient, routeId: string): Promise<{ id: string; collectorId: string }> {
    const route = await tx.routePlan.findFirst({ where: { id: routeId }, select: { id: true, collectorId: true } });
    if (!route) throw resourceNotFound();
    if (this.tenant.can(Permission.ROUTE_WRITE) || this.tenant.can(Permission.ROUTE_ASSIGN)) return route;
    if (!this.tenant.can(Permission.ROUTE_EXECUTE)) throw routeForbidden('modificar la ruta');
    if (route.collectorId !== this.tenant.userId) throw resourceNotFound();
    return route;
  }

  /**
   * Reescribe la secuencia completa en el orden dado, **en dos pasadas**: primero a un rango temporal
   * alto, después a los valores finales. `route_stops` tiene `unique(routeId, sequenceOrder)` y se
   * valida fila por fila, así que sin el corrimiento dos paradas comparten número a mitad de camino.
   * ponytail: 2N updates; con decenas de paradas no se nota. La salida elegante sería una constraint
   * DEFERRABLE, que es migración, no código.
   */
  private async resequence(tx: PrismaClient, orderedIds: string[]): Promise<void> {
    const TEMP = 10_000; // fuera de rango de cualquier ruta real
    for (const [i, id] of orderedIds.entries()) {
      await tx.routeStop.update({ where: { id }, data: { sequenceOrder: TEMP + i } });
    }
    for (const [i, id] of orderedIds.entries()) {
      await tx.routeStop.update({ where: { id }, data: { sequenceOrder: i + 1 } });
    }
  }

  /** Mismo modelo de capacidades que `generate`: el ejecutor de campo sólo crea rutas para sí mismo. */
  async create(dto: CreateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const collectorId = this.collectorFor(dto.collectorId, 'crear rutas');
    const route = await this.tx(async (tx) => {
      await this.assertCollector(tx, collectorId);
      return tx.routePlan.create({
        data: {
          accountId: this.tenant.accountId,
          collectorId,
          branchId: dto.branchId,
          plannedDate: new Date(dto.plannedDate),
          status: RouteStatus.PLANNED,
        },
      });
    });
    await this.audit.record({ entity: 'route', entityId: route.id, action: 'CREATE', after: { collectorId: route.collectorId } });
    return serializeRoute(route);
  }

  /**
   * Genera la ruta desde los casos abiertos. Mismo modelo de capacidades que `list`:
   *  - ROUTE_ASSIGN (supervisor): la genera para el cobrador que pida.
   *  - ejecutor de campo (ROUTE_EXECUTE sin ASSIGN): **sólo la suya** — es el camino de RT-0a,
   *    donde el cobrador arma su propia jornada; el `collectorId` del body se ignora.
   *  - observador de cuenta (ni ejecuta ni asigna): no genera nada.
   */
  async generate(dto: GenerateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const collectorId = this.collectorFor(dto.collectorId, 'generar rutas');

    const route = await this.tx(async (tx) => {
      await this.assertCollector(tx, collectorId);

      const cases = dto.caseIds?.length
        ? await tx.collectionCase.findMany({ where: { id: { in: dto.caseIds }, status: OPEN_CASE_STATUSES, deletedAt: null }, orderBy: { priority: 'desc' } })
        : await tx.collectionCase.findMany({ where: { assigneeId: collectorId, status: OPEN_CASE_STATUSES, deletedAt: null }, orderBy: { priority: 'desc' } });
      if (cases.length === 0) throw noStopsToRoute();

      const created = await tx.routePlan.create({
        data: {
          accountId: this.tenant.accountId,
          collectorId,
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

  /**
   * `true` para el cobrador: ejecuta rutas (ROUTE_EXECUTE) pero no las asigna (ROUTE_ASSIGN) → solo
   * ve las suyas. Un rol read-only de cuenta (auditor/viewer: ROUTE_READ sin execute) NO cae acá.
   */
  private scopedToOwnRoutes(): boolean {
    return this.tenant.can(Permission.ROUTE_EXECUTE) && !this.tenant.can(Permission.ROUTE_ASSIGN);
  }

  async list(query: ListRoutesQueryDto): Promise<ApiResponse<ReturnType<typeof serializeRoute>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.RoutePlanWhereInput = {};
    if (query.status) where.status = query.status;
    // Scope por capacidad (no por nombre de rol). Tres casos:
    //  - ROUTE_ASSIGN (supervisor/manager): ve todo, filtra por cualquier collectorId.
    //  - ejecutor de campo (ROUTE_EXECUTE sin ROUTE_ASSIGN = cobrador): acotado a sus rutas.
    //  - observador de cuenta (ROUTE_READ sin execute ni assign = auditor/viewer): ve toda la cuenta.
    if (this.tenant.can(Permission.ROUTE_ASSIGN)) {
      if (query.collectorId) where.collectorId = query.collectorId;
    } else if (this.scopedToOwnRoutes()) {
      where.collectorId = this.tenant.userId;
    }
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

  /**
   * Detalle con paradas. Cada parada trae el nombre del deudor y su dirección **en claro**: sin eso
   * la lista dice `Cliente a1b2c3…` y el cobrador no sabe adónde ir. Se audita el revelado, igual que
   * la agenda: es la única puerta por la que el cobrador ve direcciones sin `client:pii:read`.
   */
  async findOne(id: string): Promise<ReturnType<typeof serializeRoute>> {
    const route = await this.tx((tx) =>
      tx.routePlan.findFirst({
        where: { id },
        include: { stops: { orderBy: { sequenceOrder: 'asc' }, include: { client: STOP_CLIENT } } },
      }),
    );
    if (!route) throw resourceNotFound();
    // Mismo scope que el listado: un cobrador solo accede a su propia ruta, pero un auditor a cualquiera.
    if (this.scopedToOwnRoutes() && route.collectorId !== this.tenant.userId) {
      throw resourceNotFound();
    }
    if (route.stops.length > 0) {
      await this.audit.record({ entity: 'route', entityId: id, action: 'PII_REVEAL' });
    }
    return serializeRoute(route, this.crypto);
  }

  /**
   * Cambia el estado de la ruta. Con ROUTE_WRITE (supervisión), sobre cualquiera del tenant; el
   * ejecutor de campo sólo sobre la suya — es lo que hace "Iniciar ruta" en RT-0b. Una ruta ajena
   * responde 404 y no 403: no se filtra que exista, igual que en `findOne`.
   */
  async updateStatus(id: string, dto: UpdateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const route = await this.tx(async (tx) => {
      await this.assertOwnRoute(tx, id);
      return tx.routePlan.update({ where: { id }, data: { status: dto.status } });
    });
    await this.audit.record({ entity: 'route', entityId: id, action: 'UPDATE', after: { status: route.status } });
    if (route.status === RouteStatus.COMPLETED) {
      this.events.emit(DomainEvent.ROUTE_COMPLETED, { routeId: id, collectorId: route.collectorId, accountId: this.tenant.accountId });
    }
    return serializeRoute(route);
  }

  /**
   * Agrega una parada al final del recorrido (S2: cada toque en el mapa). El `sequenceOrder` se
   * calcula **dentro de la transacción** porque dos toques seguidos chocarían contra
   * `unique(routeId, sequenceOrder)`.
   */
  async addStop(routeId: string, dto: AddStopDto) {
    const stop = await this.tx(async (tx) => {
      await this.assertOwnRoute(tx, routeId);
      if (dto.caseId) {
        const dup = await tx.routeStop.findFirst({ where: { routeId, caseId: dto.caseId }, select: { id: true } });
        if (dup) throw stopDuplicate();
      }
      const last = await tx.routeStop.findFirst({
        where: { routeId },
        orderBy: { sequenceOrder: 'desc' },
        select: { sequenceOrder: true },
      });
      const created = await tx.routeStop.create({
        data: {
          accountId: this.tenant.accountId,
          routeId,
          clientId: dto.clientId,
          caseId: dto.caseId,
          sequenceOrder: (last?.sequenceOrder ?? 0) + 1,
        },
        include: { client: STOP_CLIENT },
      });
      await tx.routePlan.update({ where: { id: routeId }, data: { totalCases: { increment: 1 } } });
      return created;
    });
    await this.audit.record({ entity: 'route_stop', entityId: stop.id, action: 'CREATE', after: { routeId, clientId: stop.clientId } });
    return serializeStop(stop, this.crypto);
  }

  /**
   * Saca una parada del recorrido. Es un borrado real: la parada agregada por error nunca estuvo en
   * la jornada (distinto de `SKIPPED`, que es "fui y no la hice"). Las que siguen se corren para que
   * la secuencia no quede con agujeros — el número es la posición que ve el cobrador.
   */
  async removeStop(routeId: string, stopId: string): Promise<void> {
    await this.tx(async (tx) => {
      await this.assertOwnRoute(tx, routeId);
      const stop = await tx.routeStop.findFirst({ where: { id: stopId, routeId } });
      if (!stop) throw resourceNotFound();
      if (stop.status !== RouteStopStatus.PENDING) throw stopNotPending();

      await tx.routeStop.delete({ where: { id: stopId } });
      const rest = await tx.routeStop.findMany({ where: { routeId }, orderBy: { sequenceOrder: 'asc' }, select: { id: true } });
      await this.resequence(tx, rest.map((s) => s.id));
      await tx.routePlan.update({ where: { id: routeId }, data: { totalCases: rest.length } });
    });
    await this.audit.record({ entity: 'route_stop', entityId: stopId, action: 'DELETE', before: { routeId } });
  }

  /**
   * Cambia el estado de una parada (S5) y/o la mueve de posición (S2). Mover **reordena la lista
   * entera**: escribir el número a secas chocaría con `unique(routeId, sequenceOrder)`.
   */
  async updateStop(routeId: string, stopId: string, dto: UpdateStopDto) {
    const stop = await this.tx(async (tx) => {
      await this.assertOwnRoute(tx, routeId);
      const found = await tx.routeStop.findFirst({ where: { id: stopId, routeId } });
      if (!found) throw resourceNotFound();

      if (dto.sequenceOrder != null && dto.sequenceOrder !== found.sequenceOrder) {
        if (found.status !== RouteStopStatus.PENDING) throw stopNotPending();
        const all = await tx.routeStop.findMany({ where: { routeId }, orderBy: { sequenceOrder: 'asc' }, select: { id: true } });
        const ids = all.map((s) => s.id).filter((id) => id !== stopId);
        // La posición pedida se acota al largo real: el móvil no tiene por qué conocerlo.
        const target = Math.min(Math.max(dto.sequenceOrder, 1), ids.length + 1);
        ids.splice(target - 1, 0, stopId);
        await this.resequence(tx, ids);
      }

      if (dto.status) {
        await tx.routeStop.update({
          where: { id: stopId },
          data: {
            status: dto.status,
            ...(dto.status === RouteStopStatus.VISITED ? { visitedAt: new Date() } : {}),
          },
        });
      }
      return tx.routeStop.findFirstOrThrow({ where: { id: stopId } });
    });
    return { id: stop.id, status: stop.status, sequenceOrder: stop.sequenceOrder };
  }
}
