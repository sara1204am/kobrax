import { Injectable } from '@nestjs/common';
import type { CatalogItem, Credit, Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, CatalogType, InstallmentStatus, ScheduleTimeMode } from '@prisma/client';
import {
  AGENDA_OUTCOMES_BY_TYPE,
  CASE_TRANSITIONS,
  CaseStatus,
  Permission,
  resolvePagination,
  validateAgendaDetails,
  type AgendaDetails,
  type ApiResponse,
  type CallDetails,
  type PromiseToPayDetails,
  type VisitDetails,
  type WhatsAppDetails,
  ResponseDto,
} from '@kobrax/shared';
import { CaseActivityType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService, DomainEvent } from '../../common/events/event-bus.service';
import { ClientsService } from '../clients/clients.service';
import { serializeAgendaItem } from './agenda.serializer';
import {
  AddClientContactDto,
  AddClientLocationDto,
  CompleteAgendaItemDto,
  CreateAgendaItemDto,
  ListOverdueQueryDto,
  PostponeAgendaItemDto,
} from './dto/agenda.dto';
import {
  agendaCaseNotFound,
  agendaClientWithoutCases,
  agendaInvalidDetails,
  agendaInvalidOutcome,
  agendaInvalidReference,
  agendaInvalidTimeMode,
  agendaItemNotFound,
  agendaNotSchedulable,
  agendaPastDate,
} from './agenda.errors';

/** Al ejecutar un agendado, qué tipo de actividad queda en la bitácora del caso. */
const ACTIVITY_TYPE_BY_AGENDA: Record<AgendaItemType, CaseActivityType> = {
  [AgendaItemType.CALL]: CaseActivityType.CALL,
  [AgendaItemType.VISIT]: CaseActivityType.VISIT,
  [AgendaItemType.WHATSAPP]: CaseActivityType.MESSAGE,
  [AgendaItemType.PROMISE_TO_PAY]: CaseActivityType.NOTE,
  [AgendaItemType.REMINDER]: CaseActivityType.NOTE,
};

/** Un caso es terminal cuando ya no admite transiciones (CLOSED / WRITTEN_OFF). Fuente: shared. */
function isTerminal(status: `${CaseStatus}`): boolean {
  return CASE_TRANSITIONS[status].length === 0;
}

