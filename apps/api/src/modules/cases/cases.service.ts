import { Injectable } from '@nestjs/common';
import type { CollectionCase, Prisma, PrismaClient } from '@prisma/client';
import {
  AgendaItemStatus,
  AgendaItemType,
  CaseActivityType,
  CasePriority,
  CaseStatus,
  LocationType,
  VisitOutcome,
} from '@prisma/client';
import {
  canTransition,
  maskDocument,
  Permission,
  resolvePagination,
  type ApiResponse,
  type CaseSort,
  ResponseDto,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { nameTerms } from '../../common/name-search';
import { computePriority, slaDueAt, DEFAULT_PRIORITY_PARAMS, type PriorityParams } from './case-priority';
import { serializeCase, type PortfolioExtra } from './cases.serializer';
import {
  AssignCaseDto,
  CreateActivityDto,
  CreateCaseDto,
  GenerateCasesDto,
  ListCasesQueryDto,
  SetPriorityDto,
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
const CASE_ORDER: Record<CaseSort, (dir: Prisma.SortOrder) => Prisma.CollectionCaseOrderByWithRelationInput> = {
  priority: (dir) => ({ priority: dir }),
  daysPastDue: (dir) => ({ credit: { daysPastDue: dir } }),
  balance: (dir) => ({ credit: { outstandingBalance: dir } }),
  slaDueAt: (dir) => ({ slaDueAt: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

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
/**
 * Una lista separada por comas → los valores que el enum conoce, sin repetidos.
 *
 * 🔴 **Lo que no existe se descarta, no rebota con 400.** Estos filtros viajan en la URL de una
 * pantalla con panel de filtros: un link guardado de cuando había otro estado tiene que abrir la
 * lista sin ese filtro, no dejar a la persona con una pantalla rota. Es el mismo criterio de `sort`.
 *
 * Si NADA de lo que llegó es válido, devuelve vacío y quien llama trata eso como «sin filtro»: pedir
 * un estado inventado no puede devolver silenciosamente toda la cartera **filtrada por otra cosa**,
 * pero tampoco un error sobre algo que la persona no escribió.
 */
export function enumList<T extends Record<string, string>>(raw: string | undefined, values: T): T[keyof T][] {
  if (!raw?.trim()) return [];
  const valid = new Set(Object.values(values));
  const out = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => valid.has(v));
  return [...new Set(out)] as T[keyof T][];
}

function caseOrderBy(sort?: string, dir?: string): Prisma.CollectionCaseOrderByWithRelationInput[] {
  /*
   * `Object.hasOwn` y no un simple lookup: `?sort=hasOwnProperty` encuentra el miembro heredado de
   * `Object.prototype`, el `??` no dispara, y el `orderBy` termina con una función o un `false`
   * adentro — Prisma lo rechaza y el listado devuelve 500 en vez de caer al orden por defecto.
   * El DTO no valida la clave a propósito (una URL vieja no tiene por qué reventar), así que la
   * guarda de verdad es ésta.
   */
  const key: CaseSort = sort && Object.hasOwn(CASE_ORDER, sort) ? (sort as CaseSort) : 'priority';
  const primary = CASE_ORDER[key](dir === 'asc' ? 'asc' : 'desc');
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
      /*
       * 🔴 La nota guarda **el id, no una frase**. Antes decía `Asignado a <uuid>`: texto en español
       * dentro de la base de un producto bilingüe, y con un uuid crudo que la bitácora terminaba
       * mostrándole a una persona. El id es el dato; «Asignado a Rosa Quispe» lo escribe cada
       * pantalla, en su idioma y con el nombre resuelto.
       */
      await tx.caseActivity.create({
        data: { accountId: this.tenant.accountId, caseId: id, userId: this.tenant.userId, type: CaseActivityType.ASSIGNMENT, notes: target },
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

  // ── Prioridad ───────────────────────────────────────────────────────────────
  /**
   * Fijar la prioridad a mano, o devolverla a la automática.
   *
   * 🔴 **La fecha (`priorityPinnedAt`) es lo que hace que esto sirva de algo.** Sin ella, subir la
   * prioridad de un deudor con dos días de atraso duraba hasta la noche: el trabajo diario la
   * recalcula desde el saldo y la mora, y se la devolvía a baja. Con la fecha puesta el job saltea
   * esa cobranza, que es la misma regla que ya gobierna la mora — cada dato tiene un solo dueño.
   *
   * 🔴 **Soltar no fija «la automática de hoy»: la suelta y ya.** Deja el valor que había y borra la
   * marca; el job la recalcula en la próxima pasada. Calcularla acá la dejaría clavada en el número
   * de este instante, que es exactamente lo que se quería dejar de hacer.
   */
  async setPriority(id: string, dto: SetPriorityDto): Promise<ReturnType<typeof serializeCase>> {
    const { before, after } = await this.tx(async (tx) => {
      const found = await tx.collectionCase.findFirst({ where: { id, deletedAt: null } });
      if (!found) throw resourceNotFound();

      const next = await tx.collectionCase.update({
        where: { id },
        data: dto.auto
          ? { priorityPinnedAt: null }
          : { priority: dto.priority ?? found.priority, priorityPinnedAt: new Date() },
      });
      return { before: found, after: next };
    });

    await this.audit.record({
      entity: 'case',
      entityId: id,
      action: dto.auto ? 'PRIORITY_AUTO' : 'PRIORITY_PIN',
      before: { priority: before.priority, pinned: before.priorityPinnedAt !== null },
      after: { priority: after.priority, pinned: after.priorityPinnedAt !== null },
    });
    return serializeCase(after);
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
    const priorities = enumList(query.priority, CasePriority);
    if (priorities.length > 0) where.priority = { in: priorities };
    if (query.clientId) where.clientId = query.clientId;
    if (query.overdue === 'true') where.slaDueAt = { lt: new Date() };

    /*
     * La mora es del **crédito**, no del caso: se filtra sobre la relación. Es lo que hace que la
     * pantalla de Mora pueda abrir con «sólo los vencidos» (`dpdMin=1`) en vez de con todo el
     * trabajo abierto, que incluye a quien está al día y sólo tiene el expediente sin cerrar.
     */
    /*
     * La mora y el saldo son del crédito, así que comparten `where.credit`. Van juntos y no en dos
     * asignaciones: la segunda pisaba a la primera, y pedir «más de 30 días **y** más de mil pesos»
     * devolvía sólo el segundo filtro sin que nada lo dijera.
     */
    const credit: Prisma.CreditWhereInput = {};
    if (query.dpdMin != null || query.dpdMax != null) {
      credit.daysPastDue = {
        ...(query.dpdMin != null ? { gte: query.dpdMin } : {}),
        ...(query.dpdMax != null ? { lte: query.dpdMax } : {}),
      };
    }
    if (query.balanceMin != null || query.balanceMax != null) {
      credit.outstandingBalance = {
        ...(query.balanceMin != null ? { gte: query.balanceMin } : {}),
        ...(query.balanceMax != null ? { lte: query.balanceMax } : {}),
      };
    }
    if (Object.keys(credit).length > 0) where.credit = credit;

    /*
     * Búsqueda por nombre del deudor, **palabra por palabra**: «Teresa Mama» encuentra a «Teresa
     * Mamani Padilla». La regla vive en `common/name-search`, compartida con la cartera — dos
     * buscadores que se comportan distinto sobre los mismos nombres son dos productos.
     *
     * El documento no entra: está cifrado y se busca por blind index, que es el camino de la
     * cartera y no éste.
     */
    /*
     * El nombre y la zona son los dos del cliente, así que comparten `where.client` por el mismo
     * motivo que el crédito comparte el suyo. La zona vive en las direcciones: basta con que UNA lo
     * sea — un cliente con casa en el Centro y negocio en el Mercado entra por las dos.
     */
    const client: Prisma.ClientWhereInput = {};
    if (query.q?.trim()) {
      /*
       * 🔴 **Nombre o zona, en la misma caja.** Al armar una ruta se busca de las dos maneras —«los
       * Mamani» y «los del Centro»— y obligar a elegir el campo antes de escribir hace que la mitad
       * de las búsquedas devuelvan vacío sin que nada explique por qué.
       *
       * El nombre va palabra por palabra (`nameTerms`, compartido con la cartera); la zona, por
       * coincidencia parcial y sin distinguir mayúsculas, porque es texto libre y nadie recuerda si
       * quedó cargada como «Centro» o «centro».
       */
      const q = query.q.trim();
      client.OR = [
        { AND: nameTerms(q) },
        { locations: { some: { zone: { contains: q, mode: 'insensitive' } } } },
      ];
    }
    // El filtro de zona del panel es aparte y **exacto**: elegir «Centro» de una lista no puede
    // traer también «Centro Norte».
    if (query.zone?.trim()) client.locations = { some: { zone: query.zone.trim() } };
    if (Object.keys(client).length > 0) where.client = client;

    /*
     * ── Filtros de planificación (W11) ───────────────────────────────────────
     * Todos son «relación que no existe» o «relación que sí»: Prisma los resuelve con EXISTS, sin
     * traer nada de la otra tabla.
     */

    // Ninguna visita desde esa fecha. Incluye a los que no tienen ninguna: si no hubo visitas,
    // tampoco hubo visitas recientes.
    if (query.notVisitedSince) where.visits = { none: { capturedAt: { gte: new Date(query.notVisitedSince) } } };
    // Más estricto: ni una vez, nunca. Gana sobre el anterior porque es un subconjunto.
    if (query.neverVisited === 'true') where.visits = { none: {} };

    const outcomes = enumList(query.outcome, VisitOutcome);
    if (outcomes.length > 0) {
      // `some` sobre otra propiedad de la misma relación necesita su propio filtro: con `none` y
      // `some` en el mismo objeto, el segundo pisa al primero.
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { visits: { some: { outcome: { in: outcomes } } } }];
    }

    /*
     * 🔴 «Sólo mora disponible»: fuera los casos que YA son parada de una ruta ese día. Sin esto,
     * dos supervisores mandan a dos cobradores a la misma puerta la misma mañana.
     */
    if (query.excludeRouted) {
      where.routeStops = { none: { route: { plannedDate: new Date(query.excludeRouted) } } };
    }

    /*
     * El estado se decide UNA vez.
     *
     * `overdue` y `open` significan lo mismo para el estado —«todavía no terminó»— y antes cada
     * uno escribía `where.status` por su cuenta, **pisando el filtro explícito**: pedir promesas
     * vencidas devolvía vencidas de cualquier estado, con el desplegable de la pantalla todavía
     * marcando «Promesa de pago». Un estado pedido a mano gana siempre; si además es terminal, la
     * lista vuelve vacía, que es la respuesta correcta a «cerrados y sin cerrar a la vez».
     */
    // Uno o varios, separados por coma. Uno solo sigue funcionando igual: es lo que manda el móvil.
    const statuses = enumList(query.status, CaseStatus);
    if (statuses.length > 0) where.status = { in: statuses };
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

    /*
     * Promesa vigente. Va aparte porque `agenda_items.case_id` es **ref suave**: no hay relación en
     * Prisma, así que no se puede preguntar por ella dentro del `where`. Se resuelven primero los
     * casos con promesa y después se incluyen o se excluyen.
     *
     * ponytail: un `IN` con los casos que tienen promesa. Con la cartera más grande de hoy son
     * cientos; si un tenant llega a decenas de miles, esto pasa a ser una vista o una columna
     * denormalizada, como ya se hizo con los totales de la cartera.
     */
    if (query.hasPromise === 'true' || query.hasPromise === 'false') {
      /*
       * 🔴 Va por **cliente**, no por caso, porque `hasActivePromise` —el dato que la pantalla
       * muestra— también es por cliente. Con dos criterios distintos, filtrar «con promesa» dejaría
       * afuera filas que la propia lista está marcando con promesa.
       */
      const conPromesa = await this.clientsWithPromise();
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        { clientId: query.hasPromise === 'true' ? { in: conPromesa } : { notIn: conPromesa } },
      ];
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
            credit: { select: { outstandingBalance: true, currency: true, daysPastDue: true, code: true, metadata: true, installments: { select: { dueDate: true, amount: true, status: true } } } },
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
   * Los clientes con una promesa vigente: agendada para hoy o para adelante y todavía sin ejecutar.
   *
   * Es la **misma definición** que usa `portfolioExtra` para pintar la marca de promesa en la lista.
   * Vive en dos lugares porque una es por página y ésta es sobre toda la cartera; si un día se
   * separan, la lista va a decir «con promesa» sobre filas que el filtro deja afuera.
   */
  private async clientsWithPromise(): Promise<string[]> {
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const rows = await this.tx((tx) =>
      tx.agendaItem.findMany({
        where: {
          deletedAt: null,
          type: AgendaItemType.PROMISE_TO_PAY,
          status: AgendaItemStatus.SCHEDULED,
          scheduledDate: { gte: startOfToday },
        },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
    );
    return rows.map((r) => r.clientId);
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
