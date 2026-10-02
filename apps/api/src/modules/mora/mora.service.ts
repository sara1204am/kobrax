import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  Permission,
  computeRecoveryMetrics,
  resolvePagination,
  ResponseDto,
  validateRecoveryActivity,
  type RecoveryActivityError,
  staleAfterDaysOf,
  type ApiResponse,
  type MoraCaseLookup,
  type MoraCreditDetail,
  type MoraCreditListItem,
  type CreditNote,
  type MoraEpisode,
  type MoraPromise,
  type RecoveryMetrics,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { serializeActivity } from '../cases/cases.serializer';
import { CasesService } from '../cases/cases.service';
import type { CreateActivityDto } from '../cases/dto/case.dto';
import type { CreateMoraActivityDto, CreateMoraNoteDto, ListMoraQueryDto } from './dto/mora.dto';
import { buildMoraOrder, buildMoraWhere, MORA_FROM, moraAccessConditions, TERMINAL_CASE_STATUSES, type MoraScope } from './mora-query';
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

/** Cuántas gestiones trae la ficha. Es el historial del caso abierto; el completo llega con la sección de gestiones. */
const DETAIL_ACTIVITIES = 100;

/**
 * Central de Mora: **una fila por crédito**, con su caso abierto si lo tiene.
 *
 * Lo de antes (`GET /cases`) listaba casos, y un caso sólo existe si el trabajo diario lo abrió: un
 * crédito en mora sin cronograma, o importado con el reporte desactualizado, no aparecía. Acá el
 * crédito es la fila y el caso es un dato más.
 *
 * Los números (mora, monto vencido, prioridad) los calcula el backend —`creditView`, `computePriority`—:
 * ningún cliente los recalcula.
 */
