import { HttpException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, RouteStatus, type PrismaClient, type RouteChangeRequest } from '@prisma/client';
import { isValidReason, routeIsOpen, type RouteChangeRequestItem, type RouteStatus as SharedRouteStatus } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { DomainEvent, EventBusService, type RouteNoticePayload } from '../../common/events/event-bus.service';
import { isUniqueViolation } from '../../common/unique-violation';
import { RoutesService } from './routes.service';
import { CreateChangeRequestDto, DecideChangeRequestDto } from './dto/route.dto';
import {
  cannotDecide,
  changeRequestIdTaken,
  changeRequestNotFound,
  changeRequestResolved,
  changeRequestStale,
  reasonRequired,
  resourceNotFound,
  routeClosed,
} from './routes.errors';

/** Ya puede hacerlo directo: pedir permiso para lo propio no tiene sentido. */
const notNeeded = () =>
  new UnprocessableEntityException({ code: 'ROUTE_REQUEST_NOT_NEEDED', message: 'Esta ruta la armaste vos: hacé el cambio directamente.' });

const badPayload = (why: string) => new UnprocessableEntityException({ code: 'ROUTE_REQUEST_PAYLOAD', message: why });

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Pedidos de cambio sobre una ruta ajena (F4/12 · decisión 1).
 *
 * Quien **armó** la ruta manda sobre ella. Cualquier otra persona —el cobrador de una ruta que armó el manager, o un
 * manager que no la armó— no la modifica: **la pide**, con el motivo escrito. Quien la armó aprueba (y la API aplica el
 * cambio con las mismas reglas de siempre) o rechaza. Quien lo pidió puede retirarlo mientras esté sin resolver.
 *
 * Alcance v1: agregar, quitar y mover una parada, y cancelar la ruta.
 */
