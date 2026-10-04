import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AgendaItemStatus, Prisma, type CreditActivityType, type PrismaClient } from '@prisma/client';
import {
  Permission,
  cascadePosition,
  clampNoteBox,
  NOTE_BOARD_LIMITS,
  computeRecoveryMetrics,
  resolvePagination,
  ResponseDto,
  validateRecoveryActivity,
  type RecoveryActivityError,
  staleAfterDaysOf,
  type ApiResponse,
  type MoraAssignment,
  type MoraCaseLookup,
  type MoraCreditDetail,
  type MoraCreditListItem,
  type CreditAssignmentKind,
  type CreditNote,
  type MoraEpisode,
  type MoraPromise,
  type RecoveryMetrics,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AgendaService } from '../agenda/agenda.service';
import { agendaNotSchedulable } from '../agenda/agenda.errors';
import { ArrearsPriorityService } from '../arrears/arrears-priority.service';
import type { CreateMoraActivityDto, CreateMoraNoteDto, ListMoraQueryDto, SetMoraPriorityDto, UpdateMoraNoteDto } from './dto/mora.dto';
import { recordCreditActivity, serializeCreditActivity } from './credit-activity';
import { buildMoraOrder, buildMoraWhere, MORA_ACCESS_FROM, MORA_FROM, moraAccessConditions, moraScopeOf, type MoraCategoryRange, type MoraScope } from './mora-query';
import { serializeEpisodes } from './mora-episodes';
import { serializeNote } from './mora-notes';
import { serializePromises } from './mora-promises';
import { serializeMoraCredit, type MoraCreditRow } from './mora.serializer';

/** Lo que se le dice a quien registra una gestión inválida (el panel valida antes con la misma regla). */
const ACTIVITY_ERRORS: Record<RecoveryActivityError, string> = {
  TYPE_INVALID: 'Ese tipo de gestión no se registra a mano.',
  NOTES_REQUIRED: 'Una nota necesita texto.',
  NOTES_TOO_LONG: 'La observación es demasiado larga (máximo 1.000 caracteres).',
  RESULT_REQUIRED: 'Falta el resultado de la gestión.',
  RESULT_NOT_ALLOWED: 'Ese resultado no corresponde a este tipo de gestión.',
  PROMISE_REQUIRED: 'Una promesa de pago necesita monto, fecha y medio de pago.',
  PROMISE_NOT_ALLOWED: 'Sólo una gestión con resultado «promesa de pago» lleva los datos de la promesa.',
  PROMISE_AMOUNT_INVALID: 'El monto prometido tiene que ser mayor a cero.',
  PROMISE_DATE_INVALID: 'La fecha prometida no es válida.',
  PROMISE_DATE_PAST: 'La fecha prometida no puede ser anterior a hoy.',
  PROMISE_METHOD_REQUIRED: 'Falta el medio de pago de la promesa.',
};

/** Cuántas gestiones trae la ficha. Es la bitácora del crédito; el completo llega con la sección de gestiones. */
const DETAIL_ACTIVITIES = 100;

/**
 * Central de Mora: **una fila por crédito**, sin caso (F4/08).
 *
 * La situación (al día / en mora) sale del episodio abierto, la prioridad es la de ese episodio, el responsable
 * es el del crédito y la categoría de mora se calcula con los rangos de la cuenta.
 *
 * Los números (mora, monto vencido, prioridad, categoría) los calcula el backend —`creditView`,
 * `computePriority`, `categoryForDays`—: ningún cliente los recalcula.
 */
