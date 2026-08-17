import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CaseStatus, CreditStatus, type PrismaClient } from '@prisma/client';
import { arrearsFromDueDate, arrearsSourceOf, manualArrears, readCreditMetadata } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { computePriority, slaDueAt, DEFAULT_PRIORITY_PARAMS, type PriorityParams } from '../cases/case-priority';
import { computeArrears, DEFAULT_ARREAR_PARAMS, type ArrearParams } from '../credits/credit-math';
import { closeOpenCases, openCaseIfNone } from './case-lifecycle';

/** Cada cuánto barre. Diario en la práctica; corre más seguido para que un reinicio no lo saltee. */
export const ARREARS_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Créditos por transacción. Chico a propósito: cada escritura dispara el trigger de la cartera. */
export const ARREARS_BATCH = 200;

/**
 * Tope de la transacción de cada lote.
 *
 * 🔴 Prisma le pone **5 segundos** a una transacción interactiva, y sobre la cartera de desarrollo
 * —301.547 créditos— un lote los pasaba y el job moría con «Transaction already closed». No es señal
 * de una consulta mal escrita: es una tarea de sistema recorriendo la cartera entera, sin nadie
 * esperando del otro lado. Se sube acá y **sólo acá**; un request que tarde cinco segundos sigue
 * siendo un problema de la consulta.
 */
export const ARREARS_TX_TIMEOUT_MS = 60_000;

const TERMINAL: CaseStatus[] = [CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF];

interface ArrearsConfig {
  priority: PriorityParams;
  arrears: ArrearParams;
  minDaysPastDue: number;
}

export interface ArrearsRunResult {
  /** Créditos a los que les cambió el número de días. */
  updated: number;
  opened: number;
  closed: number;
  /** Casos abiertos a los que les cambió la prioridad (y con ella su lugar en la ruta). */
  reprioritized: number;
}

const EMPTY: ArrearsRunResult = { updated: 0, opened: 0, closed: 0, reprioritized: 0 };

/**
 * El trabajo diario de la mora: **la pieza que hacía falta para que Cobranza se llene y se vacíe sola**.
 *
 * Hasta ahora `daysPastDue` sólo cambiaba si alguien tipeaba un número, importaba un archivo o
 * llamaba a mano a `recalculate-arrears` — que no llamaba nadie. Un crédito vencido ayer se quedaba
 * en cero para siempre, el caso no se abría, y cuando el deudor pagaba el caso quedaba abierto.
 *
 * Hace cuatro cosas por crédito activo, y ninguna es una decisión: las cuatro son consecuencia del dato.
 *
 * 1. Pone al día los días de mora **según de quién sea** (`arrearsSourceOf`). El importado no se
 *    toca: su archivo manda hasta la próxima carga. El manual se deriva de `moraSince`, así que el
 *    job vuelve a calcular la misma función y nunca puede cambiar la respuesta de quien la marcó.
 * 2. Abre el caso al cruzar `minDaysPastDue` (default 1 = «al primer día de vencido»).
 * 3. Lo cierra cuando el saldo llega a cero (`PAID`) o cuando la mora vuelve a cero (`CURRENT`).
 * 4. Recalcula la prioridad de los que siguen abiertos — **es lo que ordena las paradas de la ruta**,
 *    y hasta ahora se fijaba al abrir el caso y no se tocaba nunca más: un caso que abrió con un día
 *    seguía en prioridad baja con doscientos.
 *
 * 🔴 **No notifica.** Abrir un caso por la vía normal emite `CASE_UPDATED`, que hace fan-out a todas
 * las supervisoras; la primera pasada sobre cartera histórica sería una avalancha de avisos por algo
 * que nadie hizo hoy. El job escribe y la pantalla lo muestra.
 *
 * Como tarea de sistema enumera los tenants vivos y escanea cada uno bajo su RLS, igual que
 * `PromiseDueService`. Es idempotente: correrlo dos veces en el mismo día no cambia nada.
 */
