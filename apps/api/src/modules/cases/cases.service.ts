import { Injectable } from '@nestjs/common';
import type { CollectionCase, Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, CaseActivityType, CaseStatus, LocationType } from '@prisma/client';
import { canTransition, maskDocument, Permission, resolvePagination, type ApiResponse, ResponseDto } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { computePriority, slaDueAt, DEFAULT_PRIORITY_PARAMS, type PriorityParams } from './case-priority';
import { serializeCase, type PortfolioExtra } from './cases.serializer';
import {
  AssignCaseDto,
  CreateActivityDto,
  CreateCaseDto,
  GenerateCasesDto,
  ListCasesQueryDto,
  TransitionCaseDto,
} from './dto/case.dto';
import { caseDuplicate, caseNoActivity, invalidAssignee, invalidTransition, resourceNotFound } from './cases.errors';

const TERMINAL: CaseStatus[] = [CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF];

/**
 * Cómo se puede ordenar el listado.
 *
 * Los dos que miran plata y mora **viven en `credit`**, no en el caso, así que se ordena por la
 * relación — Prisma sabe hacerlo, a diferencia de un `SUM` o un `_count`, que es lo que obligó a
 * escribir SQL crudo en la cartera del panel.
 */
const CASE_ORDER: Record<string, (dir: Prisma.SortOrder) => Prisma.CollectionCaseOrderByWithRelationInput> = {
  priority: (dir) => ({ priority: dir }),
  daysPastDue: (dir) => ({ credit: { daysPastDue: dir } }),
  balance: (dir) => ({ credit: { outstandingBalance: dir } }),
  slaDueAt: (dir) => ({ slaDueAt: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

/** Las claves de orden que acepta `GET /cases`. La primera es el default. */
export const CASE_SORTS = Object.keys(CASE_ORDER);

/**
 * El `orderBy` del listado.
 *
 * 🔴 **Cierra siempre con `id`.** Sin un desempate único, `LIMIT/OFFSET` repite y saltea filas
 * entre páginas cuando hay empates — y ordenando por prioridad los empates son la regla, no la
 * excepción. Se pagó en la cartera del panel.
 *
 * Una clave desconocida cae al default en vez de responder 400: viaja en la URL, y una URL vieja
 * que alguien guardó no tiene por qué reventar la pantalla.
 */
function caseOrderBy(sort?: string, dir?: string): Prisma.CollectionCaseOrderByWithRelationInput[] {
  /*
   * `Object.hasOwn` y no un simple lookup: `?sort=hasOwnProperty` encuentra el miembro heredado de
   * `Object.prototype`, el `??` no dispara, y el `orderBy` termina con una función o un `false`
   * adentro — Prisma lo rechaza y el listado devuelve 500 en vez de caer al orden por defecto.
   * El DTO no valida la clave a propósito (una URL vieja no tiene por qué reventar), así que la
   * guarda de verdad es ésta.
   */
  const key = sort && Object.hasOwn(CASE_ORDER, sort) ? sort : 'priority';
  const primary = CASE_ORDER[key]!(dir === 'asc' ? 'asc' : 'desc');
  // Entre iguales, primero el caso más viejo: es el que lleva más tiempo esperando.
  const byAge: Prisma.CollectionCaseOrderByWithRelationInput[] =
    sort === 'createdAt' ? [] : [{ createdAt: 'asc' }];
  return [primary, ...byAge, { id: 'asc' }];
}

@Injectable()
export class CasesService {
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

  private async config(tx: PrismaClient): Promise<{ priority: PriorityParams; minDaysPastDue: number }> {
    const account = await tx.account.findUnique({ where: { id: this.tenant.accountId } });
    const cfg = (account?.configuration ?? {}) as { casePriority?: Partial<PriorityParams>; caseGeneration?: { minDaysPastDue?: number } };
    return {
      priority: { ...DEFAULT_PRIORITY_PARAMS, ...(cfg.casePriority ?? {}) },
      minDaysPastDue: cfg.caseGeneration?.minDaysPastDue ?? 1,
    };
  }

  // ── Alta / generación ────────────────────────────────────────────────────
  async create(dto: CreateCaseDto): Promise<ReturnType<typeof serializeCase>> {
    const created = await this.tx(async (tx) => {
      const credit = await tx.credit.findFirst({
        where: { id: dto.creditId, deletedAt: null },
        include: { client: { select: { riskSegment: true } } },
      });
      if (!credit) throw resourceNotFound();

      const open = await tx.collectionCase.findFirst({
        where: { creditId: dto.creditId, status: { notIn: TERMINAL }, deletedAt: null },
        select: { id: true },
      });
      if (open) throw caseDuplicate();

      const { priority: params } = await this.config(tx);
      const priority = dto.priority ?? computePriority(
        { outstandingBalance: Number(credit.outstandingBalance), daysPastDue: credit.daysPastDue, riskSegment: credit.client.riskSegment },
        params,
      );
      const now = new Date();
      return tx.collectionCase.create({
        data: {
          accountId: this.tenant.accountId,
          creditId: credit.id,
          clientId: credit.clientId,
          branchId: credit.branchId,
          status: CaseStatus.PENDING,
          priority,
          slaDueAt: slaDueAt(priority, now, params),
        },
      });
    });

    await this.audit.record({ entity: 'case', entityId: created.id, action: 'CREATE', after: created });
    this.events.emit(DomainEvent.CASE_UPDATED, { caseId: created.id, accountId: this.tenant.accountId, status: created.status });
    return serializeCase(created);
  }

  async generate(dto: GenerateCasesDto): Promise<{ created: number }> {
    const created = await this.tx(async (tx) => {
      const { priority: params, minDaysPastDue } = await this.config(tx);
      const minDays = dto.minDaysPastDue ?? minDaysPastDue;

      const credits = await tx.credit.findMany({
        where: { status: 'ACTIVE', deletedAt: null, daysPastDue: { gte: minDays } },
        include: { client: { select: { riskSegment: true } } },
      });
      const openCases = await tx.collectionCase.findMany({
        where: { status: { notIn: TERMINAL }, deletedAt: null },
        select: { creditId: true },
      });
      const withOpenCase = new Set(openCases.map((c) => c.creditId));

      const now = new Date();
      let n = 0;
      for (const credit of credits) {
        if (withOpenCase.has(credit.id)) continue; // idempotente
        const priority = computePriority(
          { outstandingBalance: Number(credit.outstandingBalance), daysPastDue: credit.daysPastDue, riskSegment: credit.client.riskSegment },
          params,
        );
        await tx.collectionCase.create({
          data: {
            accountId: this.tenant.accountId,
            creditId: credit.id,
            clientId: credit.clientId,
            branchId: credit.branchId,
            status: CaseStatus.PENDING,
            priority,
            slaDueAt: slaDueAt(priority, now, params),
          },
        });
        n++;
      }
      return n;
    });

    if (created > 0) {
      await this.audit.record({ entity: 'case', entityId: 'batch', action: 'GENERATE', after: { created } });
    }
    return { created };
  }

  // ── Asignación ─────────────────────────────────────────────────────────────
  async assign(id: string, dto: AssignCaseDto): Promise<ReturnType<typeof serializeCase>> {
    const { updated, collectorId } = await this.tx(async (tx) => {
      const found = await tx.collectionCase.findFirst({ where: { id, deletedAt: null } });
      if (!found) throw resourceNotFound();

      const target = dto.collectorId ?? (dto.auto ? await this.leastLoadedCollector(tx) : null);
      if (!target) throw invalidAssignee();
      if (dto.collectorId) {
        const ua = await tx.userAccount.findFirst({ where: { userId: dto.collectorId, isActive: true }, select: { id: true } });
        if (!ua) throw invalidAssignee(); // no pertenece al tenant
      }

      const next = await tx.collectionCase.update({
        where: { id },
        data: { assigneeId: target, lastActionAt: new Date() },
      });
      await tx.caseActivity.create({
        data: { accountId: this.tenant.accountId, caseId: id, userId: this.tenant.userId, type: CaseActivityType.ASSIGNMENT, notes: `Asignado a ${target}` },
      });
      return { updated: next, collectorId: target };
    });

    await this.audit.record({ entity: 'case', entityId: id, action: 'ASSIGN', after: { assigneeId: collectorId } });
    this.events.emit(DomainEvent.CASE_ASSIGNED, { caseId: id, collectorId, accountId: this.tenant.accountId });
    return serializeCase(updated);
  }

  /** Colector (rol COLLECTOR del tenant) con menos casos abiertos. */
  private async leastLoadedCollector(tx: PrismaClient): Promise<string> {
    const members = await tx.userAccount.findMany({ where: { isActive: true }, include: { role: { select: { name: true } } } });
    const collectorIds = members.filter((m) => m.role.name === 'COLLECTOR').map((m) => m.userId);
    if (collectorIds.length === 0) throw invalidAssignee();

    const grouped = await tx.collectionCase.groupBy({
      by: ['assigneeId'],
      where: { status: { notIn: TERMINAL }, deletedAt: null, assigneeId: { in: collectorIds } },
      _count: { _all: true },
    });
    const load = new Map<string, number>(collectorIds.map((id) => [id, 0]));
    for (const g of grouped) if (g.assigneeId) load.set(g.assigneeId, g._count._all);

    let best = collectorIds[0]!;
    let min = Infinity;
    for (const id of collectorIds) {
      const l = load.get(id) ?? 0;
      if (l < min) { min = l; best = id; }
    }
    return best;
  }

  // ── Máquina de estados ──────────────────────────────────────────────────────
  async transition(id: string, dto: TransitionCaseDto): Promise<ReturnType<typeof serializeCase>> {
    const { before, after } = await this.applyTransition(id, dto.status, dto.reason);
    await this.audit.record({ entity: 'case', entityId: id, action: 'UPDATE', before, after });
    this.events.emit(DomainEvent.CASE_UPDATED, { caseId: id, accountId: this.tenant.accountId, status: after.status });
    return serializeCase(after);
  }

  async close(id: string, reason: string): Promise<ReturnType<typeof serializeCase>> {
    const { before, after } = await this.applyTransition(id, CaseStatus.CLOSED, reason);
    await this.audit.record({ entity: 'case', entityId: id, action: 'CLOSE', before, after });
    this.events.emit(DomainEvent.CASE_UPDATED, { caseId: id, accountId: this.tenant.accountId, status: after.status });
    return serializeCase(after);
  }

  private async applyTransition(id: string, to: CaseStatus, reason?: string): Promise<{ before: CollectionCase; after: CollectionCase }> {
    return this.tx(async (tx) => {
      const before = await tx.collectionCase.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw resourceNotFound();
      if (!canTransition(before.status as never, to as never)) throw invalidTransition(before.status, to);

      const terminal = TERMINAL.includes(to);
      if (terminal) {
        // CASE_001: una gestión REAL (no la asignación ni el cambio de estado automático).
        const activities = await tx.caseActivity.count({
          where: { caseId: id, type: { notIn: [CaseActivityType.ASSIGNMENT, CaseActivityType.STATUS_CHANGE] } },
        });
        if (activities === 0) throw caseNoActivity();
      }

      const now = new Date();
      const after = await tx.collectionCase.update({
        where: { id },
        data: {
          status: to,
          lastActionAt: now,
          ...(terminal ? { closedAt: now, closedBy: this.tenant.userId, closedReason: reason } : {}),
        },
      });
      await tx.caseActivity.create({
        data: { accountId: this.tenant.accountId, caseId: id, userId: this.tenant.userId, type: CaseActivityType.STATUS_CHANGE, result: to, notes: reason },
      });
      return { before, after };
    });
  }

  // ── Bitácora ────────────────────────────────────────────────────────────────
  async addActivity(id: string, dto: CreateActivityDto) {
    const { activity, agendaId } = await this.tx(async (tx) => {
      const found = await tx.collectionCase.findFirst({ where: { id, deletedAt: null }, select: { id: true, clientId: true, creditId: true } });
      if (!found) throw resourceNotFound();
      const created = await tx.caseActivity.create({
        data: { accountId: this.tenant.accountId, caseId: id, userId: this.tenant.userId, type: dto.type, notes: dto.notes, result: dto.result },
      });
      // Promesa de pago (§5.4): además del historial, vive en agenda_items → enciende PROMESA en la
      // cartera (S1) y aparece en la Agenda. Misma transacción que la gestión.
      let agendaId: string | undefined;
      if (dto.promise && this.tenant.userId) {
        const item = await tx.agendaItem.create({
          data: {
            accountId: this.tenant.accountId,
            caseId: id,
            clientId: found.clientId,
            creditId: found.creditId,
            assigneeId: this.tenant.userId,
            type: AgendaItemType.PROMISE_TO_PAY,
            status: AgendaItemStatus.SCHEDULED,
            scheduledDate: new Date(dto.promise.promiseDate),
            details: {
              amount: dto.promise.amount,
              promiseDate: dto.promise.promiseDate,
              paymentMethodCode: dto.promise.paymentMethodCode,
              ...(dto.promise.bankCode ? { bankCode: dto.promise.bankCode } : {}),
            },
            createdBy: this.tenant.userId,
          },
        });
        agendaId = item.id;
      }
      await tx.collectionCase.update({ where: { id }, data: { lastActionAt: new Date() } });
      return { activity: created, agendaId };
    });
    this.events.emit(DomainEvent.CASE_UPDATED, { caseId: id, accountId: this.tenant.accountId, activity: dto.type });
    if (agendaId) {
      await this.audit.record({ entity: 'agenda_item', entityId: agendaId, action: 'CREATE', after: { caseId: id, source: 'gestion_promise' } });
    }
    return { id: activity.id, type: activity.type, createdAt: activity.createdAt };
  }

  /**
   * `true` para el cobrador: opera casos (CASE_WRITE) pero no reasigna (CASE_ASSIGN) → solo ve los
   * suyos. Un rol read-only de cuenta (auditor/viewer: CASE_READ sin write) NO cae acá → ve todo.
   */
  private scopedToOwnCases(): boolean {
    return this.tenant.can(Permission.CASE_WRITE) && !this.tenant.can(Permission.CASE_ASSIGN);
  }

  // ── Lecturas ────────────────────────────────────────────────────────────────
  /**
   * El listado. El orden se pide por `?sort=&dir=` (F9 W5-D4): antes estaba cableado en prioridad
   * y el panel no podía ordenar por mora ni por vencimiento, que es justo como una supervisora
   * mira su cartera.
   */
  async list(query: ListCasesQueryDto): Promise<ApiResponse<ReturnType<typeof serializeCase>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.CollectionCaseWhereInput = { deletedAt: null };
    if (query.priority) where.priority = query.priority;
    if (query.clientId) where.clientId = query.clientId;
    if (query.overdue === 'true') where.slaDueAt = { lt: new Date() };

    /*
     * El estado se decide UNA vez.
     *
     * `overdue` y `open` significan lo mismo para el estado —«todavía no terminó»— y antes cada
     * uno escribía `where.status` por su cuenta, **pisando el filtro explícito**: pedir promesas
     * vencidas devolvía vencidas de cualquier estado, con el desplegable de la pantalla todavía
     * marcando «Promesa de pago». Un estado pedido a mano gana siempre; si además es terminal, la
     * lista vuelve vacía, que es la respuesta correcta a «cerrados y sin cerrar a la vez».
     */
    if (query.status) where.status = query.status;
    else if (query.overdue === 'true' || query.open === 'true') where.status = { notIn: TERMINAL };

    // Scope por capacidad (no por nombre de rol). Tres casos:
    //  - CASE_ASSIGN (supervisor/manager): ve todo, puede filtrar por cualquier assigneeId.
    //  - operador de campo (CASE_WRITE sin CASE_ASSIGN = cobrador): acotado a lo suyo.
    //  - observador de cuenta (CASE_READ sin write ni assign = auditor/viewer): ve toda la cuenta.
    if (this.tenant.can(Permission.CASE_ASSIGN)) {
      if (query.assigneeId) where.assigneeId = query.assigneeId;
    } else if (this.scopedToOwnCases()) {
      where.assigneeId = this.tenant.userId;
    }

    const [rows, total] = await this.tx((tx) =>
      Promise.all([
        tx.collectionCase.findMany({
          where,
          orderBy: caseOrderBy(query.sort, query.dir),
          skip,
          take: limit,
          include: {
            client: { select: { firstName: true, lastName: true, businessName: true } },
            credit: { select: { outstandingBalance: true, currency: true, daysPastDue: true, metadata: true, installments: { select: { dueDate: true, amount: true, status: true } } } },
          },
        }),
        tx.collectionCase.count({ where }),
      ]),
    );
    // Lista de cartera (§5.3): zona + punto en el mapa + documento enmascarado + promesa vigente,
    // opt-in para no cargar a Home.
    const extra = query.view === 'portfolio' ? await this.portfolioExtra(rows.map((c) => c.clientId)) : undefined;
    // El punto es el domicilio: se audita el revelado, UN registro por consulta (no por cliente),
    // mismo criterio que agenda y que las direcciones de las paradas en rutas.
    if (extra?.size) {
      await this.audit.record({ entity: 'case_portfolio', entityId: this.tenant.userId ?? 'anon', action: 'PII_REVEAL' });
    }
    return ResponseDto.paginated(
      rows.map((c) => serializeCase(c, new Date(), extra?.get(c.clientId))),
      total,
      page,
      limit,
    );
  }

  /**
   * Enriquecimiento de la tarjeta de cartera para un set de clientes (§5.3). Dos queries sobre la página,
   * no N+1: los datos del cliente (zona, punto en el mapa y documento enmascarado) y qué clientes tienen
   * una promesa vigente. El documento va SIEMPRE enmascarado (no es `PII_REVEAL`); la promesa = gestión
   * `PROMISE_TO_PAY` agendada a hoy o al futuro.
   *
   * **Ubicación primaria = la primera `HOME`; si no hay ninguna, la primera cargada** — la misma regla
   * que usa `routes.serializer` para la dirección de la parada. Con dos criterios distintos, el pin del
   * mapa y la dirección de la parada podrían apuntar a lugares distintos del mismo cliente.
   *
   * El mapa, en cambio, recibe **todas** las ubicaciones dibujables: las del cliente y las de sus
   * garantes y familiares (misma tabla, `relationId`). Una deuda se cobra donde esté la persona.
   */
  private async portfolioExtra(clientIds: string[]): Promise<Map<string, PortfolioExtra>> {
    const ids = [...new Set(clientIds)];
    const map = new Map<string, PortfolioExtra>();
    if (ids.length === 0) return map;

    const today = new Date();
    const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const [clients, promises] = await this.tx((tx) =>
      Promise.all([
        tx.client.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            nationalId: true,
            // Sin filtrar por `relationId`: entran también las del garante y la familia (§S5).
            locations: {
              select: {
                id: true,
                locationType: true,
                zone: true,
                address: true,
                latitude: true,
                longitude: true,
                relationId: true,
                relation: { select: { relatedName: true, relationshipType: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
        tx.agendaItem.findMany({
          where: {
            clientId: { in: ids },
            deletedAt: null,
            type: AgendaItemType.PROMISE_TO_PAY,
            status: AgendaItemStatus.SCHEDULED,
            scheduledDate: { gte: startOfToday },
          },
          select: { clientId: true },
        }),
      ]),
    );

    const withPromise = new Set(promises.map((p) => p.clientId));
    for (const c of clients) {
      const doc = this.safeDecrypt(c.nationalId);
      // La zona de la tarjeta sigue saliendo de la ubicación primaria DEL CLIENTE (no de un garante).
      const propias = c.locations.filter((l) => l.relationId == null);
      const primaria = propias.find((l) => l.locationType === LocationType.HOME) ?? propias[0];
      map.set(c.id, {
        zone: primaria?.zone ?? undefined,
        // Sólo las dibujables: una dirección sin punto existe, pero el mapa no puede pintarla.
        locations: c.locations
          .filter((l) => l.latitude != null && l.longitude != null)
          .map((l) => ({
            id: l.id,
            locationType: l.locationType,
            latitude: Number(l.latitude),
            longitude: Number(l.longitude),
            address: this.safeDecrypt(l.address) ?? undefined,
            ownerName: l.relation?.relatedName,
            ownerRelation: l.relation?.relationshipType,
          })),
        documentMasked: doc ? maskDocument(doc) : undefined,
        hasActivePromise: withPromise.has(c.id),
      });
    }
    return map;
  }

  /** Descifra tolerando el legado en claro (mismo criterio que `clients.serializer`). */
  private safeDecrypt(value: string | null): string | null {
    if (value == null) return null;
    try {
      return this.crypto.decrypt(value);
    } catch {
      return value;
    }
  }

  async findOne(id: string): Promise<ReturnType<typeof serializeCase>> {
    const found = await this.tx((tx) =>
      tx.collectionCase.findFirst({
        where: { id, deletedAt: null },
        include: {
          activities: { orderBy: { createdAt: 'desc' } },
          client: { select: { firstName: true, lastName: true, businessName: true } },
          credit: { select: { outstandingBalance: true, currency: true, daysPastDue: true, metadata: true, installments: { select: { dueDate: true, amount: true, status: true } } } },
        },
      }),
    );
    if (!found) throw resourceNotFound();
    // Mismo scope que el listado: un cobrador no consulta el caso de otro, pero un auditor sí.
    if (this.scopedToOwnCases() && found.assigneeId !== this.tenant.userId) {
      throw resourceNotFound();
    }
    return serializeCase(found);
  }
}