@Injectable()
export class RouteChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly routes: RoutesService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private notice(p: Omit<RouteNoticePayload, 'accountId' | 'actorId'>): void {
    if (!this.tenant.userId || p.recipientId === this.tenant.userId) return;
    this.events.emit(DomainEvent.ROUTE_NOTICE, { ...p, accountId: this.tenant.accountId, actorId: this.tenant.userId } satisfies RouteNoticePayload);
  }

  async create(routeId: string, dto: CreateChangeRequestDto): Promise<RouteChangeRequestItem> {
    const { route, roles } = await this.routes.contextOf(routeId);
    if (roles.canManage) throw notNeeded();
    if (!routeIsOpen(route.status as unknown as SharedRouteStatus)) throw routeClosed();
    const reason = dto.reason.trim();
    if (!isValidReason(reason)) throw reasonRequired('del cambio que pedís');
    const payload = dto.payload ?? {};

    // Reintento de un pedido ya creado (mismo id, misma persona, misma ruta): se devuelve el existente, sin duplicar,
    // sin volver a auditar y sin volver a avisar.
    if (dto.id) {
      const prev = await this.tx((tx) => tx.routeChangeRequest.findFirst({ where: { id: dto.id } }));
      if (prev) {
        if (prev.routeId !== routeId || prev.requestedBy !== this.tenant.userId) throw changeRequestIdTaken();
        return (await this.serialize([prev]))[0]!;
      }
    }

    let created: RouteChangeRequest;
    try {
      created = await this.tx(async (tx) => {
      await this.checkPayload(tx, routeId, dto.kind, payload);
      return tx.routeChangeRequest.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          accountId: this.tenant.accountId,
          routeId,
          requestedBy: this.tenant.userId!,
          kind: dto.kind,
          payload: payload as Prisma.InputJsonValue,
          reason,
        },
      });
      });
    } catch (err) {
      // Dos intentos del mismo pedido a la vez: gana uno y el otro lee el ya creado.
      if (dto.id && isUniqueViolation(err)) {
        const dup = await this.tx((tx) => tx.routeChangeRequest.findFirst({ where: { id: dto.id } }));
        if (dup && dup.routeId === routeId && dup.requestedBy === this.tenant.userId) return (await this.serialize([dup]))[0]!;
        throw changeRequestIdTaken();
      }
      throw err;
    }
    await this.audit.record({ entity: 'route_change_request', entityId: created.id, action: 'CREATE', after: { routeId, kind: dto.kind, reason } });
    // Lo aprueba quien armó la ruta; si no hay creador (ruta anterior a F4/12) no hace falta pedir nada.
    if (route.createdBy) {
      this.notice({ kind: 'CHANGE_REQUESTED', routeId, recipientId: route.createdBy, plannedDate: route.plannedDate.toISOString().slice(0, 10), reason, requestKind: dto.kind });
    }
    return (await this.serialize([created]))[0]!;
  }

  /** Lo pedido tiene que referirse a algo real de ESTA ruta: se rechaza al pedirlo, no al aprobarlo. */
  private async checkPayload(tx: PrismaClient, routeId: string, kind: string, p: Record<string, unknown>): Promise<void> {
    if (kind === 'ADD_STOP') {
      if (!isString(p.clientId)) throw badPayload('Falta el cliente de la parada que pedís agregar.');
      return;
    }
    if (kind === 'REMOVE_STOP' || kind === 'REORDER') {
      if (!isString(p.stopId)) throw badPayload('Falta la parada.');
      const stop = await tx.routeStop.findFirst({ where: { id: p.stopId, routeId }, select: { status: true } });
      if (!stop) throw resourceNotFound();
      if (kind === 'REORDER' && !(Number.isInteger(p.sequenceOrder) && (p.sequenceOrder as number) >= 1)) throw badPayload('Falta la posición nueva.');
    }
  }

  async list(routeId: string): Promise<RouteChangeRequestItem[]> {
    const { roles } = await this.routes.contextOf(routeId);
    const rows = await this.tx((tx) =>
      tx.routeChangeRequest.findMany({
        where: { routeId, ...(roles.canManage ? {} : { requestedBy: this.tenant.userId }) },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
      }),
    );
    // Las sin resolver primero: son las que esperan a alguien.
    rows.sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'));
    return this.serialize(rows);
  }

  async decide(routeId: string, requestId: string, dto: DecideChangeRequestDto): Promise<RouteChangeRequestItem> {
    const { route, roles } = await this.routes.contextOf(routeId);
    const req = await this.tx((tx) => tx.routeChangeRequest.findFirst({ where: { id: requestId, routeId } }));
    if (!req) throw changeRequestNotFound();
    if (req.status !== 'PENDING') throw changeRequestResolved();

    const note = dto.note?.trim() || undefined;
    const day = route.plannedDate.toISOString().slice(0, 10);

    if (dto.decision === 'WITHDRAW') {
      if (req.requestedBy !== this.tenant.userId) throw cannotDecide();
      const done = await this.close(req, 'WITHDRAWN', note);
      await this.audit.record({ entity: 'route_change_request', entityId: req.id, action: 'UPDATE', after: { status: 'WITHDRAWN' } });
      return done;
    }

    if (!roles.canManage) throw cannotDecide();

    if (dto.decision === 'REJECT') {
      const done = await this.close(req, 'REJECTED', note);
      await this.audit.record({ entity: 'route_change_request', entityId: req.id, action: 'UPDATE', after: { status: 'REJECTED', note } });
      this.notice({ kind: 'CHANGE_REJECTED', routeId, recipientId: req.requestedBy, plannedDate: day, reason: note, requestKind: req.kind });
      return done;
    }

    // APROBAR: se «reclama» el pedido primero (dos aprobaciones a la vez no aplican el cambio dos veces) y se aplica;
    // si ya no se puede aplicar, el pedido vuelve a quedar sin resolver y se explica por qué.
    const claimed = await this.tx((tx) =>
      tx.routeChangeRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedBy: this.tenant.userId, decidedAt: new Date(), decisionNote: note ?? null } }),
    );
    if (claimed.count === 0) throw changeRequestResolved();
    try {
      await this.apply(routeId, req);
    } catch (err) {
      await this.tx((tx) => tx.routeChangeRequest.updateMany({ where: { id: req.id }, data: { status: 'PENDING', decidedBy: null, decidedAt: null, decisionNote: null } }));
      if (err instanceof HttpException) {
        const body = err.getResponse() as { message?: string };
        throw changeRequestStale(body?.message ?? 'la ruta cambió.');
      }
      throw err;
    }
    await this.audit.record({ entity: 'route_change_request', entityId: req.id, action: 'UPDATE', after: { status: 'APPROVED', kind: req.kind, note } });
    this.notice({ kind: 'CHANGE_APPROVED', routeId, recipientId: req.requestedBy, plannedDate: day, requestKind: req.kind });
    const fresh = await this.tx((tx) => tx.routeChangeRequest.findFirstOrThrow({ where: { id: req.id } }));
    return (await this.serialize([fresh]))[0]!;
  }

  /** Aplica el cambio con las mismas reglas de siempre: quien aprueba es quien manda sobre la ruta. */
  private async apply(routeId: string, req: RouteChangeRequest): Promise<void> {
    const p = (req.payload ?? {}) as Record<string, unknown>;
    switch (req.kind) {
      case 'ADD_STOP':
        await this.routes.addStop(routeId, { clientId: String(p.clientId), creditId: isString(p.creditId) ? p.creditId : undefined, locationId: isString(p.locationId) ? p.locationId : undefined });
        return;
      case 'REMOVE_STOP':
        await this.routes.removeStop(routeId, String(p.stopId));
        return;
      case 'REORDER':
        await this.routes.updateStop(routeId, String(p.stopId), { sequenceOrder: Number(p.sequenceOrder) });
        return;
      case 'CANCEL':
        await this.routes.updateStatus(routeId, { status: RouteStatus.CANCELLED, reason: req.reason });
        return;
    }
  }

  private async close(req: RouteChangeRequest, status: 'REJECTED' | 'WITHDRAWN', note?: string): Promise<RouteChangeRequestItem> {
    const res = await this.tx((tx) =>
      tx.routeChangeRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status, decidedBy: this.tenant.userId, decidedAt: new Date(), decisionNote: note ?? null } }),
    );
    if (res.count === 0) throw changeRequestResolved();
    const fresh = await this.tx((tx) => tx.routeChangeRequest.findFirstOrThrow({ where: { id: req.id } }));
    return (await this.serialize([fresh]))[0]!;
  }

  private async serialize(rows: RouteChangeRequest[]): Promise<RouteChangeRequestItem[]> {
    const ids = [...new Set(rows.map((r) => r.requestedBy))];
    const profiles = ids.length
      ? await this.tx((tx) => tx.profile.findMany({ where: { userId: { in: ids } }, select: { userId: true, firstName: true, lastName: true } }))
      : [];
    const names = new Map(profiles.map((p) => [p.userId, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()]));
    return rows.map((r) => ({
      id: r.id,
      routeId: r.routeId,
      requestedBy: r.requestedBy,
      requestedByName: names.get(r.requestedBy) || undefined,
      kind: r.kind,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      reason: r.reason,
      status: r.status,
      decidedBy: r.decidedBy ?? undefined,
      decidedAt: r.decidedAt?.toISOString(),
      decisionNote: r.decisionNote ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