@Injectable()
export class MoraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly agenda: AgendaService,
    private readonly arrearsPriority: ArrearsPriorityService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /**
   * El alcance sale del **alcance de datos** del rol, no de su nombre (D8):
   *  - `data:scope:all` (gerente, administradores, auditor, lector) → todo;
   *  - `data:scope:branch` (supervisor) → los créditos con responsable de su agencia + los suyos;
   *  - ninguno (cobrador) → lo que tiene a su cargo (responsable, temporal o apoyo).
   * Un crédito sin responsable sólo lo ve el alcance total.
   */
  private scope(): MoraScope {
    return moraScopeOf(this.tenant);
  }

  async list(query: ListMoraQueryDto): Promise<ApiResponse<MoraCreditListItem[]>> {
    const { page, limit, skip } = resolvePagination(query);
    const { items, total } = await this.page(query, limit, skip, page);
    return ResponseDto.paginated(items, total, page, limit);
  }

  /** ¿Quién descarga? Para el alcance del export y para decir en el PDF de qué es. */
  exportScope(): MoraScope {
    return this.scope();
  }

  /**
   * Cuántos créditos devuelve este filtro, sin traerlos. El export lo pregunta **antes** de empezar a escribir:
   * una vez que el primer byte salió ya no se puede contestar con un error, y un archivo cortado a la mitad
   * se ve completo.
   */
  async count(query: ListMoraQueryDto): Promise<number> {
    const now = new Date();
    const [row] = await this.tx(async (tx) => {
      const where = buildMoraWhere(query, this.scope(), now, await this.loadCategories(tx));
      return tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total ${MORA_FROM} WHERE ${where}`);
    });
    return Number(row?.total ?? 0);
  }

  /**
   * Todo lo que el filtro devuelve, en el mismo orden que la pantalla, de a `size` filas. Cada lote es su
   * propia transacción: un export de decenas de miles no mantiene una abierta todo el tiempo.
   *
   * El orden cierra con `id`, así que `OFFSET` no repite ni saltea filas entre lotes.
   */
  async *batches(query: ListMoraQueryDto, size = 1000): AsyncGenerator<MoraCreditListItem[]> {
    for (let skip = 0; ; skip += size) {
      const { items } = await this.page(query, size, skip, 1, false);
      if (items.length === 0) return;
      yield items;
      if (items.length < size) return;
    }
  }

  private async page(
    query: ListMoraQueryDto,
    limit: number,
    skip: number,
    page: number,
    withTotal = true,
  ): Promise<{ items: MoraCreditListItem[]; total: number }> {
    const now = new Date();
    const order = buildMoraOrder(query.sort, query.dir);

    return this.tx(async (tx) => {
      // Las categorías de la cuenta se leen UNA vez por petición: sirven al filtro y a cada fila.
      const categories = await this.loadCategories(tx);
      const where = buildMoraWhere(query, this.scope(), now, categories);
      const found = await tx.$queryRaw<{ id: string; total: bigint }[]>(Prisma.sql`
        SELECT cr.id, COUNT(*) OVER() AS total
        ${MORA_FROM}
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${skip}`);

      // Una página más allá del final no devuelve filas y, con ellas, tampoco el total: se pide aparte.
      let count = found[0] ? Number(found[0].total) : 0;
      if (withTotal && found.length === 0 && page > 1) {
        const [row] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total ${MORA_FROM} WHERE ${where}`);
        count = Number(row?.total ?? 0);
      }
      return { items: await this.loadItems(tx, found.map((r) => r.id), now, categories), total: count };
    });
  }

  /**
   * La ficha de un crédito.
   *
   * 🔴 **Mismo alcance que la lista, y 404 —no 403— cuando no se puede ver.** Un cobrador que adivina el
   * id de un crédito ajeno recibe lo mismo que si no existiera: la diferencia entre «no es tuyo» y «no
   * existe» ya es información. Y a diferencia de la lista, la ficha no exige estar en mora: un crédito
   * que acaba de saldarse se puede seguir abriendo desde su historial.
   */
  async findOne(creditId: string): Promise<ApiResponse<MoraCreditDetail>> {
    const now = new Date();
    const access = Prisma.join([...moraAccessConditions(this.scope()), Prisma.sql`cr.id = ${creditId}`], ' AND ');

    const detail = await this.tx(async (tx) => {
      const found = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT cr.id ${MORA_ACCESS_FROM} WHERE ${access} LIMIT 1`);
      if (found.length === 0) return null;
      const [item] = await this.loadItems(tx, [creditId], now);
      if (!item) return null;
      // La bitácora es del crédito (preventiva o en mora), con el episodio indicado cuando lo hay.
      const activities = await tx.creditActivity.findMany({ where: { creditId }, orderBy: { createdAt: 'desc' }, take: DETAIL_ACTIVITIES });
      const assignments = await this.loadAssignments(tx, creditId, item.responsibleId, now);
      return { ...item, activities: activities.map(serializeCreditActivity), assignments } as unknown as MoraCreditDetail;
    });

    if (!detail) throw new NotFoundException('Crédito no encontrado');
    return ResponseDto.ok(detail);
  }

  /**
   * El historial de mora de un crédito: sus episodios, del más reciente al más antiguo.
   *
   * Mismo alcance que la ficha (404 si no se puede ver). Los escribe un trigger sobre `credits`
   * (`credit_arrear_episodes`), así que cubren cualquier vía por la que cambie la mora.
   */
  async episodes(creditId: string): Promise<ApiResponse<MoraEpisode[]>> {
    const access = Prisma.join([...moraAccessConditions(this.scope()), Prisma.sql`cr.id = ${creditId}`], ' AND ');
    const rows = await this.tx(async (tx) => {
      const found = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT cr.id ${MORA_ACCESS_FROM} WHERE ${access} LIMIT 1`);
      if (found.length === 0) return null;
      return tx.creditArrearEpisode.findMany({ where: { creditId }, orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }] });
    });
    if (!rows) throw new NotFoundException('Crédito no encontrado');
    return ResponseDto.ok(serializeEpisodes(rows));
  }

  /**
   * ¿Este crédito se puede ver? Mismo alcance que la ficha: **404 y no 403**, para no confirmar que existe.
   * Devuelve `clientId` porque las notas lo guardan.
   */
  private async visible(tx: PrismaClient, creditId: string): Promise<{ clientId: string } | null> {
    const access = Prisma.join([...moraAccessConditions(this.scope()), Prisma.sql`cr.id = ${creditId}`], ' AND ');
    const [row] = await tx.$queryRaw<{ id: string; client_id: string }[]>(Prisma.sql`SELECT cr.id, cr.client_id ${MORA_ACCESS_FROM} WHERE ${access} LIMIT 1`);
    return row ? { clientId: row.client_id } : null;
  }

  /**
   * Las promesas de pago de un crédito, con su estado (vigente, vencida, cumplida, incumplida…).
   *
   * Viven en `agenda_items` (`PROMISE_TO_PAY`); el desenlace sale de la gestión que las ejecutó. Mismo alcance
   * que la ficha.
   */
  async promises(creditId: string): Promise<ApiResponse<MoraPromise[]>> {
    const now = new Date();
    const result = await this.tx(async (tx) => ((await this.visible(tx, creditId)) ? this.loadPromises(tx, creditId, now) : null));
    if (!result) throw new NotFoundException('Crédito no encontrado');
    return ResponseDto.ok(result);
  }

  /** Las promesas de un crédito con su estado. Lo usan `promises` y `metrics`: una sola definición. */
  private async loadPromises(tx: PrismaClient, creditId: string, now: Date): Promise<MoraPromise[]> {
    const rows = await tx.agendaItem.findMany({
      where: { creditId, type: 'PROMISE_TO_PAY', deletedAt: null },
      select: { id: true, status: true, scheduledDate: true, details: true, observations: true, assigneeId: true, resultActivityId: true, createdAt: true },
    });
    const activityIds = rows.map((r) => r.resultActivityId).filter((id): id is string => !!id);
    const activities = activityIds.length
      ? await tx.creditActivity.findMany({ where: { id: { in: activityIds } }, select: { id: true, result: true } })
      : [];
    const outcomes = new Map(activities.filter((a) => a.result).map((a) => [a.id, a.result as string]));
    return serializePromises(rows, outcomes, now);
  }

  /**
   * Las métricas de recuperación del crédito: gestiones, contactos, promesas, plata recuperada y cuánto se tardó en
   * llegar al primer contacto, a la primera visita y al primer pago.
   *
   * Se miden **sobre la mora actual** (desde que abrió su episodio). Todo se calcula en `computeRecoveryMetrics`
   * (shared): acá sólo se traen los datos. Mismo alcance que la ficha.
   */
  async metrics(creditId: string): Promise<ApiResponse<RecoveryMetrics>> {
    const now = new Date();
    const metrics = await this.tx(async (tx) => {
      if (!(await this.visible(tx, creditId))) return null;
      const [episodeRows, activities, payments, promises] = await Promise.all([
        tx.creditArrearEpisode.findMany({ where: { creditId }, orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }] }),
        // Todas las gestiones del crédito (la bitácora ya es por crédito, no por caso).
        tx.creditActivity.findMany({ where: { creditId }, select: { type: true, result: true, createdAt: true } }),
        tx.payment.findMany({ where: { creditId }, select: { amount: true, paymentDate: true, channel: true } }),
        this.loadPromises(tx, creditId, now),
      ]);
      const episodes = serializeEpisodes(episodeRows, now);
      const open = episodes.find((e) => e.current);
      // La última mora que terminó **recuperada**: pagó o se puso al día. Que la fuente dejara de reportarla no cuenta.
      const recovered = episodes.find((e) => !e.current && (e.endReason === 'PAID' || e.endReason === 'CURRENT'));
      // Desde cuándo REGISTRA Kobrax esta mora: cuando se abrió el episodio (no cuando empezó, que puede ser mucho antes).
      const openRow = episodeRows.find((r) => r.endedAt === null);
      return computeRecoveryMetrics({
        now,
        episode: open
          ? { startedAt: open.startedAt, startedAtEstimated: open.startedAtEstimated, balanceAtStart: open.balanceAtStart, trackedSince: openRow?.createdAt.toISOString().slice(0, 10) }
          : undefined,
        lastRecoveredDays: recovered?.durationDays,
        activities,
        payments: payments.map((p) => ({ amount: Number(p.amount), paymentDate: p.paymentDate, channel: p.channel })),
        promises,
      });
    });
    if (!metrics) throw new NotFoundException('Crédito no encontrado');
    return ResponseDto.ok(metrics);
  }

  /**
   * Registrar una gestión (llamada, visita, mensaje o nota) con su resultado y, si prometió pagar, su promesa.
   * **Por crédito, esté al día o en mora: ya no abre ni usa un caso** (F4/08).
   *
   *  · **Valida con la regla de shared** (`validateRecoveryActivity`): el tipo, que el resultado corresponda, y
   *    que «promesa de pago» y los datos de la promesa vayan juntos.
   *  · **Mismo alcance que la ficha**: sobre un crédito que no puede ver, 404 y no se escribe nada.
   *  · Escribe `credit_activities`, ligada al episodio de mora ABIERTO (o a ninguno si está al día) y actualiza
   *    `credits.last_action_at` (solo informativo).
   *  · La promesa se crea con `AgendaService.createPromiseItem`: la misma función que `POST /agenda`.
   *  · `agendaItemId` opcional: marca ejecutada esa gestión agendada (del mismo crédito) en la misma transacción.
   */
  async addActivity(creditId: string, dto: CreateMoraActivityDto): Promise<ApiResponse<{ id: string; type: string; createdAt: Date; episodeId: string | null }>> {
    const replay = (prev: { id: string; type: string; createdAt: Date; episodeId: string | null }) =>
      ResponseDto.ok({ id: prev.id, type: prev.type, createdAt: prev.createdAt, episodeId: prev.episodeId });

    // Reintento del móvil: la gestión ya entró con ese id. Se responde lo guardado y no se escribe nada más.
    if (dto.id) {
      const prev = await this.tx(async (tx) => {
        if (!(await this.visible(tx, creditId))) throw new NotFoundException('Crédito no encontrado');
        return tx.creditActivity.findFirst({ where: { id: dto.id }, select: { id: true, type: true, createdAt: true, creditId: true, episodeId: true } });
      });
      if (prev) {
        if (prev.creditId !== creditId) throw new ConflictException({ code: 'MORA_004', message: 'Ese id de gestión ya pertenece a otro crédito.' });
        return replay(prev);
      }
    }

    // Un día de margen: quien escribe en Bolivia a las 21:00 puede prometer «hoy» aunque en UTC ya sea mañana.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const invalid = validateRecoveryActivity(dto, yesterday);
    if (invalid) throw new BadRequestException({ code: `MORA_${invalid}`, message: ACTIVITY_ERRORS[invalid] });

    try {
      const done = await this.tx(async (tx) => {
        const credit = await this.visible(tx, creditId);
        if (!credit) throw new NotFoundException('Crédito no encontrado');

        // La gestión agendada que esta actividad cumple: del mismo crédito y todavía pendiente.
        let toExecute: { id: string } | null = null;
        if (dto.agendaItemId) {
          const item = await tx.agendaItem.findFirst({ where: { id: dto.agendaItemId, deletedAt: null } });
          if (!item || item.creditId !== creditId) {
            throw new BadRequestException({ code: 'MORA_006', message: 'Esa gestión agendada no pertenece a este crédito.' });
          }
          // Ya ejecutada con ESTA misma actividad: nada que hacer. Con otra, o cancelada, es un conflicto.
          const sameActivity = item.status === AgendaItemStatus.EXECUTED && !!dto.id && item.resultActivityId === dto.id;
          if (!sameActivity) {
            if (item.status !== AgendaItemStatus.SCHEDULED) throw agendaNotSchedulable();
            toExecute = item;
          }
        }

        const activity = await recordCreditActivity(tx, {
          id: dto.id,
          accountId: this.tenant.accountId,
          creditId,
          clientId: credit.clientId,
          userId: this.tenant.userId,
          type: dto.type as CreditActivityType,
          result: dto.result,
          notes: dto.notes?.trim() || undefined,
        });
        const promise = dto.promise
          ? await this.agenda.createPromiseItem(tx, { creditId, details: { amount: dto.promise.amount, promiseDate: dto.promise.promiseDate, paymentMethodCode: dto.promise.paymentMethodCode, bankCode: dto.promise.bankCode } })
          : null;
        const executed = toExecute
          ? await tx.agendaItem.update({ where: { id: toExecute.id }, data: { status: AgendaItemStatus.EXECUTED, resultActivityId: activity.id, updatedBy: this.tenant.userId } })
          : null;
        return { activity, promise, executed };
      });

      if (done.promise) await this.agenda.recordCreated(done.promise.created, done.promise.reminder);
      if (done.executed) await this.audit.record({ entity: 'agenda_item', entityId: done.executed.id, action: 'EXECUTE', after: done.executed });
      return replay(done.activity);
    } catch (err) {
      // Misma carrera que en la nota: el otro envío con este id ya la guardó. Se devuelve esa, no un 500.
      if (dto.id && isUniqueViolation(err)) {
        const prev = await this.tx((tx) => tx.creditActivity.findFirst({ where: { id: dto.id }, select: { id: true, type: true, createdAt: true, episodeId: true } }));
        if (prev) return replay(prev);
      }
      throw err;
    }
  }

  /**
   * Fija la prioridad del **episodio de mora abierto** a mano, o la suelta (`priority: null`). Mientras esté fijada
   * el recálculo no la pisa; al soltarla se recalcula en el acto. Un crédito al día no tiene prioridad (409).
   * Mismo alcance que la ficha; se audita antes/después.
   */
  async setPriority(creditId: string, dto: SetMoraPriorityDto): Promise<ApiResponse<{ creditId: string; episodeId: string; priority: string | null; pinned: boolean }>> {
    const { episode, before, after } = await this.tx(async (tx) => {
      if (!(await this.visible(tx, creditId))) throw new NotFoundException('Crédito no encontrado');
      const open = await tx.creditArrearEpisode.findFirst({ where: { creditId, endedAt: null }, orderBy: { startedAt: 'desc' } });
      if (!open) throw new ConflictException({ code: 'MORA_007', message: 'El crédito está al día: no tiene prioridad de mora.' });

      let next = open;
      if (dto.priority === null) {
        await tx.creditArrearEpisode.update({ where: { id: open.id }, data: { priorityPinnedAt: null } });
        await this.arrearsPriority.recomputeForCredit(tx, creditId);
        next = (await tx.creditArrearEpisode.findFirst({ where: { id: open.id } })) ?? open;
      } else {
        next = await tx.creditArrearEpisode.update({ where: { id: open.id }, data: { priority: dto.priority, priorityPinnedAt: new Date() } });
      }
      return { episode: open, before: open, after: next };
    });

    await this.audit.record({
      entity: 'credit_arrear_episode',
      entityId: episode.id,
      action: dto.priority === null ? 'PRIORITY_AUTO' : 'PRIORITY_PIN',
      before: { creditId, priority: before.priority, pinned: before.priorityPinnedAt !== null },
      after: { creditId, priority: after.priority, pinned: after.priorityPinnedAt !== null },
    });
    return ResponseDto.ok({ creditId, episodeId: episode.id, priority: after.priority, pinned: after.priorityPinnedAt !== null });
  }

  /** Las notas de un crédito, la más reciente primero. Mismo alcance que la ficha. */
  async notes(creditId: string): Promise<ApiResponse<CreditNote[]>> {
    const rows = await this.tx(async (tx) => {
      if (!(await this.visible(tx, creditId))) return null;
      return tx.creditNote.findMany({ where: { creditId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 });
    });
    if (!rows) throw new NotFoundException('Crédito no encontrado');
    return ResponseDto.ok(rows.map(serializeNote));
  }

  /**
   * Escribe una nota. Quien la escribe tiene que poder **ver** el crédito (un cobrador sólo escribe sobre los
   * suyos). Es **idempotente por `id`**: el móvil escribe sin red y reintenta, y repetir el mismo id devuelve la
   * nota ya guardada en vez de duplicarla. Un id que ya es de otro crédito es un conflicto, no una nota nueva.
   */
  async addNote(creditId: string, dto: CreateMoraNoteDto): Promise<ApiResponse<CreditNote>> {
    const body = dto.body.trim();
    if (body.length === 0) throw new BadRequestException({ code: 'MORA_002', message: 'La nota no puede estar vacía.' });

    const run = () => this.tx(async (tx) => {
      const credit = await this.visible(tx, creditId);
      if (!credit) throw new NotFoundException('Crédito no encontrado');
      if (dto.id) {
        const existing = await tx.creditNote.findFirst({ where: { id: dto.id } });
        if (existing) {
          if (existing.creditId !== creditId) throw new ConflictException({ code: 'MORA_003', message: 'Ese id de nota ya pertenece a otro crédito.' });
          return { note: existing, created: false };
        }
      }
      // Sin lugar, en cascada según cuántas hay; siempre encima de las demás.
      const live = { creditId, deletedAt: null };
      const [count, top] = await Promise.all([tx.creditNote.count({ where: live }), tx.creditNote.aggregate({ where: live, _max: { zIndex: true } })]);
      const spot = cascadePosition(count);
      const box = clampNoteBox({ x: dto.x ?? spot.x, y: dto.y ?? spot.y, w: dto.w ?? NOTE_BOARD_LIMITS.defaultWidth, h: dto.h ?? NOTE_BOARD_LIMITS.defaultHeight });
      const made = await tx.creditNote.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          accountId: this.tenant.accountId,
          creditId,
          clientId: credit.clientId,
          authorId: this.tenant.userId,
          kind: dto.kind ?? 'INFO',
          body,
          color: dto.color ?? 'YELLOW',
          anchor: dto.anchor ?? 'PAGE',
          posX: box.x,
          posY: box.y,
          width: box.w,
          height: box.h,
          zIndex: (top._max.zIndex ?? 0) + 1,
        },
      });
      return { note: made, created: true };
    });
    // Dos envíos con el mismo id a la vez (el intento en vivo y la cola) pasan los dos el chequeo y uno choca con
    // la unicidad: se repite UNA vez, y esta vez encuentra la nota que ya guardó el otro.
    const { note, created } = await run().catch((err: unknown) => (dto.id && isUniqueViolation(err) ? run() : Promise.reject(err)));

    // Sólo se audita lo nuevo, y sin el texto: una nota puede traer datos personales.
    if (created) {
      await this.audit.record({ entity: 'credit_note', entityId: note.id, action: 'CREATE', after: { creditId, kind: note.kind, length: note.body.length } });
    }
    return ResponseDto.ok(serializeNote(note));
  }

  /** El texto, el tipo y el borrado son de quien escribió la nota o de quien reparte cartera. Mover y pintar, de cualquiera. */
  private canEditNote(note: { authorId: string | null }): boolean {
    return (note.authorId !== null && note.authorId === this.tenant.userId) || this.tenant.can(Permission.ASSIGNMENT_WRITE);
  }

  /**
   * Edita un post-it. Cambiar el **texto o el tipo** lo hace quien la escribió o quien reparte cartera (403 si no);
   * mover, redimensionar, pintar y traer al frente, cualquiera con `collection:write` que vea el crédito, porque es
   * ordenar el tablero y no tocar lo que la nota dice. Sólo se audita el cambio de contenido, y sin el texto.
   */
  async updateNote(creditId: string, noteId: string, dto: UpdateMoraNoteDto): Promise<ApiResponse<CreditNote>> {
    const body = dto.body?.trim();
    if (body !== undefined && body.length === 0) throw new BadRequestException({ code: 'MORA_002', message: 'La nota no puede estar vacía.' });
    const content = body !== undefined || dto.kind !== undefined;

    const { note, before, changed } = await this.tx(async (tx) => {
      if (!(await this.visible(tx, creditId))) throw new NotFoundException('Crédito no encontrado');
      const current = await tx.creditNote.findFirst({ where: { id: noteId, creditId, deletedAt: null } });
      if (!current) throw new NotFoundException('Nota no encontrada');
      if (content && !this.canEditNote(current)) {
        throw new ForbiddenException({ code: 'MORA_005', message: 'Sólo quien escribió la nota o quien reparte cartera puede cambiar su texto.' });
      }

      const data: Prisma.CreditNoteUncheckedUpdateInput = {};
      if (body !== undefined) data.body = body;
      if (dto.kind !== undefined) data.kind = dto.kind;
      if (dto.color !== undefined) data.color = dto.color;
      if (dto.anchor !== undefined) data.anchor = dto.anchor;
      if (dto.x !== undefined || dto.y !== undefined || dto.w !== undefined || dto.h !== undefined) {
        const box = clampNoteBox({ x: dto.x ?? current.posX, y: dto.y ?? current.posY, w: dto.w ?? current.width, h: dto.h ?? current.height });
        Object.assign(data, { posX: box.x, posY: box.y, width: box.w, height: box.h });
      }
      if (dto.front) {
        const top = await tx.creditNote.aggregate({ where: { creditId, deletedAt: null }, _max: { zIndex: true } });
        // Ya está arriba de todo: no se escribe otra vez (arrastrar una nota manda esto en cada gesto).
        if (current.zIndex < (top._max.zIndex ?? 0) || (top._max.zIndex ?? 0) === 0) data.zIndex = (top._max.zIndex ?? 0) + 1;
      }
      if (Object.keys(data).length === 0) return { note: current, before: current, changed: false };
      return { note: await tx.creditNote.update({ where: { id: noteId }, data }), before: current, changed: true };
    });

    if (content && changed) {
      await this.audit.record({
        entity: 'credit_note',
        entityId: noteId,
        action: 'UPDATE',
        before: { kind: before.kind, length: before.body.length },
        after: { creditId, kind: note.kind, length: note.body.length },
      });
    }
    return ResponseDto.ok(serializeNote(note));
  }

  /** Borra un post-it (borrado lógico: queda en la base y en la auditoría). Quien la escribió o quien reparte cartera. */
  async deleteNote(creditId: string, noteId: string): Promise<ApiResponse<{ id: string }>> {
    const gone = await this.tx(async (tx) => {
      if (!(await this.visible(tx, creditId))) throw new NotFoundException('Crédito no encontrado');
      const current = await tx.creditNote.findFirst({ where: { id: noteId, creditId, deletedAt: null } });
      if (!current) throw new NotFoundException('Nota no encontrada');
      if (!this.canEditNote(current)) {
        throw new ForbiddenException({ code: 'MORA_005', message: 'Sólo quien escribió la nota o quien reparte cartera puede borrarla.' });
      }
      await tx.creditNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
      return current;
    });
    await this.audit.record({ entity: 'credit_note', entityId: noteId, action: 'DELETE', before: { creditId, kind: gone.kind, length: gone.body.length } });
    return ResponseDto.ok({ id: noteId });
  }

  /** Las oficinas activas de la cuenta, para el filtro de la lista. Sólo id y nombre. */
  async branches(): Promise<ApiResponse<{ id: string; name: string }[]>> {
    const rows = await this.tx((tx) =>
      tx.branch.findMany({ where: { deletedAt: null, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    );
    return ResponseDto.ok(rows);
  }

  /**
   * A qué crédito pertenece un caso. Existe para que los enlaces viejos (`/mora/<caseId>`: notificaciones,
   * la bitácora del cliente) sigan abriendo: la ficha ahora es por crédito.
   */
  async byCase(caseId: string): Promise<ApiResponse<MoraCaseLookup>> {
    const scope = this.scope();
    const row = await this.tx((tx) =>
      tx.collectionCase.findFirst({ where: { id: caseId, deletedAt: null }, select: { creditId: true, assigneeId: true } }),
    );
    // Mismo alcance que `GET /cases/:id`: el cobrador sólo abre los casos que tiene asignados.
    if (!row || (scope.ownOnly && row.assigneeId !== scope.userId)) throw new NotFoundException('Caso no encontrado');
    return ResponseDto.ok({ creditId: row.creditId });
  }

  /**
   * Las categorías de mora de la cuenta (rangos, color y nombre), ordenadas. Una consulta por petición.
   * Sin categorías configuradas el resultado es vacío y `category` simplemente no aparece.
   */
  private async loadCategories(tx: PrismaClient): Promise<MoraCategoryRange[]> {
    const rows = await tx.arrearCategory.findMany({ where: { accountId: this.tenant.accountId }, orderBy: [{ sortOrder: 'asc' }, { fromDays: 'asc' }] });
    return rows.map((r) => ({ code: r.code, name: r.name, color: r.color, fromDays: r.fromDays, toDays: r.toDays }));
  }

  /**
   * Quién atiende el crédito: el responsable (PRINCIPAL) y, vigentes, los reemplazos temporales y las ayudas.
   * El responsable sale de `credits.assigned_manager_id` (la fuente de verdad): la fila PRINCIPAL de
   * `credit_assignments` no se repite.
   */
  private async loadAssignments(tx: PrismaClient, creditId: string, responsibleId: string | undefined, now: Date): Promise<MoraAssignment[]> {
    const rows = await tx.creditAssignment.findMany({
      where: { creditId, revokedAt: null, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], kind: { in: ['TEMPORAL', 'APOYO'] } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, kind: true, userId: true, expiresAt: true },
    });
    const principal: MoraAssignment[] = responsibleId ? [{ kind: 'PRINCIPAL', userId: responsibleId }] : [];
    return [
      ...principal,
      ...rows.map((r) => ({ id: r.id, kind: r.kind as CreditAssignmentKind, userId: r.userId, expiresAt: r.expiresAt?.toISOString() })),
    ];
  }

  /**
   * Trae de Prisma lo que la lista y la ficha pintan y lo serializa, **en el orden de `ids`**: el orden lo
   * decidió el SQL y no se reordena por lo que devuelva `findMany`.
   */
  private async loadItems(tx: PrismaClient, ids: string[], now: Date, knownCategories?: MoraCategoryRange[]): Promise<MoraCreditListItem[]> {
    if (ids.length === 0) return [];
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [rows, account, categories] = await Promise.all([
      tx.credit.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          code: true,
          clientId: true,
          currency: true,
          outstandingBalance: true,
          principalAmount: true,
          daysPastDue: true,
          metadata: true,
          origin: true,
          externalSource: true,
          syncStatus: true,
          reportedAsOf: true,
          absentSince: true,
          writtenOffAt: true,
          lastActionAt: true,
          assignedManagerId: true,
          branchId: true,
          branch: { select: { name: true } },
          client: { select: { firstName: true, lastName: true, businessName: true } },
          installments: { select: { number: true, dueDate: true, amount: true, paidAmount: true, status: true } },
          // El episodio ABIERTO (único por crédito): de él salen la situación y la prioridad.
          arrearEpisodes: { where: { endedAt: null }, take: 1, select: { priority: true, priorityPinnedAt: true } },
          activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { type: true, result: true } },
          payments: { orderBy: { paymentDate: 'desc' }, take: 1, select: { paymentDate: true } },
        },
      }),
      tx.account.findUnique({ where: { id: this.tenant.accountId } }),
      knownCategories ? Promise.resolve(knownCategories) : this.loadCategories(tx),
    ]);

    // Promesa vigente por cliente: una sola consulta para la página.
    const promises = await tx.agendaItem.findMany({
      where: {
        clientId: { in: [...new Set(rows.map((r) => r.clientId))] },
        deletedAt: null,
        type: 'PROMISE_TO_PAY',
        status: 'SCHEDULED',
        scheduledDate: { gte: startOfToday },
      },
      select: { clientId: true },
    });
    const withPromise = new Set(promises.map((p) => p.clientId));
    const staleAfterDays = staleAfterDaysOf(
      (account?.configuration as { importConfig?: { staleAfterDays?: unknown } } | null)?.importConfig?.staleAfterDays,
    );

    const byId = new Map(rows.map((r) => [r.id, r as unknown as MoraCreditRow]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is MoraCreditRow => r !== undefined)
      .map((r) => serializeMoraCredit(r, { now, staleAfterDays, hasActivePromise: withPromise.has(r.clientId), categories }));
  }
}

/** Violación de unicidad de Prisma (P2002): otro envío escribió esa fila primero. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code === 'P2002' : (err as { code?: string } | null)?.code === 'P2002';
}