/** Medianoche UTC de una fecha `YYYY-MM-DD` (así se persiste `scheduledDate`, columna `@db.Date`). */
function toUTCDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Gestiones agendadas (lectura S1 + alta S2). Completar/editar/eliminar llegan en S4–S6. */
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
    private readonly events: EventBusService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** Inicio del día en UTC — la referencia de "hoy" para vencidos y para no agendar en el pasado. */
  private startOfTodayUTC(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Scope por capacidad: sin `AGENDA_ASSIGN` (cobrador) solo ve SUS agendados; quien supervisa
   * (con AGENDA_ASSIGN) ve los de todo el tenant.
   */
  private assigneeScope(): Prisma.AgendaItemWhereInput {
    return this.tenant.can(Permission.AGENDA_ASSIGN) ? {} : { assigneeId: this.tenant.userId };
  }

  /** Mismo scope, pero sobre el caso: de qué casos puede agendar este usuario. */
  private caseScope(): Prisma.CollectionCaseWhereInput {
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
    const where: Prisma.AgendaItemWhereInput = {
      deletedAt: null,
      status: AgendaItemStatus.SCHEDULED,
      scheduledDate: { lt: this.startOfTodayUTC() },
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

  /**
   * Detalle de una gestión agendada (S3): la gestión, el deudor con su CI en claro, el saldo del
   * crédito, el dato con el que se ejecuta (teléfono o dirección) y el historial del caso.
   *
   * Fuera de scope o soft-deleted → 404 (no filtra existencia). Revela PII en los 5 tipos y lo
   * audita: quien puede abrir el detalle de un deudor propio no gana superficie viendo su CI.
   */
  async findOne(id: string) {
    const now = new Date();
    const { item, credit, history } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...this.assigneeScope() } });
      if (!item) throw agendaItemNotFound();
      const [credit, history] = await Promise.all([
        tx.credit.findFirst({ where: { id: item.creditId, deletedAt: null } }),
        // Sin `assigneeScope`: son gestiones del mismo caso, y el caso ya se validó como propio arriba.
        tx.agendaItem.findMany({
          where: { caseId: item.caseId, deletedAt: null, id: { not: id } },
          orderBy: { scheduledDate: 'desc' },
          take: 20,
        }),
      ]);
      return { item, credit, history };
    });

    const client = await this.clients.findOne(item.clientId, true); // audita `client/PII_REVEAL`
    // Segundo rastro, propio del módulo: distingue esta puerta de las del módulo de clientes.
    await this.audit.record({ entity: 'agenda_item', entityId: id, action: 'PII_REVEAL' });

    return ResponseDto.ok({
      item: serializeAgendaItem(item, displayName(client), now),
      client: {
        id: client.id,
        displayName: displayName(client),
        nationalId: client.nationalId,
        zone: client.locations?.[0]?.zone,
      },
      credit: credit && {
        creditId: credit.id,
        code: credit.code ?? undefined,
        outstandingBalance: Number(credit.outstandingBalance),
        currency: credit.currency,
        daysPastDue: credit.daysPastDue,
      },
      target: resolveTarget(item.type, item.details as unknown as AgendaDetails, client),
      labels: await this.detailLabels(item.type, item.details as unknown as AgendaDetails),
      history: history.map((h) => {
        const s = serializeAgendaItem(h, undefined, now);
        return { id: s.id, type: s.type, status: s.status, scheduledDate: s.scheduledDate, isOverdue: s.isOverdue };
      }),
    });
  }

  /**
   * Ejecuta una gestión (S4): deja un `CaseActivity` en la bitácora del caso, apunta el agendado a
   * esa actividad y lo pasa a EXECUTED. `outcome` debe corresponder al tipo. No transiciona el estado
   * del **caso** (eso es de F5): registrar la gestión y cobrar son cosas distintas.
   */
  async complete(id: string, dto: CompleteAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const { updated, clientName } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...this.assigneeScope() } });
      if (!item) throw agendaItemNotFound();
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();
      if (!AGENDA_OUTCOMES_BY_TYPE[item.type].includes(dto.outcome)) throw agendaInvalidOutcome();

      const activity = await tx.caseActivity.create({
        data: {
          accountId: this.tenant.accountId,
          caseId: item.caseId,
          userId: this.tenant.userId,
          type: ACTIVITY_TYPE_BY_AGENDA[item.type],
          result: dto.outcome,
          notes: dto.notes,
        },
      });
      await tx.collectionCase.update({ where: { id: item.caseId }, data: { lastActionAt: new Date() } });
      const updated = await tx.agendaItem.update({
        where: { id },
        data: { status: AgendaItemStatus.EXECUTED, resultActivityId: activity.id, updatedBy: this.tenant.userId },
      });
      const names = await this.clientNames(tx, [updated.clientId]);
      return { updated, clientName: names.get(updated.clientId) };
    });

    await this.audit.record({ entity: 'agenda_item', entityId: id, action: 'EXECUTE', after: updated });
    this.events.emit(DomainEvent.CASE_UPDATED, { caseId: updated.caseId, accountId: this.tenant.accountId, activity: ACTIVITY_TYPE_BY_AGENDA[updated.type] });
    return ResponseDto.ok(serializeAgendaItem(updated, clientName));
  }

  /**
   * Pospone una gestión en pasos fijos (S4): corre la hora **agendada** hacia adelante y la fija a hora
   * exacta (posponer da una hora concreta aunque fuera una franja). Sigue SCHEDULED. Reagendar con
   * motivo y fecha libre es S6.
   *
   * La aritmética es sobre la hora de pared naive del agendado (`scheduledDate` + `scheduledTime`), la
   * MISMA que persiste `create` y que muestra el móvil — no sobre el reloj UTC del server: mezclarlos
   * corría la hora por el offset del tenant. Un agendado por franja parte del inicio de su franja.
   * (Posponer "desde ahora" un vencido llegaría con el refinamiento tenant-tz, pendiente en todo el módulo.)
   */
  async postpone(id: string, dto: PostponeAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const { updated, clientName } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...this.assigneeScope() } });
      if (!item) throw agendaItemNotFound();
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();

      const { dayShift, time } = shiftWallClock(baseMinutes(item), dto.minutes);
      const updated = await tx.agendaItem.update({
        where: { id },
        data: {
          scheduledDate: addUTCDays(item.scheduledDate, dayShift),
          scheduledTime: time,
          timeMode: ScheduleTimeMode.FIXED,
          timeSlot: null,
          updatedBy: this.tenant.userId,
        },
      });
      const names = await this.clientNames(tx, [updated.clientId]);
      return { updated, clientName: names.get(updated.clientId) };
    });

    await this.audit.record({ entity: 'agenda_item', entityId: id, action: 'POSTPONE', after: updated });
    return ResponseDto.ok(serializeAgendaItem(updated, clientName));
  }

  /**
   * `details` guarda `code`s de catálogo; la pantalla necesita sus etiquetas ("Transferencia", "BNB")
   * en vez de `BANK_TRANSFER`. Sólo la promesa de pago los tiene.
   */
  private async detailLabels(
    type: AgendaItemType,
    details: AgendaDetails,
  ): Promise<Record<string, string> | undefined> {
    if (type !== AgendaItemType.PROMISE_TO_PAY) return undefined;
    const { paymentMethodCode, bankCode } = details as PromiseToPayDetails;
    const codes = [paymentMethodCode, bankCode].filter((c): c is string => !!c);
    const rows = await this.tx((tx) =>
      tx.catalogItem.findMany({
        where: { catalog: { in: [CatalogType.PAYMENT_METHOD, CatalogType.BANK] }, code: { in: codes }, deletedAt: null },
        select: { code: true, label: true },
      }),
    );
    return Object.fromEntries(rows.map((r) => [r.code, r.label]));
  }

  /**
   * Todo lo que el formulario de alta necesita de un cliente, en un round-trip: sus créditos
   * agendables (caso abierto y dentro del scope) + teléfonos y direcciones **en claro**.
   *
   * La PII se revela vía `ClientsService.findOne(id, true)`, que ya audita `PII_REVEAL`. Los casos
   * se consultan ANTES: si el cliente no tiene ninguno asignado, corta sin revelar nada.
   */
  /**
   * Casos abiertos del cliente que este usuario puede agendar. Es la puerta de scope del módulo:
   * si está vacía, el cliente no es suyo y no se le revela ni se le escribe nada.
   */
  private async agendableCases(clientId: string) {
    const openCases = await this.tx((tx) =>
      tx.collectionCase.findMany({
        where: { clientId, deletedAt: null, ...this.caseScope() },
        include: { credit: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const agendable = openCases.filter((c) => !isTerminal(c.status) && c.credit.deletedAt === null);
    if (agendable.length === 0) throw agendaClientWithoutCases();
    return agendable;
  }

  /**
   * Saldo impago de las cuotas **vencidas**, por crédito. Se calcula sobre `credit_installments`
   * y no sobre `arrears`, que es un snapshot con `calculatedAt` y puede estar desactualizado.
   */
  private async overdueByCredit(creditIds: string[]): Promise<Map<string, number>> {
    if (creditIds.length === 0) return new Map();
    const rows = await this.tx((tx) =>
      tx.creditInstallment.groupBy({
        by: ['creditId'],
        where: { creditId: { in: creditIds }, status: InstallmentStatus.OVERDUE },
        _sum: { amount: true, paidAmount: true },
      }),
    );
    return new Map(rows.map((r) => [r.creditId, Number(r._sum.amount ?? 0) - Number(r._sum.paidAmount ?? 0)]));
  }

  async clientContext(clientId: string) {
    const agendable = await this.agendableCases(clientId);
    const overdue = await this.overdueByCredit(agendable.map((c) => c.creditId));

    const client = await this.clients.findOne(clientId, true); // registra `PII_REVEAL` sobre `client`

    // Segundo rastro, propio del módulo: el cobrador NO tiene `client:pii:read` — esta es la única
    // puerta por la que ve teléfonos y direcciones en claro, y sólo para un cliente con caso suyo.
    // Sin esto, una auditoría no puede distinguir esta revelación de las del módulo de clientes.
    await this.audit.record({ entity: 'agenda_client_context', entityId: clientId, action: 'PII_REVEAL' });

    return ResponseDto.ok({
      client: { id: client.id, displayName: displayName(client), nationalId: client.nationalId },
      credits: agendable.map((c) => ({
        creditId: c.creditId,
        caseId: c.id,
        code: c.credit.code ?? undefined,
        principalAmount: Number(c.credit.principalAmount),
        outstandingBalance: Number(c.credit.outstandingBalance),
        /** Suma de las cuotas vencidas impagas. `0` si el crédito no tiene cronograma cargado. */
        overdueAmount: overdue.get(c.creditId) ?? 0,
        currency: c.credit.currency,
        daysPastDue: c.credit.daysPastDue,
      })),
      contacts: (client.contacts ?? []).map((c) => ({
        id: c.id,
        contactType: c.contactType,
        value: c.value,
        isPrimary: c.isPrimary,
      })),
      locations: (client.locations ?? []).map((l) => ({
        id: l.id,
        locationType: l.locationType,
        address: l.address,
        zone: l.zone,
        latitude: l.latitude,
        longitude: l.longitude,
      })),
    });
  }

  /**
   * Alta de un teléfono del cliente **desde el formulario de agendar** (el cobrador va a llamar a un
   * número que no está cargado). Va por `agenda:write` y no por `client:write`: agregar el contacto de
   * un deudor propio es parte de agendar, y el COLLECTOR no administra clientes. Mismo scope que el
   * contexto. El cifrado y el audit los hace `ClientsService.addContact` — acá no se escribe cripto.
   */
  async addClientContact(clientId: string, dto: AddClientContactDto) {
    await this.agendableCases(clientId);
    const created = await this.clients.addContact(clientId, dto);
    // `created.value` viene cifrado; se devuelve el valor que el cliente ya conoce (el que envió).
    return ResponseDto.ok({
      id: created.id,
      contactType: created.contactType,
      value: dto.value,
      isPrimary: created.isPrimary,
    });
  }

  /**
   * Alta de una dirección del cliente desde el formulario de agendar una visita. Mismas razones y
   * mismo scope que `addClientContact`. `ClientsService.addLocation` cifra la dirección y audita.
   */
  async addClientLocation(clientId: string, dto: AddClientLocationDto) {
    await this.agendableCases(clientId);
    const created = await this.clients.addLocation(clientId, dto);
    return ResponseDto.ok({
      id: created.id,
      locationType: created.locationType,
      address: dto.address, // `created.address` viene cifrado
      zone: created.zone ?? undefined,
      latitude: created.latitude != null ? Number(created.latitude) : undefined,
      longitude: created.longitude != null ? Number(created.longitude) : undefined,
    });
  }

  /** Alta de una gestión agendada (S2). Devuelve el ítem serializado → el móvil inserta sin refetch. */
  async create(dto: CreateAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const validated = validateAgendaDetails(dto.type, dto.details);
    if (!validated.ok) throw agendaInvalidDetails(validated.errors);

    const today = this.startOfTodayUTC();
    const scheduledDate = toUTCDate(dto.scheduledDate);
    if (scheduledDate < today) throw agendaPastDate();
    assertTimeMode(dto);

    const { created, clientName } = await this.tx(async (tx) => {
      const found = await tx.collectionCase.findFirst({
        where: { id: dto.caseId, deletedAt: null, ...this.caseScope() },
        include: { credit: true },
      });
      if (!found || isTerminal(found.status) || found.creditId !== dto.creditId) throw agendaCaseNotFound();

      await this.assertReferences(tx, dto.type, validated.value, found.clientId, found.credit, today);

      const created = await tx.agendaItem.create({
        data: {
          accountId: this.tenant.accountId,
          caseId: found.id,
          clientId: found.clientId,
          creditId: found.creditId,
          // El agendado es del cobrador DEL CASO, no de quien lo crea: un supervisor (AGENDA_ASSIGN)
          // agenda sobre casos ajenos, y `assigneeScope` los ocultaría del cobrador que debe ejecutarlos.
          // Sin asignado en el caso, queda para quien agenda. `userId` lo garantiza JwtAuthGuard.
          assigneeId: found.assigneeId ?? this.tenant.userId!,
          type: dto.type,
          scheduledDate,
          timeMode: dto.timeMode,
          scheduledTime: dto.timeMode === ScheduleTimeMode.FIXED ? dto.scheduledTime : null,
          timeSlot: dto.timeMode === ScheduleTimeMode.LAPSE ? dto.timeSlot : null,
          observations: dto.observations,
          details: validated.value as unknown as Prisma.InputJsonValue,
          createdBy: this.tenant.userId,
        },
      });
      const names = await this.clientNames(tx, [found.clientId]);
      return { created, clientName: names.get(found.clientId) };
    });

    await this.audit.record({ entity: 'agenda_item', entityId: created.id, action: 'CREATE', after: created });
    return ResponseDto.ok(serializeAgendaItem(created, clientName));
  }

  /**
   * Cruces que el validador puro no puede hacer: que el contacto/dirección sean del cliente del caso,
   * que la promesa no exceda el saldo y que el medio de pago (y su banco) existan en el catálogo del tenant.
   */
  private async assertReferences(
    tx: PrismaClient,
    type: AgendaItemType,
    details: AgendaDetails,
    clientId: string,
    credit: Credit,
    today: Date,
  ): Promise<void> {
    switch (type) {
      case AgendaItemType.CALL:
      case AgendaItemType.WHATSAPP: {
        const { contactId } = details as CallDetails | WhatsAppDetails;
        const contact = await tx.clientContact.findFirst({ where: { id: contactId, clientId }, select: { id: true } });
        if (!contact) throw agendaInvalidReference('El teléfono no pertenece al cliente');
        return;
      }
      case AgendaItemType.VISIT: {
        if (!('locationId' in details)) return; // dirección libre: no hay nada que cruzar
        const location = await tx.clientLocation.findFirst({
          where: { id: details.locationId, clientId },
          select: { id: true },
        });
        if (!location) throw agendaInvalidReference('La dirección no pertenece al cliente');
        return;
      }
      case AgendaItemType.PROMISE_TO_PAY: {
        const promise = details as PromiseToPayDetails;
        if (promise.amount > Number(credit.outstandingBalance)) {
          throw agendaInvalidReference('El monto prometido supera el saldo del crédito');
        }
        if (toUTCDate(promise.promiseDate) < today) throw agendaPastDate();
        await this.assertPaymentMethod(tx, promise);
        return;
      }
      case AgendaItemType.REMINDER:
        return;
    }
  }

  /** El medio de pago debe estar activo en el catálogo; si pide banco (`metadata.requiresBank`), debe venir y existir. */
  private async assertPaymentMethod(tx: PrismaClient, promise: PromiseToPayDetails): Promise<void> {
    const method = await this.activeCatalogItem(tx, CatalogType.PAYMENT_METHOD, promise.paymentMethodCode);
    if (!method) throw agendaInvalidReference('El medio de pago no existe o está inactivo');

    const requiresBank = (method.metadata as { requiresBank?: boolean } | null)?.requiresBank === true;
    if (requiresBank && !promise.bankCode) throw agendaInvalidReference('Este medio de pago requiere elegir un banco');
    if (promise.bankCode && !(await this.activeCatalogItem(tx, CatalogType.BANK, promise.bankCode))) {
      throw agendaInvalidReference('El banco no existe o está inactivo');
    }
  }

  private activeCatalogItem(tx: PrismaClient, catalog: CatalogType, code: string): Promise<CatalogItem | null> {
    return tx.catalogItem.findFirst({ where: { catalog, code, isActive: true, deletedAt: null } });
  }
}

/** `FIXED` exige hora exacta; `LAPSE` exige franja. Mezclarlos deja el agendado sin hora legible. */
function assertTimeMode(dto: CreateAgendaItemDto): void {
  if (dto.timeMode === ScheduleTimeMode.FIXED && !dto.scheduledTime) {
    throw agendaInvalidTimeMode('Con hora fija hay que indicar la hora (HH:mm)');
  }
  if (dto.timeMode === ScheduleTimeMode.LAPSE && !dto.timeSlot) {
    throw agendaInvalidTimeMode('Con lapso hay que elegir la franja horaria');
  }
}

/** Nombre visible del cliente ya serializado (persona o empresa). */
function displayName(client: { firstName?: string; lastName?: string; businessName?: string }): string {
  return client.businessName || [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
}

/** Hora de inicio de cada franja, para poder posponer un agendado que sólo tenía franja (no hora exacta). */
const SLOT_START_MINUTES: Record<string, number> = { MORNING: 8 * 60, AFTERNOON: 13 * 60, NIGHT: 18 * 60 };

/** Minutos-del-día de la hora agendada (naive): `scheduledTime` si hay, si no el inicio de la franja. */
function baseMinutes(item: { scheduledTime: string | null; timeSlot: string | null }): number {
  if (item.scheduledTime) {
    const [h, m] = item.scheduledTime.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }
  return SLOT_START_MINUTES[item.timeSlot ?? ''] ?? 9 * 60;
}

/** Suma minutos a una hora-de-pared; devuelve la hora `HH:mm` y cuántos días avanzó (cruce de medianoche). */
function shiftWallClock(base: number, add: number): { dayShift: number; time: string } {
  const total = base + add;
  const dayShift = Math.floor(total / 1440);
  const minInDay = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(minInDay / 60)).padStart(2, '0');
  const mm = String(minInDay % 60).padStart(2, '0');
  return { dayShift, time: `${hh}:${mm}` };
}

/** `scheduled_date` (`@db.Date`, medianoche UTC) + N días. */
function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

/** Con qué se ejecuta la gestión: el teléfono al que llamar o la dirección a la que ir. */
export interface AgendaTarget {
  phone?: string;
  address?: string;
  zone?: string;
  latitude?: number;
  longitude?: number;
}

interface RevealedClient {
  contacts?: { id: string; value: string | null }[];
  locations?: { id: string; address: string | null; zone?: string; latitude?: number; longitude?: number }[];
}

/**
 * Extrae del cliente revelado **sólo** la fila que `details` referencia — el resto de sus teléfonos y
 * direcciones no viaja al móvil. `REMINDER` y `PROMISE_TO_PAY` no tienen con qué contactar → sin target.
 */
function resolveTarget(type: AgendaItemType, details: AgendaDetails, client: RevealedClient): AgendaTarget | undefined {
  switch (type) {
    case AgendaItemType.CALL:
    case AgendaItemType.WHATSAPP: {
      const { contactId } = details as CallDetails | WhatsAppDetails;
      const phone = client.contacts?.find((c) => c.id === contactId)?.value;
      return phone ? { phone } : undefined;
    }
    case AgendaItemType.VISIT: {
      const visit = details as VisitDetails;
      // Dirección libre: la tipeó el cobrador al agendar, ya está en claro dentro de `details`.
      if ('customAddress' in visit) {
        const { address, zone } = visit.customAddress;
        return { address, zone };
      }
      const loc = client.locations?.find((l) => l.id === visit.locationId);
      if (!loc?.address) return undefined;
      return { address: loc.address, zone: loc.zone, latitude: loc.latitude, longitude: loc.longitude };
    }
    default:
      return undefined;
  }
}
