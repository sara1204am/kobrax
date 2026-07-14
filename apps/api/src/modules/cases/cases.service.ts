import { Injectable } from '@nestjs/common';
import type { CollectionCase, Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, CaseActivityType, CaseStatus } from '@prisma/client';
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
  async list(query: ListCasesQueryDto): Promise<ApiResponse<ReturnType<typeof serializeCase>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.CollectionCaseWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.clientId) where.clientId = query.clientId;
    if (query.overdue === 'true') {
      where.slaDueAt = { lt: new Date() };
      where.status = { notIn: TERMINAL };
    }
    if (query.open === 'true') where.status = { notIn: TERMINAL };

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
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
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
    // Lista de cartera (§5.3): zona + documento enmascarado + promesa vigente, opt-in para no cargar a Home.
    const extra = query.view === 'portfolio' ? await this.portfolioExtra(rows.map((c) => c.clientId)) : undefined;
    return ResponseDto.paginated(
      rows.map((c) => serializeCase(c, new Date(), extra?.get(c.clientId))),
      total,
      page,
      limit,
    );
  }

  /**
   * Enriquecimiento de la tarjeta de cartera para un set de clientes (§5.3). Dos queries sobre la página,
   * no N+1: los datos del cliente (zona + documento enmascarado) y qué clientes tienen una promesa vigente.
   * El documento va SIEMPRE enmascarado (no es `PII_REVEAL`); la promesa = gestión `PROMISE_TO_PAY` agendada
   * a hoy o al futuro.
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
            locations: { select: { zone: true }, orderBy: { createdAt: 'asc' }, take: 1 },
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
      map.set(c.id, {
        zone: c.locations[0]?.zone ?? undefined,
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
