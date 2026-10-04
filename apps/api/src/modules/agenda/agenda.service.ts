import { Injectable } from '@nestjs/common';
import type { AgendaItem, CatalogItem, Credit, Prisma, PrismaClient } from '@prisma/client';
import { AgendaItemStatus, AgendaItemType, CatalogType, InstallmentStatus, ScheduleTimeMode } from '@prisma/client';
import {
  AGENDA_OUTCOMES_BY_TYPE,
  AgendaTimeSlot,
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
import { CreditActivityType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { TenantClockService } from '../../common/context/tenant-clock.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBusService } from '../../common/events/event-bus.service';
import { ClientsService } from '../clients/clients.service';
import { UpdateLocationDto } from '../clients/dto/client.dto';
import { isUniqueViolation } from '../../common/unique-violation';
import { moraScopeOf, visibleCredits } from '../mora/mora-query';
import { recordCreditActivity } from '../mora/credit-activity';
import { serializeAgendaItem } from './agenda.serializer';
import { recommendedSlot, type ContactHint } from './recommended-slot';
import {
  AddClientContactDto,
  AddClientLocationDto,
  CancelAgendaItemDto,
  CompleteAgendaItemDto,
  CreateAgendaItemDto,
  ListOverdueQueryDto,
  PostponeAgendaItemDto,
  RescheduleAgendaItemDto,
  UpdateAgendaItemDto,
} from './dto/agenda.dto';
import {
  agendaCaseNotFound,
  agendaClientWithoutCases,
  agendaInvalidDetails,
  agendaIdTaken,
  agendaInvalidOutcome,
  agendaInvalidReference,
  agendaInvalidTimeMode,
  agendaItemNotFound,
  agendaNotSchedulable,
  agendaPastDate,
} from './agenda.errors';

/** Al ejecutar un agendado, qué tipo de actividad queda en la bitácora del crédito. */
const ACTIVITY_TYPE_BY_AGENDA: Record<AgendaItemType, CreditActivityType> = {
  [AgendaItemType.CALL]: CreditActivityType.CALL,
  [AgendaItemType.VISIT]: CreditActivityType.VISIT,
  [AgendaItemType.WHATSAPP]: CreditActivityType.MESSAGE,
  [AgendaItemType.PROMISE_TO_PAY]: CreditActivityType.NOTE,
  [AgendaItemType.REMINDER]: CreditActivityType.NOTE,
};

/** Medianoche UTC de una fecha `YYYY-MM-DD` (así se persiste `scheduledDate`, columna `@db.Date`). */
function toUTCDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Gestiones agendadas: lectura (S1), alta (S2), detalle (S3), ejecutar/posponer (S4), editar (S5) y
 *  reagendar/cancelar/eliminar (S6). */
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
    private readonly events: EventBusService,
    private readonly clock: TenantClockService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /**
   * "Hoy" **para el tenant**, anclado a medianoche UTC como guarda `scheduledDate`.
   *
   * 🔴 Antes esto era el día UTC del servidor, y en toda América eso adelanta el calendario unas
   * horas antes de medianoche: en Bolivia, a las 20:00, la agenda del día se pintaba vencida y
   * agendar para hoy respondía «fecha pasada». Ahora lo decide la zona de la cuenta.
   */
  private today(): Promise<Date> {
    return this.clock.today();
  }

  /** Serializar una gestión suelta con el reloj del tenant puesto. Ahorra repetir el `await` siete veces. */
  private async view(a: AgendaItem, clientName?: string): Promise<ReturnType<typeof serializeAgendaItem>> {
    return serializeAgendaItem(a, clientName, await this.today());
  }

  /**
   * Scope por capacidad: sin `AGENDA_ASSIGN` (cobrador) solo ve SUS agendados. Con `AGENDA_ASSIGN` ve los de
   * los CRÉDITOS a su alcance (F4/08 · D8): el supervisor, los de su agencia; gerente y administrador (alcance
   * total), todo el tenant. Es el mismo alcance que la ficha de mora, no uno propio de la agenda.
   */
  private async assigneeScope(tx: PrismaClient): Promise<Prisma.AgendaItemWhereInput> {
    if (!this.tenant.can(Permission.AGENDA_ASSIGN)) return { assigneeId: this.tenant.userId };
    const scope = this.creditScope();
    if (scope.kind === 'ALL') return {};
    const visible = await visibleCredits(tx, scope, {});
    return { creditId: { in: visible.map((c) => c.id) } };
  }

  /** Sobre qué créditos puede agendar este usuario: el MISMO alcance que la ficha de mora (no se inventa otro). */
  private creditScope() {
    return moraScopeOf(this.tenant);
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

  /**
   * Agendados de un día, o **de un rango**.
   *
   * 🔴 El rango existe por la tira semanal y el calendario del mes: pintar cuántas gestiones tiene
   * cada día es una pregunta por 7 o por 31 días, y de a un día serían 31 llamadas para dibujar una
   * grilla. Con `from`/`to` es una.
   *
   * El día suelto (`date`) se queda: lo usa el teléfono, que sólo pide el día de hoy y no tiene por
   * qué cambiar. Es el mismo endpoint con un parámetro más, no uno nuevo.
   */
  async listByDay(query: { date?: string; from?: string; to?: string }): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>[]>> {
    const today = await this.today();
    const scheduledDate =
      query.from && query.to
        ? { gte: new Date(query.from), lte: new Date(query.to) }
        : (query.date ? new Date(query.date) : today);

    const { rows, names } = await this.tx(async (tx) => {
      const rows = await tx.agendaItem.findMany({
        where: { deletedAt: null, scheduledDate, ...(await this.assigneeScope(tx)) },
        orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }, { createdAt: 'asc' }],
      });
      return { rows, names: await this.clientNames(tx, rows.map((r) => r.clientId)) };
    });
    return ResponseDto.ok(rows.map((r) => serializeAgendaItem(r, names.get(r.clientId), today)));
  }

  /** Vencidos: SCHEDULED con fecha < hoy, desc por fecha, paginado (`meta.total` → "ver más"). */
  async listOverdue(query: ListOverdueQueryDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const today = await this.today();
    const { rows, total, names } = await this.tx(async (tx) => {
      const where: Prisma.AgendaItemWhereInput = {
        deletedAt: null,
        status: AgendaItemStatus.SCHEDULED,
        scheduledDate: { lt: today },
        ...(await this.assigneeScope(tx)),
      };
      const [rows, total] = await Promise.all([
        tx.agendaItem.findMany({ where, orderBy: { scheduledDate: 'desc' }, skip, take: limit }),
        tx.agendaItem.count({ where }),
      ]);
      return { rows, total, names: await this.clientNames(tx, rows.map((r) => r.clientId)) };
    });
    return ResponseDto.paginated(rows.map((r) => serializeAgendaItem(r, names.get(r.clientId), today)), total, page, limit);
  }

  /**
   * Detalle de una gestión agendada (S3): la gestión, el deudor con su CI en claro, el saldo del
   * crédito, el dato con el que se ejecuta (teléfono o dirección) y el historial del caso.
   *
   * Fuera de scope o soft-deleted → 404 (no filtra existencia). Revela PII en los 5 tipos y lo
   * audita: quien puede abrir el detalle de un deudor propio no gana superficie viendo su CI.
   */
  async findOne(id: string) {
    const today = await this.today();
    const { item, credit, history } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...(await this.assigneeScope(tx)) } });
      if (!item) throw agendaItemNotFound();
      const [credit, history] = await Promise.all([
        tx.credit.findFirst({ where: { id: item.creditId, deletedAt: null } }),
        // Sin `assigneeScope`: son gestiones del mismo crédito, y el ítem ya se validó como propio arriba.
        tx.agendaItem.findMany({
          where: { creditId: item.creditId, deletedAt: null, id: { not: id } },
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
      item: serializeAgendaItem(item, displayName(client), today),
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
      labels: await this.detailLabels(
        item.type,
        item.details as unknown as AgendaDetails,
        [item.reasonCode, ...history.map((h) => h.reasonCode)].filter((c): c is string => !!c),
      ),
      history: history.map((h) => {
        const s = serializeAgendaItem(h, undefined, today);
        return {
          id: s.id,
          type: s.type,
          status: s.status,
          scheduledDate: s.scheduledDate,
          isOverdue: s.isOverdue,
          // Con esto el móvil arma la cadena de reprogramaciones sin otra query (S6).
          reasonCode: s.reasonCode,
          rescheduledFromId: s.rescheduledFromId,
        };
      }),
    });
  }

  /**
   * Ejecuta una gestión (S4): deja un `CreditActivity` en la bitácora del crédito (con el episodio de mora
   * abierto, si lo hay), actualiza «última gestión», apunta el agendado a esa actividad y lo pasa a EXECUTED.
   * `outcome` debe corresponder al tipo. Registrar la gestión no cambia la situación del crédito.
   */
  async complete(id: string, dto: CompleteAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const { updated, clientName, replay } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...(await this.assigneeScope(tx)) } });
      if (!item) throw agendaItemNotFound();
      // Reintento de la cola offline: ya se ejecutó con ESE mismo resultado → se responde lo hecho, sin otra
      // actividad. Con otro resultado sigue siendo un conflicto.
      if (item.status === AgendaItemStatus.EXECUTED && item.resultActivityId) {
        const done = await tx.creditActivity.findFirst({ where: { id: item.resultActivityId }, select: { result: true } });
        if (done?.result === dto.outcome) {
          const names = await this.clientNames(tx, [item.clientId]);
          return { updated: item, clientName: names.get(item.clientId), replay: true };
        }
      }
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();
      if (!AGENDA_OUTCOMES_BY_TYPE[item.type].includes(dto.outcome)) throw agendaInvalidOutcome();

      const activity = await recordCreditActivity(tx, {
        accountId: this.tenant.accountId,
        creditId: item.creditId,
        clientId: item.clientId,
        userId: this.tenant.userId,
        type: ACTIVITY_TYPE_BY_AGENDA[item.type],
        result: dto.outcome,
        notes: dto.notes,
      });
      const updated = await tx.agendaItem.update({
        where: { id },
        data: { status: AgendaItemStatus.EXECUTED, resultActivityId: activity.id, updatedBy: this.tenant.userId },
      });
      const names = await this.clientNames(tx, [updated.clientId]);
      return { updated, clientName: names.get(updated.clientId), replay: false };
    });

    if (replay) return ResponseDto.ok(await this.view(updated, clientName));
    await this.audit.record({ entity: 'agenda_item', entityId: id, action: 'EXECUTE', after: updated });
    // Ya no se emite `case.updated`: no hay caso. El feed en vivo de supervisores era solo eso (sin persistir).
    return ResponseDto.ok(await this.view(updated, clientName));
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
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...(await this.assigneeScope(tx)) } });
      if (!item) throw agendaItemNotFound();
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();

      // `toTime` es absoluta: la hora QUEDA en ese valor, así que repetir el envío no la corre otra vez. `minutes`
      // (relativa) se mantiene para los clientes viejos.
      let dayShift = 0;
      let time: string;
      if (dto.toTime) {
        time = dto.toTime;
      } else if (dto.minutes !== undefined) {
        ({ dayShift, time } = shiftWallClock(baseMinutes(item), dto.minutes));
      } else {
        throw agendaInvalidTimeMode('Indicá la nueva hora (toTime) o los minutos a posponer');
      }
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
    return ResponseDto.ok(await this.view(updated, clientName));
  }

  /**
   * `details` guarda `code`s de catálogo; la pantalla necesita sus etiquetas ("Transferencia", "BNB")
   * en vez de `BANK_TRANSFER`. Sólo la promesa de pago los tiene.
   */
  private async detailLabels(
    type: AgendaItemType,
    details: AgendaDetails,
    /** Motivos de cancelación/reprogramación del ítem y de su historial (S6), para pintarlos con su etiqueta. */
    reasonCodes: string[] = [],
  ): Promise<Record<string, string> | undefined> {
    const promise = type === AgendaItemType.PROMISE_TO_PAY ? (details as PromiseToPayDetails) : undefined;
    const codes = [...new Set([promise?.paymentMethodCode, promise?.bankCode, ...reasonCodes].filter((c): c is string => !!c))];
    if (codes.length === 0) return undefined;
    const rows = await this.tx((tx) =>
      tx.catalogItem.findMany({
        where: {
          catalog: { in: [CatalogType.PAYMENT_METHOD, CatalogType.BANK, CatalogType.CANCEL_REASON, CatalogType.RESCHEDULE_REASON] },
          code: { in: codes },
          deletedAt: null,
        },
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
   * TODOS los créditos del cliente que este usuario puede ver (al día o en mora), con el mismo alcance que la
   * ficha de mora. Es la puerta de scope del módulo: si está vacía, el cliente no es suyo y no se le revela ni
   * se le escribe nada.
   */
  private async agendableCredits(clientId: string): Promise<Credit[]> {
    const credits = await this.tx(async (tx) => {
      const visible = await visibleCredits(tx, this.creditScope(), { clientId });
      if (visible.length === 0) return [];
      return tx.credit.findMany({ where: { id: { in: visible.map((v) => v.id) }, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    });
    if (credits.length === 0) throw agendaClientWithoutCases();
    return credits;
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
    const agendable = await this.agendableCredits(clientId);
    const overdue = await this.overdueByCredit(agendable.map((c) => c.id));
    const contactHint = await this.contactHint(clientId);

    const client = await this.clients.findOne(clientId, true); // registra `PII_REVEAL` sobre `client`

    // Segundo rastro, propio del módulo: el cobrador NO tiene `client:pii:read` — esta es la única
    // puerta por la que ve teléfonos y direcciones en claro, y sólo para un cliente con caso suyo.
    // Sin esto, una auditoría no puede distinguir esta revelación de las del módulo de clientes.
    await this.audit.record({ entity: 'agenda_client_context', entityId: clientId, action: 'PII_REVEAL' });

    return ResponseDto.ok({
      client: { id: client.id, displayName: displayName(client), nationalId: client.nationalId },
      credits: agendable.map((c) => ({
        creditId: c.id,
        code: c.code ?? undefined,
        principalAmount: Number(c.principalAmount),
        outstandingBalance: Number(c.outstandingBalance),
        /** Suma de las cuotas vencidas impagas. `0` si el crédito no tiene cronograma cargado. */
        overdueAmount: overdue.get(c.id) ?? 0,
        currency: c.currency,
        /** `0` = al día (acción preventiva); `> 0` = en mora. */
        daysPastDue: c.daysPastDue,
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
      /** En qué franja conviene buscarlo (Rutas S4). Ausente si el historial no alcanza. */
      contactHint,
    });
  }

  /**
   * La franja en la que a este deudor se le contactó efectivamente antes (Rutas S4 §5.3).
   *
   * «Contacto efectivo» = la gestión se ejecutó **y dejó una gestión real en la bitácora**
   * (`resultActivityId`). Una agendada que se marcó ejecutada sin producir nada no prueba que el
   * deudor estuviera del otro lado. La regla de conteo es pura y vive en `recommendedSlot`.
   */
  private async contactHint(clientId: string): Promise<ContactHint | undefined> {
    const executed = await this.tx(async (tx) =>
      tx.agendaItem.findMany({
        where: {
          clientId,
          deletedAt: null,
          status: AgendaItemStatus.EXECUTED,
          resultActivityId: { not: null },
          ...(await this.assigneeScope(tx)),
        },
        select: { timeSlot: true, scheduledTime: true },
      }),
    );
    return recommendedSlot(executed);
  }

  /**
   * Alta de un teléfono del cliente **desde el formulario de agendar** (el cobrador va a llamar a un
   * número que no está cargado). Va por `agenda:write` y no por `client:write`: agregar el contacto de
   * un deudor propio es parte de agendar, y el COLLECTOR no administra clientes. Mismo scope que el
   * contexto. El cifrado y el audit los hace `ClientsService.addContact` — acá no se escribe cripto.
   */
  async addClientContact(clientId: string, dto: AddClientContactDto) {
    await this.agendableCredits(clientId);
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
    await this.agendableCredits(clientId);
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

  /**
   * Corrige una dirección que el cliente ya tenía — típicamente marcarle el punto en el mapa a una
   * dirección importada, que llega sin coordenadas. Mismo scope que el alta: sólo clientes con un caso
   * del cobrador.
   */
  async updateClientLocation(clientId: string, locationId: string, dto: UpdateLocationDto) {
    await this.agendableCredits(clientId);
    const updated = await this.clients.updateLocation(clientId, locationId, dto);
    return ResponseDto.ok({
      id: updated.id,
      locationType: updated.locationType,
      address: dto.address, // `updated.address` viene cifrado
      zone: updated.zone ?? undefined,
      latitude: updated.latitude != null ? Number(updated.latitude) : undefined,
      longitude: updated.longitude != null ? Number(updated.longitude) : undefined,
    });
  }

  /** Alta de una gestión agendada (S2). Devuelve el ítem serializado → el móvil inserta sin refetch. */
  async create(dto: CreateAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    // Idempotente por `id` (cola offline del móvil). Dos envíos a la vez pasan los dos el chequeo y uno choca con la
    // PK: se repite UNA vez y esta vez el chequeo encuentra el que guardó el otro.
    return this.createOnce(dto).catch((err: unknown) => (dto.id && isUniqueViolation(err) ? this.createOnce(dto) : Promise.reject(err)));
  }

  private async createOnce(dto: CreateAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    // Reintento: ya entró con ese id. Se responde lo guardado ANTES de validar la fecha (un reintento días después
    // de haberse creado offline no puede fallar por «fecha pasada») y sin crear otro recordatorio ni otra auditoría.
    if (dto.id) {
      const prev = await this.tx(async (tx) => {
        const item = await tx.agendaItem.findFirst({ where: { id: dto.id } });
        if (!item) return null;
        if (item.deletedAt || item.creditId !== dto.creditId) throw agendaIdTaken();
        const names = await this.clientNames(tx, [item.clientId]);
        return { item, clientName: names.get(item.clientId) };
      });
      if (prev) return ResponseDto.ok(await this.view(prev.item, prev.clientName));
    }

    const validated = validateAgendaDetails(dto.type, dto.details);
    if (!validated.ok) throw agendaInvalidDetails(validated.errors);

    const today = await this.today();
    const scheduledDate = toUTCDate(dto.scheduledDate);
    if (scheduledDate < today) throw agendaPastDate();
    assertTimeMode(dto);

    const { created, reminder, clientName } = await this.tx(async (tx) => {
      // Por crédito, esté al día o en mora: sin caso. Mismo alcance que la ficha de mora; fuera de alcance → 404.
      const [visible] = await visibleCredits(tx, this.creditScope(), { creditId: dto.creditId });
      const credit = visible ? await tx.credit.findFirst({ where: { id: dto.creditId, deletedAt: null } }) : null;
      if (!credit) throw agendaCaseNotFound();

      await this.assertReferences(tx, dto.type, validated.value, credit.clientId, credit, today);

      const { created, reminder } = await this.insertItem(tx, {
        id: dto.id,
        credit,
        type: dto.type,
        scheduledDate,
        timeMode: dto.timeMode,
        scheduledTime: dto.timeMode === ScheduleTimeMode.FIXED ? dto.scheduledTime : null,
        timeSlot: dto.timeMode === ScheduleTimeMode.LAPSE ? dto.timeSlot : null,
        observations: dto.observations,
        details: validated.value,
      });
      const names = await this.clientNames(tx, [credit.clientId]);
      return { created, reminder, clientName: names.get(credit.clientId) };
    });

    await this.recordCreated(created, reminder);
    return ResponseDto.ok(await this.view(created, clientName));
  }

  /** Auditoría del alta de un agendado y, si lo hubo, de su recordatorio. Fuera de la transacción, como el resto. */
  async recordCreated(created: AgendaItem, reminder?: AgendaItem | null): Promise<void> {
    await this.audit.record({ entity: 'agenda_item', entityId: created.id, action: 'CREATE', after: created });
    if (reminder) await this.audit.record({ entity: 'agenda_item', entityId: reminder.id, action: 'CREATE', after: reminder });
  }

  /**
   * **La única forma de crear una promesa de pago** (F4/08): la usan `POST /agenda` y «Registrar acción» (mora).
   * Valida los datos con la regla de shared, el monto (tope = saldo, **salvo en créditos externos/PSF**, donde el
   * saldo reportado puede ser solo capital), el medio de pago y el banco contra el catálogo; crea el recordatorio
   * de 24 h si corresponde; hora fija sin hora exacta; asignada al **responsable del crédito** (o a quien la
   * registra si no tiene). Corre dentro de la transacción de quien llama, que audita con `recordCreated`.
   */
  async createPromiseItem(
    tx: PrismaClient,
    input: { creditId: string; details: unknown; id?: string; observations?: string },
  ): Promise<{ created: AgendaItem; reminder: AgendaItem | null }> {
    const credit = await tx.credit.findFirst({ where: { id: input.creditId, deletedAt: null } });
    if (!credit) throw agendaCaseNotFound();
    const validated = validateAgendaDetails(AgendaItemType.PROMISE_TO_PAY, input.details);
    if (!validated.ok) throw agendaInvalidDetails(validated.errors);

    const today = await this.today();
    await this.assertReferences(tx, AgendaItemType.PROMISE_TO_PAY, validated.value, credit.clientId, credit, today);
    return this.insertItem(tx, {
      id: input.id,
      credit,
      type: AgendaItemType.PROMISE_TO_PAY,
      scheduledDate: toUTCDate((validated.value as PromiseToPayDetails).promiseDate),
      timeMode: ScheduleTimeMode.FIXED,
      scheduledTime: null,
      timeSlot: null,
      observations: input.observations,
      details: validated.value,
    });
  }

  /** Inserta el agendado (y el recordatorio de la promesa). Todo agendado nace asignado al responsable del crédito. */
  private async insertItem(
    tx: PrismaClient,
    p: {
      id?: string;
      credit: Credit;
      type: AgendaItemType;
      scheduledDate: Date;
      timeMode: ScheduleTimeMode;
      scheduledTime?: string | null;
      timeSlot?: string | null;
      observations?: string;
      details: AgendaDetails;
    },
  ): Promise<{ created: AgendaItem; reminder: AgendaItem | null }> {
    const created = await tx.agendaItem.create({
      data: {
        ...(p.id ? { id: p.id } : {}),
        accountId: this.tenant.accountId,
        clientId: p.credit.clientId,
        creditId: p.credit.id,
        // El agendado es del RESPONSABLE del crédito, no de quien lo crea: un supervisor agenda sobre créditos
        // ajenos, y `assigneeScope` los ocultaría del cobrador que debe ejecutarlos. Sin responsable, queda para
        // quien agenda. `userId` lo garantiza JwtAuthGuard.
        assigneeId: p.credit.assignedManagerId ?? this.tenant.userId!,
        type: p.type,
        scheduledDate: p.scheduledDate,
        timeMode: p.timeMode,
        scheduledTime: p.timeMode === ScheduleTimeMode.FIXED ? (p.scheduledTime ?? null) : null,
        timeSlot: p.timeMode === ScheduleTimeMode.LAPSE ? (p.timeSlot ?? null) : null,
        observations: p.observations,
        details: p.details as unknown as Prisma.InputJsonValue,
        createdBy: this.tenant.userId,
      },
    });
    const reminder = await this.promiseReminder(tx, created, p.scheduledDate);
    return { created, reminder };
  }

  /**
   * El recordatorio de la promesa (Rutas S5 · D2). El sheet de RT-6 promete al cobrador que "se
   * generará un recordatorio automático 24h antes": esto es ese recordatorio, hecho con la agenda
   * que ya existe en vez de con infraestructura de notificaciones nueva.
   *
   * Devuelve `null` cuando no corresponde: si la promesa es para mañana o antes, el recordatorio
   * caería hoy o en el pasado — y un recordatorio en el pasado no le recuerda nada a nadie.
   */
  private async promiseReminder(tx: PrismaClient, promise: AgendaItem, scheduledDate: Date) {
    if (promise.type !== AgendaItemType.PROMISE_TO_PAY) return null;

    const dayBefore = new Date(scheduledDate);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    if (dayBefore <= (await this.today())) return null;

    return tx.agendaItem.create({
      data: {
        accountId: this.tenant.accountId,
        caseId: promise.caseId,
        clientId: promise.clientId,
        creditId: promise.creditId,
        // Del MISMO cobrador que la promesa: es él quien tiene que acordarse, no quien la cargó.
        assigneeId: promise.assigneeId,
        type: AgendaItemType.REMINDER,
        scheduledDate: dayBefore,
        timeMode: ScheduleTimeMode.LAPSE,
        timeSlot: AgendaTimeSlot.MORNING,
        details: { description: 'Recordar la promesa de pago de mañana' },
        createdBy: this.tenant.userId,
      },
    });
  }

  /**
   * Edita una gestión pendiente (S5): tipo, campos propios, observaciones y **hora**. La fecha no:
   * mover el día es reagendar y deja rastro (§D5 del plan). El deudor tampoco: es el ancla del agendado.
   */
  async update(id: string, dto: UpdateAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const { before, updated, clientName } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...(await this.assigneeScope(tx)) } });
      if (!item) throw agendaItemNotFound();
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();

      const data: Prisma.AgendaItemUpdateInput = { updatedBy: this.tenant.userId };

      // Tipo y `details` son un par: el `contactId` de una llamada no sirve para una visita, así que
      // cualquiera de los dos que cambie revalida la combinación completa.
      if (dto.type !== undefined || dto.details !== undefined) {
        const type = dto.type ?? item.type;
        const raw = dto.details ?? (item.details as Record<string, unknown>);
        const validated = validateAgendaDetails(type, raw);
        if (!validated.ok) throw agendaInvalidDetails(validated.errors);

        const credit = await tx.credit.findFirst({ where: { id: item.creditId } });
        if (!credit) throw agendaCaseNotFound();
        await this.assertReferences(tx, type, validated.value, item.clientId, credit, await this.today());

        data.type = type;
        data.details = validated.value as unknown as Prisma.InputJsonValue;
      }

      // La hora se valida sobre la combinación resultante, no sobre el parche: mandar sólo
      // `timeMode: LAPSE` sin franja tiene que fallar aunque el ítem guardado tuviera hora fija.
      if (dto.timeMode !== undefined || dto.scheduledTime !== undefined || dto.timeSlot !== undefined) {
        const timeMode = dto.timeMode ?? item.timeMode;
        const scheduledTime = dto.scheduledTime ?? item.scheduledTime;
        const timeSlot = dto.timeSlot ?? item.timeSlot;
        assertTimeMode({ timeMode, scheduledTime, timeSlot });
        data.timeMode = timeMode;
        // Se normaliza igual que en el alta: el modo que gana limpia el campo del otro.
        data.scheduledTime = timeMode === ScheduleTimeMode.FIXED ? scheduledTime : null;
        data.timeSlot = timeMode === ScheduleTimeMode.LAPSE ? timeSlot : null;
      }

      if (dto.observations !== undefined) data.observations = dto.observations;

      const updated = await tx.agendaItem.update({ where: { id }, data });
      const names = await this.clientNames(tx, [updated.clientId]);
      return { before: item, updated, clientName: names.get(updated.clientId) };
    });

    await this.audit.record({ entity: 'agenda_item', entityId: id, action: 'UPDATE', before, after: updated });
    return ResponseDto.ok(await this.view(updated, clientName));
  }

  /**
   * Cancela una gestión pendiente (S6): no se hizo y no se va a hacer. Queda visible en el día y en el
   * historial del caso — para que desaparezca está eliminar. El motivo sale del catálogo del tenant.
   */
  async cancel(id: string, dto: CancelAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const { updated, clientName } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...(await this.assigneeScope(tx)) } });
      if (!item) throw agendaItemNotFound();
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();

      const reason = await this.activeCatalogItem(tx, CatalogType.CANCEL_REASON, dto.reasonCode);
      if (!reason) throw agendaInvalidReference('El motivo de cancelación no existe o está inactivo');

      const updated = await tx.agendaItem.update({
        where: { id },
        data: { status: AgendaItemStatus.CANCELLED, reasonCode: reason.code, updatedBy: this.tenant.userId },
      });
      const names = await this.clientNames(tx, [updated.clientId]);
      return { updated, clientName: names.get(updated.clientId) };
    });

    await this.audit.record({ entity: 'agenda_item', entityId: id, action: 'CANCEL', after: updated });
    return ResponseDto.ok(await this.view(updated, clientName));
  }

  /**
   * Reagenda a otro día (S6): cierra la original como RESCHEDULED con su motivo y crea una nueva con la
   * fecha pedida, apuntando a la anterior. Así el historial del caso muestra la cadena completa —
   * posponer (S4) mueve la hora del mismo ítem; reagendar deja rastro.
   *
   * Devuelve **el ítem nuevo**: es el que el cobrador va a ejecutar.
   */
  async reschedule(id: string, dto: RescheduleAgendaItemDto): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const today = await this.today();
    const scheduledDate = toUTCDate(dto.scheduledDate);
    if (scheduledDate < today) throw agendaPastDate();
    assertTimeMode(dto);

    const { created, previousId, clientName } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...(await this.assigneeScope(tx)) } });
      if (!item) throw agendaItemNotFound();
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();

      const reason = await this.activeCatalogItem(tx, CatalogType.RESCHEDULE_REASON, dto.reasonCode);
      if (!reason) throw agendaInvalidReference('El motivo de reprogramación no existe o está inactivo');

      const created = await tx.agendaItem.create({
        data: {
          accountId: this.tenant.accountId,
          caseId: item.caseId,
          clientId: item.clientId,
          creditId: item.creditId,
          // Se copia del original, NO se recalcula: si un supervisor reagenda, la gestión tiene que
          // seguir siendo del cobrador que la va a ejecutar (misma lección que el alta de S2).
          assigneeId: item.assigneeId,
          type: item.type,
          scheduledDate,
          timeMode: dto.timeMode,
          scheduledTime: dto.timeMode === ScheduleTimeMode.FIXED ? dto.scheduledTime : null,
          timeSlot: dto.timeMode === ScheduleTimeMode.LAPSE ? dto.timeSlot : null,
          observations: item.observations,
          details: item.details as Prisma.InputJsonValue,
          rescheduledFromId: item.id,
          createdBy: this.tenant.userId,
        },
      });
      await tx.agendaItem.update({
        where: { id },
        data: { status: AgendaItemStatus.RESCHEDULED, reasonCode: reason.code, updatedBy: this.tenant.userId },
      });
      const names = await this.clientNames(tx, [created.clientId]);
      return { created, previousId: item.id, clientName: names.get(created.clientId) };
    });

    await this.audit.record({ entity: 'agenda_item', entityId: previousId, action: 'RESCHEDULE', after: created });
    await this.audit.record({ entity: 'agenda_item', entityId: created.id, action: 'CREATE', after: created });
    return ResponseDto.ok(await this.view(created, clientName));
  }

  /**
   * Elimina una gestión pendiente (S6): soft-delete, para la que no debió existir (se cargó al cliente
   * equivocado). Una ya ejecutada no se borra — tiene un `CaseActivity` colgando en la bitácora del caso.
   *
   * Responde 200 con el ítem, no 204: `apiMutate` del móvil trata el 204 como error.
   */
  async remove(id: string): Promise<ApiResponse<ReturnType<typeof serializeAgendaItem>>> {
    const { before, updated, clientName } = await this.tx(async (tx) => {
      const item = await tx.agendaItem.findFirst({ where: { id, deletedAt: null, ...(await this.assigneeScope(tx)) } });
      if (!item) throw agendaItemNotFound();
      if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();

      const updated = await tx.agendaItem.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: this.tenant.userId },
      });
      const names = await this.clientNames(tx, [updated.clientId]);
      return { before: item, updated, clientName: names.get(updated.clientId) };
    });

    await this.audit.record({ entity: 'agenda_item', entityId: id, action: 'DELETE', before });
    return ResponseDto.ok(await this.view(updated, clientName));
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
        // Tope = saldo, SOLO en créditos de Kobrax: en uno externo (PSF) el saldo reportado puede ser solo capital
        // y lo que realmente se debe es mayor, así que no se puede afirmar que el monto «supera el saldo».
        if (credit.externalSource === null && promise.amount > Number(credit.outstandingBalance)) {
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

/**
 * `FIXED` exige hora exacta; `LAPSE` exige franja. Mezclarlos deja el agendado sin hora legible.
 *
 * Firma estructural (no `CreateAgendaItemDto`) porque la comparten el alta, la edición y el reagendado;
 * la edición además la llama con la combinación *resultante* de mezclar el parche con lo guardado.
 */
function assertTimeMode(schedule: { timeMode: ScheduleTimeMode; scheduledTime?: string | null; timeSlot?: string | null }): void {
  if (schedule.timeMode === ScheduleTimeMode.FIXED && !schedule.scheduledTime) {
    throw agendaInvalidTimeMode('Con hora fija hay que indicar la hora (HH:mm)');
  }
  if (schedule.timeMode === ScheduleTimeMode.LAPSE && !schedule.timeSlot) {
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