@Injectable()
export class ArrearsJobService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ArrearsJobService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), ARREARS_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref(); // no bloquea el apagado
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Barre todos los tenants vivos. Resiliente: un fallo en uno no detiene los demás. */
  async run(asOf: Date = new Date()): Promise<ArrearsRunResult> {
    let accountIds: string[];
    try {
      /*
       * La misma función que usa `PromiseDueService`. El nombre quedó de aquel job, pero lo que hace
       * es «los tenants vivos» y nada más — duplicarla con otro nombre sería una segunda función
       * SECURITY DEFINER idéntica y otra migración que aplicar a mano contra un Postgres real.
       */
      const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM promise_due_account_ids()`;
      accountIds = rows.map((r) => r.account_id);
    } catch (err) {
      this.logger.warn(`promise_due_account_ids() no disponible (aplica prisma/rls/004) — mora no recalculada: ${this.msg(err)}`);
      return { ...EMPTY };
    }

    const total = { ...EMPTY };
    for (const accountId of accountIds) {
      try {
        const r = await this.scanAccount(accountId, asOf);
        total.updated += r.updated;
        total.opened += r.opened;
        total.closed += r.closed;
        total.reprioritized += r.reprioritized;
      } catch (err) {
        this.logger.error(`Mora falló en tenant ${accountId}: ${this.msg(err)}`);
      }
    }
    if (total.opened || total.closed) {
      this.logger.log(`Mora: ${total.opened} casos abiertos, ${total.closed} cerrados, ${total.updated} créditos actualizados`);
    }
    return total;
  }

  /**
   * Un tenant, **por lotes**.
   *
   * 🔴 No es optimización prematura: en la base de desarrollo esta cuenta tiene **300.010 créditos
   * activos**. Traerlos de una los carga enteros en memoria y mantiene abierta una transacción que
   * escribe cientos de miles de filas —con el trigger de denormalización disparándose en cada una—
   * mientras el resto de la API espera. Con lotes, cada transacción es corta y la memoria no crece.
   *
   * Cortar en lotes no rompe nada porque el job es **idempotente y por crédito**: no hay invariante
   * que cruce dos créditos, así que un lote a medias no deja nada inconsistente.
   */
  async scanAccount(accountId: string, asOf: Date = new Date()): Promise<ArrearsRunResult> {
    const params = await this.prisma.withTenant(accountId, (tx) => this.config(tx));
    const out = { ...EMPTY };
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.withTenant(
        accountId,
        (tx) => this.scanBatch(tx, accountId, asOf, params, cursor),
        ARREARS_TX_TIMEOUT_MS,
      );
      out.updated += batch.result.updated;
      out.opened += batch.result.opened;
      out.closed += batch.result.closed;
      out.reprioritized += batch.result.reprioritized;
      if (!batch.next) return out;
      cursor = batch.next;
    }
  }

  /** Un lote de créditos, en su propia transacción. Devuelve el último id visto para seguir. */
  private async scanBatch(
    tx: PrismaClient,
    accountId: string,
    asOf: Date,
    { priority: priorityParams, arrears: arrearParams, minDaysPastDue }: ArrearsConfig,
    cursor?: string,
  ): Promise<{ result: ArrearsRunResult; next?: string }> {
    const credits = await tx.credit.findMany({
      where: { status: CreditStatus.ACTIVE, deletedAt: null },
      select: {
        id: true,
        clientId: true,
        branchId: true,
        outstandingBalance: true,
        daysPastDue: true,
        metadata: true,
        assignedManagerId: true,
        client: { select: { riskSegment: true } },
        installments: { select: { id: true, dueDate: true, amount: true, paidAmount: true, status: true } },
      },
      orderBy: { id: 'asc' },
      take: ARREARS_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (credits.length === 0) return { result: { ...EMPTY } };

    // Un solo viaje por los casos abiertos DEL LOTE: preguntarlos de a uno sería una query por crédito.
    const openCases = await tx.collectionCase.findMany({
      where: { creditId: { in: credits.map((c) => c.id) }, status: { notIn: TERMINAL }, deletedAt: null },
      select: { id: true, creditId: true, priority: true, priorityPinnedAt: true },
    });
    const openByCredit = new Map(openCases.map((c) => [c.creditId, c]));

    const out = { ...EMPTY };
    {
      for (const credit of credits) {
        const balance = Number(credit.outstandingBalance);
        const days = this.arrearsFor(credit, arrearParams, asOf);

        /*
         * 🔴 **Si no se sabe de dónde sale la mora, el job no toca ese crédito. Ni la mora, ni el caso.**
         *
         * Un crédito sin cronograma, sin próxima fecha, sin marca a mano y sin archivo detrás tiene un
         * número de días que no se puede explicar. Escribirle cero borra el dato de alguien; abrirle un
         * caso pone a cobrar algo que nadie puede fechar. En la base de desarrollo son **199.427
         * créditos** —el lote sintético del benchmark— y sin esta guarda la primera pasada abría
         * 199.421 casos y dejaba Mora inservible.
         *
         * En el producto real esto no se da: la web y el móvil siempre guardan la próxima fecha, y lo
         * importado se reconoce por su origen. Es la guarda para el dato que entró por la ventana.
         */
        if (days === null) continue;

        if (days !== credit.daysPastDue) {
          await tx.credit.update({ where: { id: credit.id }, data: { daysPastDue: days } });
          out.updated++;
        }

        const open = openByCredit.get(credit.id);
        const priority = computePriority(
          { outstandingBalance: balance, daysPastDue: days, riskSegment: credit.client.riskSegment },
          priorityParams,
        );

        if (balance <= 0.005) {
          if (open) {
            out.closed += await closeOpenCases(tx, credit.id, 'PAID', asOf);
          }
          continue;
        }

        if (days >= minDaysPastDue) {
          if (!open) {
            await openCaseIfNone(tx, {
              accountId,
              creditId: credit.id,
              clientId: credit.clientId,
              branchId: credit.branchId,
              assigneeId: credit.assignedManagerId,
              priority,
              slaDueAt: slaDueAt(priority, asOf, priorityParams),
            });
            out.opened++;
          } else if (open.priority !== priority && !open.priorityPinnedAt) {
            /*
             * 🔴 **La prioridad fijada a mano no se toca.** El cálculo sale del saldo, la mora y el
             * riesgo, y eso sirve para el caso general — pero falla justo en el que motivó la marca:
             * un deudor con dos días de atraso cae en prioridad baja aunque quien lo conoce sepa que
             * es moroso frecuente y hay que ir hoy. Sin esta guarda, subirla duraba hasta la noche.
             *
             * Misma regla que la mora: cada dato tiene un dueño. Soltarla (`priorityPinnedAt` a
             * NULL) la devuelve a este cálculo en la pasada siguiente.
             */
            await tx.collectionCase.update({ where: { id: open.id }, data: { priority } });
            out.reprioritized++;
          }
          continue;
        }

        // Mora en cero con saldo vivo: se puso al día (pagó la cuota, o le movieron la fecha).
        if (open) {
          out.closed += await closeOpenCases(tx, credit.id, 'CURRENT', asOf);
        }
      }
    }
    // Hay más si el lote vino lleno. El cursor es el último id, que `orderBy: id` deja ordenado.
    const next = credits.length === ARREARS_BATCH ? credits[credits.length - 1]!.id : undefined;
    return { result: out, next };
  }

  /**
   * Los días de mora, **según de quién sea la mora de este crédito**. `null` = no se sabe.
   *
   * Es la regla del módulo escrita una sola vez: importada la manda el archivo, manual se deriva de
   * la fecha en que alguien la marcó, y calculada sale del cronograma si lo hay o de la próxima
   * fecha de vencimiento si no. Cuando no hay ninguna de las tres, devuelve `null` y el job pasa de
   * largo — **«no sé calcularlo» no es «vale cero», y tampoco es «hay que salir a cobrarlo»**.
   */
  private arrearsFor(
    credit: {
      outstandingBalance: unknown;
      daysPastDue: number;
      metadata: unknown;
      installments: { id: string; dueDate: Date; amount: unknown; paidAmount: unknown; status: string }[];
    },
    params: ArrearParams,
    asOf: Date,
  ): number | null {
    const meta = readCreditMetadata(credit.metadata);
    const balance = Number(credit.outstandingBalance);

    switch (arrearsSourceOf(meta)) {
      case 'IMPORTED':
        // Su archivo manda hasta la próxima carga (§6). Se deja tal cual vino — y con ella se le
        // abre el caso, que es lo que hace entrar a Cobranza a una cartera cargada por archivo.
        return credit.daysPastDue;
      case 'MANUAL':
        return manualArrears(meta.moraSince, balance, asOf);
      default:
        if (credit.installments.length > 0) {
          return computeArrears(
            credit.installments.map((i) => ({
              id: i.id,
              dueDate: i.dueDate,
              amount: Number(i.amount),
              paidAmount: Number(i.paidAmount),
              status: i.status,
            })),
            params,
            asOf,
          ).daysOverdue;
        }
        /*
         * Sin cronograma y sin próxima fecha no hay nada de dónde sacarla.
         *
         * `arrearsFromDueDate` devuelve 0 cuando no hay fecha —correcto para él, que contesta «¿hace
         * cuánto venció?»— pero acá ese cero se escribiría encima de una mora real. El día que a ese
         * crédito le pongan una fecha, el job empieza a calcularlo; hasta entonces el número es de
         * quien lo cargó y el job no opina.
         */
        if (!meta.nextDueDate) return null;
        return arrearsFromDueDate(meta.nextDueDate, balance, asOf);
    }
  }

  /** Los parámetros del tenant, con los defaults de siempre. Mismo criterio que `CasesService`. */
  private async config(tx: PrismaClient): Promise<ArrearsConfig> {
    const account = await tx.account.findFirst({ select: { configuration: true } });
    const cfg = (account?.configuration ?? {}) as {
      casePriority?: Partial<PriorityParams>;
      caseGeneration?: { minDaysPastDue?: number };
      arrears?: Partial<ArrearParams>;
    };
    return {
      priority: { ...DEFAULT_PRIORITY_PARAMS, ...(cfg.casePriority ?? {}) },
      arrears: { ...DEFAULT_ARREAR_PARAMS, ...(cfg.arrears ?? {}) },
      minDaysPastDue: cfg.caseGeneration?.minDaysPastDue ?? 1,
    };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