@Injectable()
export class MoraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /**
   * El alcance sale de la **capacidad**, no del nombre del rol (igual que `CasesService`):
   *  - `case:write` sin `case:assign` (cobrador) → sólo sus casos;
   *  - `case:assign` (manager, supervisor, admins) → todo, y puede filtrar por cobrador;
   *  - sólo `case:read` (auditor, viewer) → todo, sin filtrar por cobrador.
   * Los créditos sin caso y los casos sin cobrador quedan, por construcción, fuera del alcance del cobrador.
   */
  private scope(): MoraScope {
    const canAssign = this.tenant.can(Permission.CASE_ASSIGN);
    return {
      accountId: this.tenant.accountId,
      userId: this.tenant.userId,
      ownOnly: this.tenant.can(Permission.CASE_WRITE) && !canAssign,
      canAssign,
    };
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
    const where = buildMoraWhere(query, this.scope(), new Date());
    const [row] = await this.tx((tx) => tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total ${MORA_FROM} WHERE ${where}`));
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
    const where = buildMoraWhere(query, this.scope(), now);
    const order = buildMoraOrder(query.sort, query.dir);

    return this.tx(async (tx) => {
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
      return { items: await this.loadItems(tx, found.map((r) => r.id), now), total: count };
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
      const found = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT cr.id ${MORA_FROM} WHERE ${access} LIMIT 1`);
      if (found.length === 0) return null;
      const [item] = await this.loadItems(tx, [creditId], now);
      if (!item) return null;
      const activities = item.case
        ? await tx.caseActivity.findMany({ where: { caseId: item.case.id }, orderBy: { createdAt: 'desc' }, take: DETAIL_ACTIVITIES })
        : [];
      return { ...item, activities: activities.map(serializeActivity) } as unknown as MoraCreditDetail;
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
      const found = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT cr.id ${MORA_FROM} WHERE ${access} LIMIT 1`);
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
    const [row] = await tx.$queryRaw<{ id: string; client_id: string }[]>(Prisma.sql`SELECT cr.id, cr.client_id ${MORA_FROM} WHERE ${access} LIMIT 1`);
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
      ? await tx.caseActivity.findMany({ where: { id: { in: activityIds } }, select: { id: true, result: true } })
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
        // Las gestiones de TODOS los casos del crédito: un caso cerrado y vuelto a abrir sigue siendo el mismo trabajo.
        tx.caseActivity.findMany({ where: { case: { creditId } }, select: { type: true, result: true, createdAt: true } }),
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
   *
   *  · **Valida con la regla de shared** (`validateRecoveryActivity`): el tipo, que el resultado corresponda, y
   *    que «promesa de pago» y los datos de la promesa vayan juntos.
   *  · **Mismo alcance que la ficha**: sobre un crédito que no puede ver, 404 y no se escribe nada.
   *  · **Si el crédito no tiene caso abierto, lo abre.** Sin caso no hay dónde colgar la gestión, y un crédito en
   *    mora sin caso (sin cronograma, o importado con el reporte viejo) es justo donde nadie estaba gestionando.
   *  · **Delega en `CasesService.addActivity`**: la promesa se vuelve un `agenda_item`, se actualiza la última
   *    gestión y se avisa al tablero — una sola lógica, no una copia.
   */
  async addActivity(creditId: string, dto: CreateMoraActivityDto): Promise<ApiResponse<{ id: string; type: string; createdAt: Date; caseId: string; caseOpened: boolean }>> {
    // Un día de margen: quien escribe en Bolivia a las 21:00 puede prometer «hoy» aunque en UTC ya sea mañana.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const invalid = validateRecoveryActivity(dto, yesterday);
    if (invalid) throw new BadRequestException({ code: `MORA_${invalid}`, message: ACTIVITY_ERRORS[invalid] });

    const existing = await this.tx(async (tx) => {
      if (!(await this.visible(tx, creditId))) throw new NotFoundException('Crédito no encontrado');
      return tx.collectionCase.findFirst({ where: { creditId, status: { notIn: TERMINAL_CASE_STATUSES as never }, deletedAt: null }, select: { id: true } });
    });

    let caseId = existing?.id;
    let caseOpened = false;
    if (!caseId) {
      try {
        caseId = (await this.cases.create({ creditId })).id;
        caseOpened = true;
      } catch (err) {
        // Dos personas gestionando a la vez: la otra abrió el caso primero. Se usa el suyo.
        const raced = await this.tx((tx) => tx.collectionCase.findFirst({ where: { creditId, status: { notIn: TERMINAL_CASE_STATUSES as never }, deletedAt: null }, select: { id: true } }));
        if (!raced) throw err;
        caseId = raced.id;
      }
    }

    const done = await this.cases.addActivity(caseId, {
      type: dto.type,
      result: dto.result,
      notes: dto.notes?.trim() || undefined,
      promise: dto.promise,
    } as CreateActivityDto);
    return ResponseDto.ok({ id: done.id, type: done.type, createdAt: done.createdAt, caseId, caseOpened });
  }

  /** Las notas de un crédito, la más reciente primero. Mismo alcance que la ficha. */
  async notes(creditId: string): Promise<ApiResponse<CreditNote[]>> {
    const rows = await this.tx(async (tx) => {
      if (!(await this.visible(tx, creditId))) return null;
      return tx.creditNote.findMany({ where: { creditId }, orderBy: { createdAt: 'desc' }, take: 200 });
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

    const { note, created } = await this.tx(async (tx) => {
      const credit = await this.visible(tx, creditId);
      if (!credit) throw new NotFoundException('Crédito no encontrado');
      if (dto.id) {
        const existing = await tx.creditNote.findFirst({ where: { id: dto.id } });
        if (existing) {
          if (existing.creditId !== creditId) throw new ConflictException({ code: 'MORA_003', message: 'Ese id de nota ya pertenece a otro crédito.' });
          return { note: existing, created: false };
        }
      }
      const made = await tx.creditNote.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          accountId: this.tenant.accountId,
          creditId,
          clientId: credit.clientId,
          authorId: this.tenant.userId,
          kind: dto.kind ?? 'INFO',
          body,
        },
      });
      return { note: made, created: true };
    });

    // Sólo se audita lo nuevo, y sin el texto: una nota puede traer datos personales.
    if (created) {
      await this.audit.record({ entity: 'credit_note', entityId: note.id, action: 'CREATE', after: { creditId, kind: note.kind, length: note.body.length } });
    }
    return ResponseDto.ok(serializeNote(note));
  }

  /**
   * A qué crédito pertenece un caso. Existe para que los enlaces viejos (`/mora/<caseId>`: notificaciones,
   * la bitácora del cliente) sigan abriendo: la ficha ahora es por crédito.
   */
  /** Las oficinas activas de la cuenta, para el filtro de la lista. Sólo id y nombre. */
  async branches(): Promise<ApiResponse<{ id: string; name: string }[]>> {
    const rows = await this.tx((tx) =>
      tx.branch.findMany({ where: { deletedAt: null, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    );
    return ResponseDto.ok(rows);
  }

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
   * Trae de Prisma lo que la lista y la ficha pintan y lo serializa, **en el orden de `ids`**: el orden lo
   * decidió el SQL y no se reordena por lo que devuelva `findMany`.
   */
  private async loadItems(tx: PrismaClient, ids: string[], now: Date): Promise<MoraCreditListItem[]> {
    if (ids.length === 0) return [];
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [rows, account] = await Promise.all([
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
          branchId: true,
          branch: { select: { name: true } },
          client: { select: { firstName: true, lastName: true, businessName: true } },
          installments: { select: { number: true, dueDate: true, amount: true, paidAmount: true, status: true } },
          cases: {
            where: { deletedAt: null, status: { notIn: TERMINAL_CASE_STATUSES as never } },
            take: 1,
            select: {
              id: true,
              status: true,
              priority: true,
              priorityPinnedAt: true,
              assigneeId: true,
              slaDueAt: true,
              lastActionAt: true,
              activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { type: true, result: true } },
            },
          },
          payments: { orderBy: { paymentDate: 'desc' }, take: 1, select: { paymentDate: true } },
        },
      }),
      tx.account.findUnique({ where: { id: this.tenant.accountId } }),
    ]);

    // Promesa vigente por cliente (misma definición que la lista de casos): una sola consulta para la página.
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
      .map((r) => serializeMoraCredit(r, { now, staleAfterDays, hasActivePromise: withPromise.has(r.clientId) }));
  }
}
