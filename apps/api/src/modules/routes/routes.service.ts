import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, RouteStatus, RouteStopStatus } from '@prisma/client';
import {
  Permission,
  ROUTE_MAX_DAYS_AHEAD,
  ResponseDto,
  canTransitionRoute,
  canTransitionStop,
  isOpenStop,
  isValidReason,
  resolvePagination,
  routeIsOpen,
  type ApiResponse,
  type RouteCapabilities,
  type RouteStatus as SharedRouteStatus,
  type RouteStopStatus as SharedStopStatus,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { TenantClockService, civilDayStartInstant } from '../../common/context/tenant-clock.service';
import { AuditService } from '../../common/audit/audit.service';
import { ROUTE_CLOSE_REASON_MIN_APP_VERSION, legacyClientReason, type LegacyClientReason } from '../../common/app-version';
import { EventBusService, DomainEvent, type RouteNoticePayload } from '../../common/events/event-bus.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { isUniqueViolation } from '../../common/unique-violation';
import { clientDisplayName } from '../clients/clients.serializer';
import { moraAccessConditions, moraScopeOf, visibleCredits } from '../mora/mora-query';
import { serializeRoute, serializeStop } from './routes.serializer';
import type { RoutePdfContext } from './route-pdf';
import { OsrmService, type OsrmRoute, type OsrmTrip } from './osrm.service';
import { routeCapabilities, routeRoles, type RouteRoles } from './route-access';
import { AddStopDto, CreateRouteDto, GenerateRouteDto, LegDto, ListRoutesQueryDto, PlanPreviewDto, UpdateRouteDto, UpdateStopDto } from './dto/route.dto';
import {
  changeRequestRequired,
  invalidCollector,
  noStopsToRoute,
  reasonRequired,
  resourceNotFound,
  routeAlreadyForDay,
  routeClosed,
  routeForbidden,
  routeHasVisits,
  routeIdTaken,
  routePastDate,
  routeTooFar,
  routeStateChanged,
  routeTransition,
  stopDuplicate,
  stopNotPending,
  stopStatusNotAllowed,
  stopsWithoutPoint,
} from './routes.errors';

/**
 * Lo que la parada necesita del cliente para poder pintarse: nombre, dirección y **el punto en el
 * mapa** (S3: la polilínea y el cálculo de OSRM salen de acá, sin queries nuevas).
 *
 * F4/12: vienen TODAS las ubicaciones (también las de garantes y familiares, con `relationId`), porque la parada
 * puede apuntar a cualquiera de ellas (`route_stops.location_id`). La «principal» sigue siendo la del propio cliente.
 */
const STOP_CLIENT = {
  select: {
    firstName: true,
    lastName: true,
    businessName: true,
    locations: {
      select: {
        id: true,
        locationType: true,
        address: true,
        latitude: true,
        longitude: true,
        relationId: true,
        // La primera es la principal: es la que se ve chica en los mapas para reconocer la casa.
        photoUrls: true,
        relation: { select: { relatedName: true } },
      },
      orderBy: { createdAt: 'asc' },
    },
  },
} satisfies Prisma.ClientDefaultArgs;

/**
 * La última visita de la parada, para saber **cómo** terminó y no sólo que se visitó (S6: las
 * categorías del resumen). `take: 1` a propósito: una parada puede tener varias visitas y acá
 * interesa la que vale, no el historial entero de cada una de las 16 paradas.
 */
const STOP_VISIT = {
  select: { outcome: true },
  orderBy: { capturedAt: 'desc' },
  take: 1,
} satisfies Prisma.RouteStop$visitsArgs;

/** El crédito de la parada (F4/08: `route_stops.credit_id`, sin relación Prisma: se lee aparte). */
const STOP_CREDIT = {
  select: {
    id: true,
    outstandingBalance: true,
    currency: true,
    daysPastDue: true,
    externalSource: true,
    syncStatus: true,
    reportedAsOf: true,
    // La cuota que correspondía pagar: sale de lo pendiente del cronograma o, sin cronograma, de lo congelado/reportado.
    origin: true,
    metadata: true,
    installments: {
      where: { status: { not: 'PAID' } },
      orderBy: { number: 'asc' },
      take: 12,
      select: { number: true, dueDate: true, amount: true, paidAmount: true, status: true },
    },
  },
} satisfies Prisma.CreditDefaultArgs;

/** El detalle de una ruta: la ruta, sus paradas, lo que quien mira puede hacer y los pedidos que esperan. */
export type RouteDetail = ReturnType<typeof serializeRoute> & { capabilities: RouteCapabilities; pendingRequests: number };

/** La fecha de ruta como el ancla UTC con que se guarda la columna `DATE`. */
const dayAnchor = (day: string): Date => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly crypto: CryptoService,
    private readonly osrm: OsrmService,
    private readonly clock: TenantClockService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private get actor() {
    return { userId: this.tenant.userId, can: (p: string) => this.tenant.can(p) };
  }

  /** Adjunta a cada parada los datos de su crédito (`creditInfo`): la parada guarda `credit_id` sin relación. */
  private async withCredits<S extends { creditId: string | null }>(tx: PrismaClient, stops: S[]) {
    const ids = [...new Set(stops.map((s) => s.creditId).filter((id): id is string => !!id))];
    const rows = ids.length ? await tx.credit.findMany({ where: { id: { in: ids } }, ...STOP_CREDIT }) : [];
    const byId = new Map(rows.map((c) => [c.id, c]));
    return stops.map((s) => ({ ...s, creditInfo: s.creditId ? (byId.get(s.creditId) ?? null) : null }));
  }

  /**
   * La hora fija de la visita agendada de cada parada (`HH:mm`), si la tiene. **Hora fija = posición fija**: la parada
   * que lleva una visita con hora no se mueve al optimizar (decisión 9). Una visita por franja no tiene hora.
   */
  private async withAgendaTimes<S extends { agendaItemId: string | null }>(tx: PrismaClient, stops: S[]) {
    const ids = [...new Set(stops.map((s) => s.agendaItemId).filter((id): id is string => !!id))];
    const rows = ids.length
      ? await tx.agendaItem.findMany({ where: { id: { in: ids } }, select: { id: true, timeMode: true, scheduledTime: true } })
      : [];
    const byId = new Map(rows.map((a) => [a.id, a.timeMode === 'FIXED' ? a.scheduledTime : null]));
    return stops.map((s) => ({ ...s, scheduledTime: s.agendaItemId ? (byId.get(s.agendaItemId) ?? null) : null }));
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
   * La ruta existe y este usuario la ve: quien administra rutas, cualquiera del tenant; el ejecutor de campo, sólo la
   * suya. Una ruta ajena responde 404 y no 403 — no se filtra que exista. Devuelve también **qué es** quien pide
   * respecto de ella (`roles`): armar y correr la ruta no son lo mismo (ver `route-access.ts`).
   */
  private async access(tx: PrismaClient, routeId: string, action = 'modificar la ruta') {
    const route = await tx.routePlan.findFirst({ where: { id: routeId } });
    if (!route) throw resourceNotFound();
    const roles = routeRoles(this.actor, route);
    if (!roles.manager) {
      if (!this.tenant.can(Permission.ROUTE_EXECUTE)) throw routeForbidden(action);
      if (!roles.isCollector) throw resourceNotFound();
    }
    return { route, roles };
  }

  /**
   * Quién es quien pide respecto de una ruta (ya con el alcance validado). Lo usan los pedidos de cambio, que viven en
   * otro servicio pero aplican las mismas reglas.
   */
  async contextOf(routeId: string) {
    const { route, roles } = await this.tx((tx) => this.access(tx, routeId, 'pedir cambios en la ruta'));
    return { route, roles };
  }

  /** Armar la ruta (agregar, quitar, mover) es de quien la creó; el resto la pide. */
  private requireManage(roles: RouteRoles, kind: 'ADD_STOP' | 'REMOVE_STOP' | 'REORDER' | 'CANCEL'): void {
    if (!roles.canManage) throw changeRequestRequired(kind);
  }

  /** Una ruta cerrada es historia: sus paradas no se tocan. */
  private requireOpen(status: RouteStatus): void {
    if (!routeIsOpen(status as unknown as SharedRouteStatus)) throw routeClosed();
  }

  /**
   * `YYYY-MM-DD` ya validado por el DTO. Se cierra la puerta al pasado **y** a lo muy lejano, con el día **de la empresa**:
   * hoy ≤ día ≤ hoy + ROUTE_MAX_DAYS_AHEAD (D-6). Planificar una ruta futura no es lo mismo que operar la jornada: esta es
   * la única regla de fecha, y modificar una ruta ya armada no pasa por acá.
   */
  private async assertPlannable(day: string): Promise<void> {
    const today = await this.clock.today();
    if (dayAnchor(day) < today) throw routePastDate();
    const last = new Date(today.getTime() + ROUTE_MAX_DAYS_AHEAD * 86_400_000);
    if (dayAnchor(day) > last) throw routeTooFar(ROUTE_MAX_DAYS_AHEAD);
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

  /**
   * La ruta que ya tiene ese cobrador ese día, si la hay.
   *
   * 🔴 La base lo garantiza con un `unique`, pero la comprobación previa existe igual: sin ella el
   * choque sale como un P2002 de Prisma —un 500 sin explicación— en vez de decirle al cobrador que
   * su ruta de hoy ya está armada. El `unique` es la red; esto es el mensaje.
   */
  private async routeOfDay(tx: PrismaClient, collectorId: string, plannedDate: Date) {
    return tx.routePlan.findFirst({
      where: { accountId: this.tenant.accountId, collectorId, plannedDate },
      select: { id: true },
    });
  }

  /**
   * Reintento de la cola offline: la ruta ya entró con ese `id`. Se devuelve la guardada (antes de la guarda de
   * «ya hay ruta ese día», que si no tomaría el reintento por un duplicado). Un id que es de otro cobrador es un
   * conflicto, no una ruta nueva.
   */
  private async existingById(tx: PrismaClient, id: string | undefined, collectorId: string) {
    if (!id) return null;
    const prev = await tx.routePlan.findFirst({ where: { id }, include: { stops: { orderBy: { sequenceOrder: 'asc' } } } });
    if (!prev) return null;
    if (prev.collectorId !== collectorId) throw routeIdTaken();
    return prev;
  }

  /** Aviso a la otra persona (la ruta es suya y la tocó alguien más). Un fallo del aviso nunca tumba la operación. */
  private notice(p: Omit<RouteNoticePayload, 'accountId' | 'actorId'>): void {
    if (!this.tenant.userId || p.recipientId === this.tenant.userId) return;
    this.events.emit(DomainEvent.ROUTE_NOTICE, { ...p, accountId: this.tenant.accountId, actorId: this.tenant.userId } satisfies RouteNoticePayload);
  }

  /** Mismo modelo de capacidades que `generate`: el ejecutor de campo sólo crea rutas para sí mismo. */
  async create(dto: CreateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const collectorId = this.collectorFor(dto.collectorId, 'crear rutas');
    const prev = await this.tx((tx) => this.existingById(tx, dto.id, collectorId));
    if (!prev) await this.assertPlannable(dto.plannedDate);
    // Dos envíos con el mismo id a la vez pasan los dos el chequeo y uno choca con la PK: se repite UNA vez.
    const { route, replay } = await this.createOnce(dto, collectorId).catch((err: unknown) =>
      dto.id && isUniqueViolation(err) ? this.createOnce(dto, collectorId) : Promise.reject(err),
    );
    if (!replay) {
      await this.audit.record({ entity: 'route', entityId: route.id, action: 'CREATE', after: { collectorId: route.collectorId } });
      this.notice({ kind: 'ASSIGNED', routeId: route.id, recipientId: route.collectorId, plannedDate: dto.plannedDate });
    }
    return serializeRoute(route);
  }

  private createOnce(dto: CreateRouteDto, collectorId: string) {
    return this.tx(async (tx) => {
      const prev = await this.existingById(tx, dto.id, collectorId);
      if (prev) return { route: prev, replay: true };
      await this.assertCollector(tx, collectorId);
      const already = await this.routeOfDay(tx, collectorId, dayAnchor(dto.plannedDate));
      if (already) throw routeAlreadyForDay(already.id);
      const created = await tx.routePlan.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          accountId: this.tenant.accountId,
          collectorId,
          createdBy: this.tenant.userId,
          branchId: dto.branchId,
          plannedDate: dayAnchor(dto.plannedDate),
          status: RouteStatus.PLANNED,
        },
      });
      return { route: created, replay: false };
    });
  }

  /**
   * Genera la ruta desde los créditos (elegidos, o los del cobrador en mora). Mismo modelo de capacidades que `list`:
   *  - ROUTE_ASSIGN (supervisor): la genera para el cobrador que pida.
   *  - ejecutor de campo (ROUTE_EXECUTE sin ASSIGN): **sólo la suya** — es el camino de RT-0a,
   *    donde el cobrador arma su propia jornada; el `collectorId` del body se ignora.
   *  - observador de cuenta (ni ejecuta ni asigna): no genera nada.
   */
  async generate(dto: GenerateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const collectorId = this.collectorFor(dto.collectorId, 'generar rutas');
    const prev = await this.tx((tx) => this.existingById(tx, dto.id, collectorId));
    if (!prev) await this.assertPlannable(dto.plannedDate);
    const { route, replay } = await this.generateOnce(dto, collectorId).catch((err: unknown) =>
      dto.id && isUniqueViolation(err) ? this.generateOnce(dto, collectorId) : Promise.reject(err),
    );
    // Un reintento no vuelve a auditar ni a crear paradas: devuelve la ruta que ya está.
    if (!replay) {
      await this.audit.record({ entity: 'route', entityId: route.id, action: 'GENERATE', after: { collectorId: route.collectorId, totalStops: route.totalCases } });
      this.notice({ kind: 'ASSIGNED', routeId: route.id, recipientId: route.collectorId, plannedDate: dto.plannedDate, stops: route.totalCases });
    }
    return serializeRoute(route);
  }

  private generateOnce(dto: GenerateRouteDto, collectorId: string) {
    return this.tx(async (tx) => {
      const prev = await this.existingById(tx, dto.id, collectorId);
      if (prev) return { route: prev, replay: true };
      await this.assertCollector(tx, collectorId);
      const plannedDate = dayAnchor(dto.plannedDate);
      const already = await this.routeOfDay(tx, collectorId, plannedDate);
      if (already) throw routeAlreadyForDay(already.id);

      /*
       * Las paradas son por CRÉDITO (F4/08).
       *
       * 🔴 **Con `creditIds`, manda el orden en que vinieron** (el recorrido que alguien armó mirando el mapa),
       * sin repetidos y sólo con los créditos que quien planifica puede ver (el mismo alcance que la ficha de
       * mora). Sin `creditIds`, se toman los créditos EN MORA del cobrador
       * —responsable, temporal o apoyo vigentes— por la prioridad de su episodio abierto.
       */
      const base = dto.creditIds?.length
        ? await this.chosenCredits(tx, dto.creditIds)
        : await this.collectorArrearsCredits(tx, collectorId);
      /*
       * 🔴 Las visitas agendadas de ese cobrador para ese día ENTRAN SOLAS a la planificación (F4/11 · D3): quien arma la
       * ruta no tiene que acordarse de elegirlas. Con créditos elegidos manda el orden que armó quien planifica y las
       * visitas van al final; sin elección, van primero (son compromisos con día) y luego la mora por prioridad. Si el
       * crédito ya iba por mora, es UNA sola parada y lleva el vínculo con la visita.
       */
      const visits = await this.pendingVisits(tx, collectorId, plannedDate);
      const credits = this.mergeVisits(base, visits, dto.creditIds?.length ? 'append' : 'prepend');
      if (credits.length === 0) throw noStopsToRoute();

      // La ubicación concreta de cada parada (F4/12): la elegida, o la principal del cliente.
      const locationOf = await this.resolveLocations(tx, credits, dto.locations ?? {}, dto.requirePoints === true);

      const created = await tx.routePlan.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          accountId: this.tenant.accountId,
          collectorId,
          createdBy: this.tenant.userId,
          branchId: dto.branchId,
          plannedDate,
          status: RouteStatus.PLANNED,
          totalCases: credits.length, // nombre legado de la columna: cuenta paradas
          stops: {
            create: credits.map((c, i) => ({
              accountId: this.tenant.accountId,
              clientId: c.clientId,
              creditId: c.id,
              agendaItemId: c.agendaItemId,
              locationId: locationOf.get(c.id) ?? null,
              // El orden que eligió quien planifica; sin elección, el de prioridad (CRITICAL primero).
              sequenceOrder: i + 1,
            })),
          },
        },
        include: { stops: { orderBy: { sequenceOrder: 'asc' } } },
      });
      return { route: created, replay: false };
    });
  }

  /**
   * La ubicación de cada parada: la que se pidió, o la principal del cliente (HOME propia; si no, la primera propia).
   *
   * - Una ubicación pedida debe ser **del cliente** (propia, o de un garante/familiar suyo) y tener punto en el mapa.
   * - Con `requirePoints`, **cada parada** debe terminar con punto (decisión 6): si no, se devuelve la lista de las que
   *   faltan para que la pantalla las resuelva antes de publicar.
   */
  private async resolveLocations(
    tx: PrismaClient,
    credits: { id: string; clientId: string }[],
    asked: Record<string, string>,
    requirePoints: boolean,
  ): Promise<Map<string, string>> {
    const clientIds = [...new Set(credits.map((c) => c.clientId))];
    const rows = await tx.clientLocation.findMany({
      where: { clientId: { in: clientIds } },
      select: { id: true, clientId: true, locationType: true, relationId: true, latitude: true, longitude: true },
      orderBy: { createdAt: 'asc' },
    });
    const hasPoint = (l: { latitude: unknown; longitude: unknown }) => l.latitude != null && l.longitude != null;
    const byId = new Map(rows.map((l) => [l.id, l]));
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const c of credits) {
      const wanted = asked[c.id];
      if (wanted) {
        const loc = byId.get(wanted);
        if (!loc || loc.clientId !== c.clientId) throw resourceNotFound();
        if (!hasPoint(loc)) {
          missing.push(c.id);
          continue;
        }
        out.set(c.id, loc.id);
        continue;
      }
      const own = rows.filter((l) => l.clientId === c.clientId && !l.relationId);
      const primary = own.find((l) => l.locationType === 'HOME') ?? own[0];
      if (primary) out.set(c.id, primary.id);
      if (requirePoints && !(primary && hasPoint(primary))) missing.push(c.id);
    }
    if (missing.length > 0 && (requirePoints || Object.keys(asked).length > 0)) throw stopsWithoutPoint(missing);
    return out;
  }

  /**
   * Las visitas pendientes del cobrador para ese día que ninguna parada activa lleva ya, por hora (las de franja,
   * después) y luego por orden de carga. Una por crédito: si hay dos del mismo crédito el mismo día, la primera entra y
   * la otra sigue solo en la agenda.
   */
  private async pendingVisits(tx: PrismaClient, collectorId: string, plannedDate: Date): Promise<{ agendaItemId: string; id: string; clientId: string }[]> {
    const items = await tx.agendaItem.findMany({
      where: { assigneeId: collectorId, type: AgendaItemType.VISIT, status: AgendaItemStatus.SCHEDULED, deletedAt: null, scheduledDate: plannedDate },
      orderBy: [{ scheduledTime: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: { id: true, creditId: true, clientId: true },
    });
    if (items.length === 0) return [];
    const taken = await tx.routeStop.findMany({
      where: { agendaItemId: { in: items.map((i) => i.id) }, status: { not: RouteStopStatus.SKIPPED } },
      select: { agendaItemId: true },
    });
    const takenIds = new Set(taken.map((t) => t.agendaItemId));
    const seen = new Set<string>();
    return items.flatMap((i) => {
      if (takenIds.has(i.id) || seen.has(i.creditId)) return [];
      seen.add(i.creditId);
      return [{ agendaItemId: i.id, id: i.creditId, clientId: i.clientId }];
    });
  }

  /** Une los créditos de la ruta con las visitas del día: sin repetir crédito y con el vínculo en la parada que la lleva. */
  private mergeVisits(
    base: { id: string; clientId: string }[],
    visits: { agendaItemId: string; id: string; clientId: string }[],
    where: 'append' | 'prepend',
  ): { id: string; clientId: string; agendaItemId?: string }[] {
    const link = new Map(visits.map((v) => [v.id, v.agendaItemId]));
    const known = new Set(base.map((b) => b.id));
    const withLink = base.map((b) => ({ ...b, agendaItemId: link.get(b.id) }));
    const extra = visits.filter((v) => !known.has(v.id)).map((v) => ({ id: v.id, clientId: v.clientId, agendaItemId: v.agendaItemId }));
    return where === 'append' ? [...withLink, ...extra] : [...extra, ...withLink];
  }

  /** Los créditos elegidos, en el orden pedido, sin repetir y sólo los visibles para quien planifica. */
  private async chosenCredits(tx: PrismaClient, creditIds: string[]): Promise<{ id: string; clientId: string }[]> {
    const wanted = [...new Set(creditIds)];
    const access = Prisma.join([...moraAccessConditions(moraScopeOf(this.tenant)), Prisma.sql`cr.id = ANY(${wanted}::text[])`], ' AND ');
    const rows = await tx.$queryRaw<{ id: string; client_id: string }[]>(Prisma.sql`SELECT cr.id, cr.client_id FROM credits cr WHERE ${access}`);
    const byId = new Map(rows.map((r) => [r.id, { id: r.id, clientId: r.client_id }]));
    // `ANY` no devuelve en el orden del pedido: se reordena acá.
    return wanted.flatMap((id) => byId.get(id) ?? []);
  }

  /**
   * Los créditos en mora (episodio abierto) a cargo del cobrador —principal, temporal o apoyo vigentes—,
   * por la prioridad del episodio (CRITICAL primero) y luego por días de mora. Un crédito castigado no se visita.
   */
  private async collectorArrearsCredits(tx: PrismaClient, collectorId: string): Promise<{ id: string; clientId: string }[]> {
    const own = moraAccessConditions({ accountId: this.tenant.accountId, userId: collectorId, kind: 'OWN', ownOnly: true, canAssign: false });
    const where = Prisma.join([...own, Prisma.sql`cr.written_off_at IS NULL`], ' AND ');
    const rows = await tx.$queryRaw<{ id: string; client_id: string }[]>(Prisma.sql`
      SELECT cr.id, cr.client_id
      FROM credits cr
      JOIN credit_arrear_episodes ep ON ep.credit_id = cr.id AND ep.account_id = cr.account_id AND ep.ended_at IS NULL
      WHERE ${where}
      ORDER BY CASE ep.priority::text WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 END DESC NULLS LAST,
               cr.days_past_due DESC, cr.id ASC`);
    return rows.map((r) => ({ id: r.id, clientId: r.client_id }));
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
    /*
     * El día exacto gana sobre el rango: el teléfono manda `date` y tiene que recibir ese día. El
     * rango es del historial por período del panel, y los dos extremos son inclusivos —
     * `plannedDate` es un día civil, no un instante, así que `lte` con el mismo día lo incluye.
     * `dayAnchor` toma solo `YYYY-MM-DD`: con una hora la igualdad contra la columna `DATE` no coincidía.
     */
    if (query.date) where.plannedDate = dayAnchor(query.date);
    else if (query.from || query.to) {
      where.plannedDate = {
        ...(query.from ? { gte: dayAnchor(query.from) } : {}),
        ...(query.to ? { lte: dayAnchor(query.to) } : {}),
      };
    }

    const dir = query.dir === 'asc' ? 'asc' : 'desc';
    /*
     * El desempate SIEMPRE termina en `id`. Sin él, dos rutas con la misma fecha (que es el caso
     * normal: once cobradores el mismo día) pueden salir en distinto orden en cada consulta, y con
     * `LIMIT/OFFSET` eso hace que una fila aparezca dos veces y otra no aparezca nunca.
     */
    const orderBy: Prisma.RoutePlanOrderByWithRelationInput[] =
      query.sort === 'status' ? [{ status: dir }, { plannedDate: 'desc' }, { id: 'asc' }] : [{ plannedDate: dir }, { id: 'asc' }];

    const [rows, total] =
      query.sort === 'collector'
        ? await this.pageByCollector(where, dir, skip, limit)
        : await this.tx((tx) =>
            Promise.all([
              tx.routePlan.findMany({ where, orderBy, skip, take: limit }),
              tx.routePlan.count({ where }),
            ]),
          );

    /*
     * 🔴 **Cuántas paradas se visitaron, por ruta.** El listado no trae las paradas (traerlas sería
     * una página de cientos de filas anidadas), así que sin esto la pantalla sólo puede mostrar el
     * total planificado: «8» donde debería decir «5 de 8». Es una consulta agregada sobre las rutas
     * de ESTA página, no una por fila.
     */
    const [visited, next, collected] = await Promise.all([
      this.visitedByRoute(rows.map((r) => r.id)),
      this.nextStops(rows.map((r) => r.id)),
      // Lo cobrado solo tiene sentido para UN día: es la vista «Hoy». En el historial por período no se calcula.
      query.date ? this.collectedByCollector(rows.map((r) => r.collectorId), query.date) : Promise.resolve(new Map<string, number>()),
    ]);
    return ResponseDto.paginated(
      rows.map((r) => ({
        ...serializeRoute(r),
        visitedCount: visited.get(r.id) ?? 0,
        ...(query.date ? { nextStop: next.get(r.id), collected: collected.get(r.collectorId) ?? 0 } : {}),
      })),
      total,
      page,
      limit,
    );
  }

  /**
   * La página ordenada **por el nombre del cobrador**.
   *
   * 🔴 Ordenar por `collector_id` sería ordenar por uuid: agrupa a cada persona, sí, pero el orden
   * entre personas es azar puro y la flecha diría «alfabético» sobre algo que no lo es. El nombre
   * vive en `profiles`, y `route_plans.collector_id` es **ref suave a propósito** (sin FK), así que
   * Prisma no puede ordenar por la relación: no la hay.
   *
   * Por eso se resuelve en dos pasos —traer las rutas que caen en el filtro, ordenarlas por nombre y
   * recién ahí cortar la página—, y **sólo cuando piden este orden**. El resto sigue ordenando en la
   * base como siempre.
   *
   * ponytail: trae los ids de todo el filtro (no las filas: id + cobrador). Con la cartera más
   * grande que hay hoy son unos cientos de pares por período. Si un día un tenant tiene años de
   * rutas en un rango, esto pasa a ser SQL crudo con `JOIN profiles` y `ORDER BY last_name`.
   */
  private async pageByCollector(
    where: Prisma.RoutePlanWhereInput,
    dir: 'asc' | 'desc',
    skip: number,
    limit: number,
  ): Promise<[Awaited<ReturnType<PrismaClient['routePlan']['findMany']>>, number]> {
    return this.tx(async (tx) => {
      const all = await tx.routePlan.findMany({
        where,
        select: { id: true, collectorId: true, plannedDate: true },
        orderBy: [{ plannedDate: 'desc' }, { id: 'asc' }],
      });

      const names = new Map<string, string>();
      const profiles = await tx.profile.findMany({
        where: { userId: { in: [...new Set(all.map((r) => r.collectorId))] } },
        select: { userId: true, firstName: true, lastName: true },
      });
      // Por apellido y después por nombre, que es como se lista gente. En minúsculas y sin acentos
      // para que «Édgar» no caiga después de «Zeballos».
      for (const p of profiles) names.set(p.userId, key(`${p.lastName ?? ''} ${p.firstName ?? ''}`));

      const sorted = [...all].sort((a, b) => {
        // Quien no tiene perfil va al final en los dos sentidos: no es «el primero alfabéticamente»,
        // es que no se sabe cómo se llama.
        const na = names.get(a.collectorId);
        const nb = names.get(b.collectorId);
        if (na === undefined || nb === undefined) return na === nb ? 0 : na === undefined ? 1 : -1;
        const cmp = na.localeCompare(nb);
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
        // Mismo cobrador: sus rutas quedan en orden de fecha, de la más nueva a la más vieja.
        return b.plannedDate.getTime() - a.plannedDate.getTime() || a.id.localeCompare(b.id);
      });

      const ids = sorted.slice(skip, skip + limit).map((r) => r.id);
      const rows = await tx.routePlan.findMany({ where: { id: { in: ids } } });
      // `findMany` con `in` no respeta el orden de la lista: se reordena con el que se calculó.
      const byId = new Map(rows.map((r) => [r.id, r]));
      return [ids.flatMap((id) => byId.get(id) ?? []), all.length];
    });
  }

  /** Paradas ya visitadas de cada ruta. Sin rutas no consulta nada. */
  private async visitedByRoute(routeIds: string[]): Promise<Map<string, number>> {
    if (routeIds.length === 0) return new Map();
    const grouped = await this.tx((tx) =>
      tx.routeStop.groupBy({
        by: ['routeId'],
        where: { routeId: { in: routeIds }, status: RouteStopStatus.VISITED },
        _count: { _all: true },
      }),
    );
    return new Map(grouped.map((g) => [g.routeId, g._count._all]));
  }

  /**
   * La primera parada sin gestionar de cada ruta de la página, con el nombre del cliente (vista «Hoy»).
   * Una consulta para toda la página; el nombre es el del deudor, no una dirección: no se audita como revelado.
   */
  private async nextStops(routeIds: string[]): Promise<Map<string, { id: string; sequenceOrder: number; clientName?: string }>> {
    if (routeIds.length === 0) return new Map();
    const stops = await this.tx((tx) =>
      tx.routeStop.findMany({
        where: { routeId: { in: routeIds }, status: { in: [RouteStopStatus.PENDING, RouteStopStatus.IN_ROUTE] } },
        orderBy: [{ routeId: 'asc' }, { sequenceOrder: 'asc' }],
        select: { id: true, routeId: true, sequenceOrder: true, client: { select: { firstName: true, lastName: true, businessName: true } } },
      }),
    );
    const out = new Map<string, { id: string; sequenceOrder: number; clientName?: string }>();
    for (const s of stops) {
      if (!out.has(s.routeId)) out.set(s.routeId, { id: s.id, sequenceOrder: s.sequenceOrder, clientName: clientDisplayName(s.client) });
    }
    return out;
  }

  /**
   * Lo cobrado por cada cobrador en el día civil **de la empresa** (la misma cuenta que hace el móvil con
   * `listPaymentsByDay`). Una consulta agrupada para toda la página.
   */
  private async collectedByCollector(collectorIds: string[], day: string): Promise<Map<string, number>> {
    const ids = [...new Set(collectorIds)];
    if (ids.length === 0) return new Map();
    const tz = await this.clock.timezone();
    const from = civilDayStartInstant(day.slice(0, 10), tz);
    const to = civilDayStartInstant(new Date(dayAnchor(day).getTime() + 86_400_000).toISOString().slice(0, 10), tz);
    const grouped = await this.tx((tx) =>
      tx.payment.groupBy({
        by: ['registeredBy'],
        where: { registeredBy: { in: ids }, paymentDate: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
    );
    return new Map(grouped.flatMap((g) => (g.registeredBy ? [[g.registeredBy, Number(g._sum.amount ?? 0)] as const] : [])));
  }

  /**
   * Detalle con paradas. Cada parada trae el nombre del deudor y su dirección **en claro**: sin eso
   * la lista dice `Cliente a1b2c3…` y el cobrador no sabe adónde ir. Se audita el revelado, igual que
   * la agenda: es la única puerta por la que el cobrador ve direcciones sin `client:pii:read`.
   *
   * Trae además **qué puede hacer quien mira** (`capabilities`) y cuántos pedidos de cambio esperan, para que la
   * pantalla no adivine qué botones mostrar.
   */
  async findOne(id: string, opts: { audit?: boolean } = {}): Promise<RouteDetail> {
    const loaded = await this.tx(async (tx) => {
      const r = await tx.routePlan.findFirst({
        where: { id },
        include: { stops: { orderBy: { sequenceOrder: 'asc' }, include: { client: STOP_CLIENT, visits: STOP_VISIT } } },
      });
      if (!r) return null;
      const stops = await this.withAgendaTimes(tx, await this.withCredits(tx, r.stops));
      const [visitCount, pending] = await Promise.all([
        tx.fieldVisit.count({ where: { routeStop: { routeId: id } } }),
        tx.routeChangeRequest.count({ where: { routeId: id, status: 'PENDING' } }),
      ]);
      return { route: { ...r, stops }, visitCount, pending };
    });
    if (!loaded) throw resourceNotFound();
    const { route } = loaded;
    // Mismo scope que el listado: un cobrador solo accede a su propia ruta, pero un auditor a cualquiera.
    if (this.scopedToOwnRoutes() && route.collectorId !== this.tenant.userId) {
      throw resourceNotFound();
    }
    if (route.stops.length > 0 && opts.audit !== false) {
      await this.audit.record({ entity: 'route', entityId: id, action: 'PII_REVEAL' });
    }
    const capabilities = routeCapabilities(this.actor, {
      collectorId: route.collectorId,
      createdBy: route.createdBy,
      status: route.status,
      hasVisits: loaded.visitCount > 0,
    });
    return {
      ...serializeRoute(route, this.crypto),
      capabilities,
      // Los pedidos los resuelve quien arma la ruta: a los demás no les sirve el número.
      pendingRequests: capabilities.isOwner ? loaded.pending : 0,
    };
  }

  /**
   * La ruta más lo que el PDF necesita alrededor: la empresa que emite y el nombre del cobrador
   * (el serializer sólo trae su id, porque `collectorId` es ref suave a `users`).
   */
  async pdfBundle(id: string): Promise<{ route: RouteDetail } & RoutePdfContext> {
    const route = await this.findOne(id);
    const [account, profile] = await this.tx((tx) =>
      Promise.all([
        tx.account.findUnique({ where: { id: this.tenant.accountId }, select: { businessName: true, currencyCode: true } }),
        tx.profile.findUnique({ where: { userId: route.collectorId }, select: { firstName: true, lastName: true } }),
      ]),
    );
    return {
      route,
      accountName: account?.businessName ?? 'Kobrax',
      currency: account?.currencyCode ?? undefined,
      collectorName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : undefined,
    };
  }

  /**
   * Cambia el estado de la ruta, **con la máquina de estados** (F4/12): la API es la autoridad.
   *
   *  - PLANIFICADA → EN CURSO | CANCELADA; EN CURSO → COMPLETADA | CANCELADA. Completada y cancelada son finales.
   *  - Pedir el estado en que ya está es un reintento (la cola offline): se devuelve tal cual, sin repetir el evento.
   *  - **Completar** con paradas sin gestionar exige el motivo; esas paradas pasan a SALTADAS y su visita agendada
   *    queda libre para volver a planificarse.
   *  - **Cancelar** exige el motivo y no se puede con visitas registradas (esa información no se borra: se completa).
   *  - Quien no es el cobrador ni armó la ruta debe dejar el motivo siempre; y cancelar, para él, es un pedido.
   *  - El cambio es condicional (`WHERE status = <el que se leyó>`): dos personas a la vez no se pisan.
   */
  async updateStatus(id: string, dto: UpdateRouteDto): Promise<ReturnType<typeof serializeRoute>> {
    const reason = dto.reason?.trim();
    // Lo que dijo el cliente de su versión: solo decide la compatibilidad de la regla de abajo, no un permiso.
    const appVersion = this.tenant.get()?.appVersion;
    const outcome = await this.tx(async (tx) => {
      const { route, roles } = await this.access(tx, id);
      if (dto.status === route.status) return { route, changed: false as const };

      const from = route.status as unknown as SharedRouteStatus;
      const to = dto.status as unknown as SharedRouteStatus;
      if (!canTransitionRoute(from, to)) throw routeTransition(route.status, dto.status);

      const stops = await tx.routeStop.findMany({ where: { routeId: id }, select: { id: true, status: true } });
      const open = stops.filter((s) => isOpenStop(s.status as unknown as SharedStopStatus));
      const hasVisits = (await tx.fieldVisit.count({ where: { routeStop: { routeId: id } } })) > 0;
      const now = new Date();
      let data: Prisma.RoutePlanUpdateManyMutationInput = {};
      let skipOpen = false;
      let legacyCompat: LegacyClientReason | undefined;

      if (dto.status === RouteStatus.IN_PROGRESS) {
        if (!roles.canRun && !roles.manager) throw routeForbidden('iniciar la ruta');
        if (!roles.canRun && !isValidReason(reason)) throw reasonRequired('de iniciar una ruta ajena');
        data = { startedAt: now, ...(reason && !roles.canRun ? { statusReason: reason } : {}) };
      } else if (dto.status === RouteStatus.COMPLETED) {
        if (!roles.canRun && !roles.manager) throw routeForbidden('completar la ruta');
        /*
         * D-5 · opción C: la tolerancia a «el cobrador cierra SU ruta sin motivo» es **solo para versiones viejas de la app**
         * (< ROUTE_CLOSE_REASON_MIN_APP_VERSION, o sin versión legible). La app nueva manda el motivo y aquí se le exige.
         * Un manager o una ruta ajena nunca tuvo tolerancia.
         */
        const compat = roles.isCollector && !roles.manager ? legacyClientReason(appVersion, ROUTE_CLOSE_REASON_MIN_APP_VERSION) : null;
        const need = (open.length > 0 && compat === null) || !roles.canRun;
        if (need && !isValidReason(reason)) throw reasonRequired(open.length > 0 ? 'por el que quedaron paradas sin gestionar' : 'de completar una ruta ajena');
        if (compat && open.length > 0 && !isValidReason(reason)) legacyCompat = compat;
        skipOpen = open.length > 0;
        data = { completedAt: now, statusReason: reason ?? (skipOpen ? 'Cerrada con paradas sin gestionar.' : null) };
      } else if (dto.status === RouteStatus.CANCELLED) {
        // Cancelar es de quien anda o arma la ruta; el resto lo pide.
        if (!roles.canRun) throw changeRequestRequired('CANCEL');
        if (hasVisits) throw routeHasVisits();
        if (!isValidReason(reason)) throw reasonRequired('de la cancelación');
        skipOpen = true;
        data = { cancelledAt: now, statusReason: reason };
      }

      const res = await tx.routePlan.updateMany({ where: { id, status: route.status }, data: { status: dto.status, ...data } });
      if (res.count === 0) throw routeStateChanged();
      if (skipOpen && open.length > 0) {
        // SALTADA libera la visita agendada (el único parcial excluye SKIPPED) y deja el vínculo como historia.
        await tx.routeStop.updateMany({ where: { id: { in: open.map((s) => s.id) } }, data: { status: RouteStopStatus.SKIPPED } });
      }
      const updated = await tx.routePlan.findFirstOrThrow({ where: { id } });
      return { route: updated, previous: route, changed: true as const, skipped: skipOpen ? open.length : 0, reason, legacyCompat };
    });

    if (!outcome.changed) return serializeRoute(outcome.route);
    const { route, skipped } = outcome;
    await this.audit.record({
      entity: 'route',
      entityId: id,
      action: 'UPDATE',
      before: { status: outcome.previous.status },
      after: {
        status: route.status,
        ...(skipped ? { skippedStops: skipped } : {}),
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        // Se cerró sin motivo por tolerancia a un cliente viejo: con esto se mide cuándo se puede retirar (D-5 · B).
        ...(outcome.legacyCompat ? { legacyCompat: outcome.legacyCompat, appVersion: appVersion ?? null } : {}),
      },
    });
    if (route.status === RouteStatus.COMPLETED) {
      this.events.emit(DomainEvent.ROUTE_COMPLETED, { routeId: id, collectorId: route.collectorId, accountId: this.tenant.accountId });
    }
    if (route.status === RouteStatus.CANCELLED) {
      this.notice({ kind: 'CANCELLED', routeId: id, recipientId: route.collectorId, plannedDate: route.plannedDate.toISOString().slice(0, 10), reason: outcome.reason });
      if (route.createdBy && route.createdBy !== route.collectorId) {
        this.notice({ kind: 'CANCELLED', routeId: id, recipientId: route.createdBy, plannedDate: route.plannedDate.toISOString().slice(0, 10), reason: outcome.reason });
      }
    }
    return serializeRoute(route);
  }

  /**
   * Agrega una parada al final del recorrido (S2: cada toque en el mapa). El `sequenceOrder` se
   * calcula **dentro de la transacción** porque dos toques seguidos chocarían contra
   * `unique(routeId, sequenceOrder)`.
   *
   * F4/12: solo en una ruta abierta, y solo quien la armó; la ubicación concreta es opcional y, si se manda, debe ser
   * del cliente y tener punto. Sin ella se guarda la principal del cliente.
   */
  async addStop(routeId: string, dto: AddStopDto) {
    const stop = await this.tx(async (tx) => {
      const { route, roles } = await this.access(tx, routeId);
      this.requireManage(roles, 'ADD_STOP');
      this.requireOpen(route.status);
      // Que el cliente y el caso sean de ESTE tenant. La RLS no alcanza sola: el chequeo de la FK
      // lo hace Postgres por dentro, saltándola, así que un id ajeno entraba igual y dejaba una
      // parada apuntando a la cartera de otro. Mismo criterio que `FieldService.createVisit`.
      const client = await tx.client.findFirst({ where: { id: dto.clientId, deletedAt: null }, select: { id: true } });
      if (!client) throw resourceNotFound();
      // La parada se liga al crédito (que debe ser del cliente y estar a la vista).
      if (dto.creditId) {
        const [found] = await visibleCredits(tx, moraScopeOf(this.tenant), { creditId: dto.creditId, clientId: dto.clientId });
        if (!found) throw resourceNotFound();
        const dup = await tx.routeStop.findFirst({ where: { routeId, creditId: dto.creditId }, select: { id: true } });
        if (dup) throw stopDuplicate();
      }
      const locationOf = await this.resolveLocations(
        tx,
        [{ id: dto.creditId ?? dto.clientId, clientId: dto.clientId }],
        dto.locationId ? { [dto.creditId ?? dto.clientId]: dto.locationId } : {},
        false,
      );
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
          creditId: dto.creditId,
          locationId: locationOf.get(dto.creditId ?? dto.clientId) ?? null,
          sequenceOrder: (last?.sequenceOrder ?? 0) + 1,
        },
        include: { client: STOP_CLIENT, visits: STOP_VISIT },
      });
      // El total sale de las paradas, no de un contador que se desfase.
      await tx.routePlan.update({ where: { id: routeId }, data: { totalCases: await tx.routeStop.count({ where: { routeId } }) } });
      const [withCredit] = await this.withAgendaTimes(tx, await this.withCredits(tx, [created]));
      return withCredit!;
    });
    await this.audit.record({ entity: 'route_stop', entityId: stop.id, action: 'CREATE', after: { routeId, clientId: stop.clientId, locationId: stop.locationId } });
    return serializeStop(stop, this.crypto);
  }

  /**
   * Saca una parada del recorrido. Es un borrado real: la parada agregada por error nunca estuvo en
   * la jornada (distinto de `SKIPPED`, que es "fui y no la hice"). Las que siguen se corren para que
   * la secuencia no quede con agujeros — el número es la posición que ve el cobrador.
   */
  async removeStop(routeId: string, stopId: string): Promise<void> {
    await this.tx(async (tx) => {
      const { route, roles } = await this.access(tx, routeId);
      this.requireManage(roles, 'REMOVE_STOP');
      this.requireOpen(route.status);
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
   * Cambia el estado de una parada y/o la mueve de posición (S2). Mover **reordena la lista
   * entera**: escribir el número a secas chocaría con `unique(routeId, sequenceOrder)`.
   *
   * F4/12: el estado sigue la tabla `STOP_TRANSITIONS` — **no se pasa a VISITADA a secas** (se registra la visita) ni se
   * vuelve atrás de visitada/saltada — y todo cambio queda auditado.
   */
  async updateStop(routeId: string, stopId: string, dto: UpdateStopDto) {
    const { stop, before } = await this.tx(async (tx) => {
      const { route, roles } = await this.access(tx, routeId);
      this.requireOpen(route.status);
      const found = await tx.routeStop.findFirst({ where: { id: stopId, routeId } });
      if (!found) throw resourceNotFound();
      const prevStatus = found.status;
      // Antes de escribir: lo que se audita es de dónde venía, no a dónde llegó.
      const prevLocationId = found.locationId;

      const moves = dto.sequenceOrder != null && dto.sequenceOrder !== found.sequenceOrder;
      const changes = dto.status != null && dto.status !== found.status;
      const relocates = dto.locationId != null && dto.locationId !== found.locationId;
      if (moves) this.requireManage(roles, 'REORDER');
      /*
       * Cambiar a qué puerta se va es **armar** la ruta, no operarla: lo hace quien la armó. Solo una parada pendiente — la
       * gestionada es la jornada que ya pasó, y su visita quedó registrada en ese lugar.
       */
      if (relocates) {
        if (!roles.canManage) throw routeForbidden('cambiar la dirección de la parada');
        if (found.status !== RouteStopStatus.PENDING) throw stopNotPending();
      }
      // Saltar o poner «en camino» es operar la jornada, no armarla: lo hace quien la anda.
      if (changes && !roles.canRun && !roles.canManage) throw routeForbidden('cambiar la parada');

      if (moves) {
        if (found.status !== RouteStopStatus.PENDING) throw stopNotPending();
        const all = await tx.routeStop.findMany({ where: { routeId }, orderBy: { sequenceOrder: 'asc' }, select: { id: true } });
        const ids = all.map((s) => s.id).filter((id) => id !== stopId);
        // La posición pedida se acota al largo real: el móvil no tiene por qué conocerlo.
        const target = Math.min(Math.max(dto.sequenceOrder!, 1), ids.length + 1);
        ids.splice(target - 1, 0, stopId);
        await this.resequence(tx, ids);
      }

      if (relocates) {
        // Debe ser del cliente de la parada y tener punto en el mapa: sin él no hay recorrido que dibujar.
        const locationOf = await this.resolveLocations(
          tx,
          [{ id: found.creditId ?? found.clientId, clientId: found.clientId }],
          { [found.creditId ?? found.clientId]: dto.locationId! },
          false,
        );
        await tx.routeStop.update({ where: { id: stopId }, data: { locationId: locationOf.get(found.creditId ?? found.clientId) ?? null } });
      }

      if (changes) {
        if (!canTransitionStop(found.status as unknown as SharedStopStatus, dto.status as unknown as SharedStopStatus)) {
          throw stopStatusNotAllowed(found.status, dto.status!);
        }
        await tx.routeStop.update({ where: { id: stopId }, data: { status: dto.status } });
      }
      return {
        stop: await tx.routeStop.findFirstOrThrow({ where: { id: stopId } }),
        before: { status: prevStatus, locationId: prevLocationId },
      };
    });
    if (dto.status && dto.status !== before.status) {
      await this.audit.record({ entity: 'route_stop', entityId: stopId, action: 'UPDATE', before: { status: before.status }, after: { status: stop.status, routeId } });
    }
    if (dto.locationId && dto.locationId !== before.locationId) {
      await this.audit.record({
        entity: 'route_stop',
        entityId: stopId,
        action: 'UPDATE',
        before: { locationId: before.locationId },
        after: { locationId: stop.locationId, routeId },
      });
    }
    return { id: stop.id, status: stop.status, sequenceOrder: stop.sequenceOrder, locationId: stop.locationId ?? undefined };
  }

  // ── Vista previa y optimización (S3) ─────────────────────────────────────

  /**
   * El recorrido dibujado por las calles, con cuánto se camina y cuánto lleva, y —si da vueltas de
   * más— en qué orden convendría hacerlo.
   *
   * **Se degrada, no falla.** Sin OSRM (caído, o sin red desde el server) devuelve la ruta sin
   * geometría y con los últimos números calculados: el cobrador igual puede confirmar e iniciar.
   *
   * ponytail: un GET que escribe su propio cache (`totalDistanceKm`/`estimatedMinutes`, columnas que
   * ya existían sin llenarse). Es lo que le deja números reales al camino sin señal; la alternativa
   * —que el móvil los mande al confirmar— pone en manos del cliente un dato que calculó el server.
   * F4/12: ya **no escribe si el valor no cambió** ni en una ruta cerrada.
   */
  async preview(routeId: string, opts: { audit?: boolean } = {}): Promise<RoutePreview> {
    const route = await this.tx(async (tx) => {
      await this.access(tx, routeId);
      const r = await tx.routePlan.findFirst({
        where: { id: routeId },
        include: { stops: { orderBy: { sequenceOrder: 'asc' }, include: { client: STOP_CLIENT, visits: STOP_VISIT } } },
      });
      return r && { ...r, stops: await this.withAgendaTimes(tx, await this.withCredits(tx, r.stops)) };
    });
    if (!route) throw resourceNotFound();
    if (route.stops.length > 0 && opts.audit !== false) {
      // Devuelve direcciones y coordenadas en claro, igual que `findOne`: se audita el revelado.
      await this.audit.record({ entity: 'route', entityId: routeId, action: 'PII_REVEAL' });
    }

    const stops = route.stops.map((s) => serializeStop(s, this.crypto));
    const drawable = stops.filter(hasPoint);
    // En paralelo y no en serie: son dos llamadas independientes de 5 s de timeout cada una, y
    // encadenadas dejaban la pantalla colgada hasta 10 s con OSRM lento. `trip` sólo necesita los
    // puntos; la comparación contra el recorrido actual se hace acá abajo, con los dos resueltos.
    const [path, best] = await Promise.all([
      this.osrm.route(drawable),
      drawable.length >= 3 ? this.osrm.trip(drawable) : Promise.resolve(null),
    ]);

    if (!path) {
      // Sin motor: la última distancia/duración conocidas, y que el móvil una los puntos con rectas.
      return {
        geometry: [],
        distanceKm: route.totalDistanceKm != null ? Number(route.totalDistanceKm) : undefined,
        minutes: route.estimatedMinutes ?? undefined,
        stops: stops.map((s) => ({ id: s.id, sequenceOrder: s.sequenceOrder, etaMinutes: undefined, scheduledTime: s.scheduledTime })),
      };
    }

    const distanceKm = round1(path.distanceM / 1000);
    // La permanencia cuenta solo las paradas que faltan: las ya gestionadas son pasado.
    const pendingStops = stops.filter((s) => isOpenStop(s.status as unknown as SharedStopStatus)).length;
    const minutes = Math.round(path.durationS / 60) + DWELL_MIN * pendingStops;
    const changed = Number(route.totalDistanceKm ?? NaN) !== distanceKm || route.estimatedMinutes !== minutes;
    if (changed && routeIsOpen(route.status as unknown as SharedRouteStatus)) {
      await this.tx((tx) =>
        tx.routePlan.update({ where: { id: routeId }, data: { totalDistanceKm: distanceKm, estimatedMinutes: minutes } }),
      );
    }

    return {
      geometry: path.geometry,
      distanceKm,
      minutes,
      stops: withEta(stops, drawable, path.legs),
      suggestion: this.suggestOrder(drawable, path, best),
    };
  }

  /**
   * El camino entre dos puntos, por las calles: lo que pide el botón «dónde estoy» de los mapas para decir cuánto falta
   * hasta una parada. Sin permanencia (no es un recorrido, es un tramo) y sin datos personales.
   *
   * Sin motor de ruteo devuelve `null`: el mapa sigue mostrando la ubicación, solo que sin camino.
   */
  async leg(dto: LegDto): Promise<{ geometry: { latitude: number; longitude: number }[]; distanceKm: number; minutes: number } | null> {
    if (!this.tenant.can(Permission.ROUTE_ASSIGN) && !this.tenant.can(Permission.ROUTE_WRITE) && !this.tenant.can(Permission.ROUTE_EXECUTE)) {
      throw routeForbidden('calcular un camino');
    }
    const path = await this.osrm.route([dto.from, dto.to]);
    if (!path) return null;
    return { geometry: path.geometry, distanceKm: round1(path.distanceM / 1000), minutes: Math.max(1, Math.round(path.durationS / 60)) };
  }

  /**
   * La vista previa de una ruta **que todavía no existe** (F4/12 · planificador del panel): recibe los puntos en el orden
   * en que se piensa recorrer y devuelve lo mismo que `preview` — recorrido, distancia, duración, hora de llegada a cada
   * parada y, si da vueltas de más, el orden sugerido —, **sin guardar nada**. Es lo que deja revisar antes de publicar
   * sin crear una ruta a medias que el cobrador vería.
   *
   * Sin datos personales: llegan puntos y ids que quien pregunta ya conoce, y no sale ninguna dirección ni nombre.
   */
  async previewPoints(dto: PlanPreviewDto): Promise<RoutePreview> {
    if (!this.tenant.can(Permission.ROUTE_ASSIGN) && !this.tenant.can(Permission.ROUTE_WRITE) && !this.tenant.can(Permission.ROUTE_EXECUTE)) {
      throw routeForbidden('previsualizar rutas');
    }
    const points: PlanPoint[] = dto.points.map((p, i) => ({ id: p.id, sequenceOrder: i + 1, latitude: p.latitude, longitude: p.longitude, scheduledTime: p.scheduledTime }));
    if (points.length < 2) {
      return { geometry: [], stops: points.map((p) => ({ id: p.id, sequenceOrder: p.sequenceOrder, etaMinutes: 0, scheduledTime: p.scheduledTime ?? undefined })), minutes: points.length * DWELL_MIN };
    }
    const [path, best] = await Promise.all([this.osrm.route(points), points.length >= 3 ? this.osrm.trip(points) : Promise.resolve(null)]);
    if (!path) {
      // Sin motor de ruteo no hay distancia confiable: se dice sin inventar una.
      return { geometry: [], stops: points.map((p) => ({ id: p.id, sequenceOrder: p.sequenceOrder, etaMinutes: undefined, scheduledTime: p.scheduledTime ?? undefined })) };
    }
    const fixed = new Set(points.filter((p) => p.scheduledTime).map((p) => p.id));
    const suggestion = this.suggestOrder(points, path, best);
    return {
      geometry: path.geometry,
      distanceKm: round1(path.distanceM / 1000),
      minutes: Math.round(path.durationS / 60) + DWELL_MIN * points.length,
      stops: withEta(points, points, path.legs),
      // Con hora fija, el orden sugerido no la puede mover: se quita de la sugerencia lo que no cabe respetar.
      suggestion: suggestion && fixed.size === 0 ? suggestion : suggestion ? keepFixed(points, suggestion, fixed) : undefined,
    };
  }

  /**
   * ¿Convendría hacerlo en otro orden? Se le pide a OSRM el recorrido óptimo (la primera parada
   * queda fija: el cobrador ya salió para allá) y se compara contra el actual.
   *
   * **Sólo se sugiere si ahorra de verdad** (§5.3): una alerta que promete 200 metros entrena al
   * cobrador a ignorarlas todas.
   */
  private suggestOrder(
    drawable: PlanPoint[],
    current: OsrmRoute,
    best: OsrmTrip | null,
  ): RouteSuggestion | undefined {
    // Con dos paradas no hay nada que reordenar; `preview` ni siquiera le pide el viaje a OSRM.
    if (drawable.length < 3 || !best) return undefined;

    const savedKm = round1((current.distanceM - best.distanceM) / 1000);
    const savedMinutes = Math.round((current.durationS - best.durationS) / 60);
    if (savedKm < MIN_SAVED_KM && savedMinutes < MIN_SAVED_MINUTES) return undefined;

    return { order: best.order.map((i) => drawable[i]!.id), savedKm, savedMinutes };
  }

  /**
   * Aplica el orden sugerido. Reusa el mismo `resequence` de S2 —dos pasadas por la restricción
   * `unique(routeId, sequenceOrder)`.
   *
   * 🔴 F4/12: **las paradas con hora fija y las ya gestionadas conservan su lugar** (decisión 9). El orden sugerido
   * solo reparte los lugares que quedan entre las paradas que sí se pueden mover; las que no tienen punto en el mapa
   * tampoco se mueven. Antes se reordenaba todo y una visita de las 10:00 podía terminar a las 15:00.
   */
  async optimize(routeId: string): Promise<RouteDetail> {
    await this.tx(async (tx) => {
      const { route, roles } = await this.access(tx, routeId);
      // Optimizar el orden de su propia jornada lo hace quien la anda; armarla la arma su creador.
      if (!roles.canManage && !roles.canRun) throw changeRequestRequired('REORDER');
      this.requireOpen(route.status);
    });
    const preview = await this.preview(routeId, { audit: false });
    if (!preview.suggestion) return this.findOne(routeId);

    const fixedByTime = new Set(preview.stops.filter((s) => s.scheduledTime).map((s) => s.id));
    await this.tx(async (tx) => {
      await this.access(tx, routeId);
      const all = await tx.routeStop.findMany({ where: { routeId }, orderBy: { sequenceOrder: 'asc' }, select: { id: true, status: true } });
      const movable = new Set(
        all.filter((s) => isOpenStop(s.status as unknown as SharedStopStatus) && !fixedByTime.has(s.id) && preview.suggestion!.order.includes(s.id)).map((s) => s.id),
      );
      const suggested = preview.suggestion!.order.filter((id) => movable.has(id));
      let k = 0;
      const next = all.map((s) => (movable.has(s.id) ? suggested[k++]! : s.id));
      await this.resequence(tx, next);
    });
    await this.audit.record({ entity: 'route', entityId: routeId, action: 'UPDATE', after: { optimized: preview.suggestion.order.length } });
    return this.findOne(routeId);
  }
}

/** Para comparar nombres: sin acentos y en minúsculas, o «Édgar» cae después de «Zeballos». */
function key(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Preview: tipos y cálculo puro ────────────────────────────────────────────

/** Minutos que el cobrador pasa en cada parada. Sin esto la duración no le sirve para planificar. */
const DWELL_MIN = 10;
/** Umbral de la alerta de zigzag: abajo de esto no se sugiere reordenar (§5.3). */
const MIN_SAVED_KM = 1;
const MIN_SAVED_MINUTES = 10;

type SerializedStop = ReturnType<typeof serializeStop>;
/** Lo mínimo que el cálculo del recorrido necesita de una parada: un id, su lugar en el orden y un punto. */
interface PlanPoint {
  id: string;
  sequenceOrder: number;
  latitude: number;
  longitude: number;
  scheduledTime?: string | null;
}
type PointStop = SerializedStop & { latitude: number; longitude: number };

export interface RouteSuggestion {
  /** Ids de parada en el orden propuesto. */
  order: string[];
  savedKm: number;
  savedMinutes: number;
}

export interface RoutePreview {
  /** La polilínea por las calles. Vacía = el móvil une los puntos con rectas (sin motor o sin red). */
  geometry: { latitude: number; longitude: number }[];
  distanceKm?: number;
  minutes?: number;
  /**
   * `etaMinutes` = minutos desde la salida hasta esa parada. Derivado, no guardado. `scheduledTime` = la hora fija de su
   * visita agendada, si la tiene: con la hora de salida, la pantalla marca el choque.
   */
  stops: { id: string; sequenceOrder: number; etaMinutes?: number; scheduledTime?: string }[];
  suggestion?: RouteSuggestion;
}

const hasPoint = (s: SerializedStop): s is PointStop => s.latitude != null && s.longitude != null;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Cuántos minutos desde la salida hasta cada parada: los tramos anteriores más la permanencia en
 * cada una de las paradas ya hechas. La primera es 0 — es la hora a la que arranca.
 * Una parada sin coordenadas no tiene tramo y queda sin estimación, pero no rompe la cuenta.
 */
function withEta(
  stops: { id: string; sequenceOrder: number; scheduledTime?: string | null }[],
  drawable: { id: string }[],
  legs: { durationS: number }[],
): RoutePreview['stops'] {
  const eta = new Map<string, number>();
  let acc = 0;
  drawable.forEach((s, i) => {
    if (i > 0) acc += Math.round((legs[i - 1]?.durationS ?? 0) / 60) + DWELL_MIN;
    eta.set(s.id, acc);
  });
  return stops.map((s) => ({ id: s.id, sequenceOrder: s.sequenceOrder, etaMinutes: eta.get(s.id), scheduledTime: s.scheduledTime ?? undefined }));
}

/**
 * El orden sugerido respetando las horas fijas: las paradas con hora conservan SU lugar y el resto se reparte entre los
 * lugares que quedan (el mismo criterio que `optimize`). Si no queda nada que mover, no hay sugerencia.
 */
function keepFixed(points: PlanPoint[], suggestion: RouteSuggestion, fixed: Set<string>): RouteSuggestion | undefined {
  const movable = suggestion.order.filter((id) => !fixed.has(id));
  if (movable.length < 2) return undefined;
  let k = 0;
  const order = points.map((p) => (fixed.has(p.id) ? p.id : movable[k++]!));
  const changed = order.some((id, i) => id !== points[i]!.id);
  return changed ? { ...suggestion, order } : undefined;
}
