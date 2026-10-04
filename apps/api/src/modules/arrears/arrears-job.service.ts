import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CreditStatus, ExternalSyncStatus, type Prisma, type PrismaClient } from '@prisma/client';
import {
  arrearsByMethod,
  arrearsSourceOf,
  manualArrears,
  oldestUnpaid,
  readCreditMetadata,
  withArrearsMethod,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { computeArrears, DEFAULT_ARREAR_PARAMS, type ArrearParams } from '../credits/credit-math';
import { ArrearsPriorityService } from './arrears-priority.service';

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

interface ArrearsConfig {
  arrears: ArrearParams;
}

export interface ArrearsRunResult {
  /** Créditos a los que les cambió el número de días. */
  updated: number;
  /** Episodios abiertos a los que les cambió la prioridad (y con ella su lugar en la ruta). */
  reprioritized: number;
}

const EMPTY: ArrearsRunResult = { updated: 0, reprioritized: 0 };

function addInto(total: ArrearsRunResult, r: ArrearsRunResult): void {
  total.updated += r.updated;
  total.reprioritized += r.reprioritized;
}

/**
 * El trabajo diario de la mora (F4/08 · fase 3): **calcula los días de mora y la prioridad. No abre ni cierra nada.**
 *
 * Antes además abría, cerraba y reabría casos de cobranza. Ya no hay caso: el episodio de mora lo abre y lo cierra el
 * trigger de la base cuando cambian `days_past_due`, el saldo, el estado o la sincronización (D4/D7/D9), así que lo
 * único que el job hace es dejar los días de mora al día. Por crédito:
 *
 * 1. Pone al día los días de mora **según de quién sea** (`arrearsSourceOf`). El importado no se toca: su archivo
 *    manda hasta la próxima carga. El manual se deriva de `moraSince`. Lo calculado sale del cronograma o de la
 *    próxima fecha. Si no se sabe de dónde sale, no se toca.
 * 2. Recalcula la prioridad del episodio abierto (`ArrearsPriorityService`), respetando la fijada a mano.
 *
 * La operación ausente del reporte (PSF) se salta entera: su mora es la del último reporte que la trajo. El dato viejo
 * (D9) ya no frena nada aquí —el job no decide a quién se sale a cobrar—; la ficha avisa que el dato es viejo.
 *
 * 🔴 **No notifica**: escribe y la pantalla lo muestra. Es idempotente.
 *
 * Como tarea de sistema enumera los tenants vivos y escanea cada uno bajo su RLS, igual que `PromiseDueService`.
 */
@Injectable()
export class ArrearsJobService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ArrearsJobService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly priority: ArrearsPriorityService,
  ) {}

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
        addInto(total, await this.scanAccount(accountId, asOf));
      } catch (err) {
        this.logger.error(`Mora falló en tenant ${accountId}: ${this.msg(err)}`);
      }
    }
    if (total.updated || total.reprioritized) {
      this.logger.log(`Mora: ${total.updated} créditos actualizados, ${total.reprioritized} prioridades recalculadas`);
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
        (tx) => this.scanBatch(tx, asOf, params, cursor),
        ARREARS_TX_TIMEOUT_MS,
      );
      addInto(out, batch.result);
      if (!batch.next) return out;
      cursor = batch.next;
    }
  }

  /** Un lote de créditos, en su propia transacción. Devuelve el último id visto para seguir. */
  private async scanBatch(
    tx: PrismaClient,
    asOf: Date,
    { arrears: arrearParams }: ArrearsConfig,
    cursor?: string,
  ): Promise<{ result: ArrearsRunResult; next?: string }> {
    const credits = await tx.credit.findMany({
      /*
       * Los activos, y además los externos que su fuente reporta como vencidos (`DEFAULTED`): para
       * el banco «Vencido» es un grado de mora, no un cierre, y sin esto su episodio nunca se abriría.
       * Los créditos de Kobrax en `DEFAULTED` siguen afuera: ese
       * estado lo pone una persona y el job no lo reinterpreta.
       */
      where: {
        deletedAt: null,
        OR: [
          { status: CreditStatus.ACTIVE },
          { status: CreditStatus.DEFAULTED, externalSource: { not: null } },
          // D1-a: el castigo es la condición `written_off_at` y el estado no cambia, así que un castigado nuevo ya entra por
          // ACTIVE. Los viejos con estado WRITTEN_OFF (anteriores a D1-a) siguen contando días de mora igual.
          { status: CreditStatus.WRITTEN_OFF, writtenOffAt: { not: null } },
        ],
      },
      select: {
        id: true,
        outstandingBalance: true,
        daysPastDue: true,
        metadata: true,
        origin: true,
        syncStatus: true,
        installments: { select: { id: true, number: true, dueDate: true, amount: true, paidAmount: true, status: true } },
      },
      orderBy: { id: 'asc' },
      take: ARREARS_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (credits.length === 0) return { result: { ...EMPTY } };

    // Un solo viaje por las prioridades de los episodios abiertos DEL LOTE: sirve para contar cuáles cambian.
    const openEpisodes = await tx.creditArrearEpisode.findMany({
      where: { creditId: { in: credits.map((c) => c.id) }, endedAt: null },
      select: { creditId: true, priority: true },
    });
    const before = new Map(openEpisodes.map((e) => [e.creditId, e.priority]));

    const out = { ...EMPTY };
    for (const credit of credits) {
      /*
       * 🔴 **Operación externa que faltó en su reporte: no se toca.** Que el reporte deje de traerla no dice si se
       * puso al día o si canceló (D4): sus números son los del último reporte que la trajo, y con la regla
       * `set-current` su mora quedó en cero. El episodio lo cierra el trigger con motivo «ausente del reporte».
       */
      if (credit.syncStatus === ExternalSyncStatus.ABSENT) continue;

      const balance = Number(credit.outstandingBalance);
      const reading = this.arrearsFor(credit, arrearParams, asOf);
      const days = reading?.days ?? null;

      /*
       * 🔴 **Si no se sabe de dónde sale la mora, el job no toca ese crédito.** Un crédito sin cronograma, sin
       * próxima fecha, sin marca a mano y sin archivo detrás tiene un número de días que no se puede explicar;
       * escribirle cero borra el dato de alguien. En la base de desarrollo son 199.427 créditos sintéticos.
       */
      if (days === null || !reading) continue;

      // D20: con el método bancario la fecha del primer atraso también se guarda (o se borra al quedar al día).
      const meta = readCreditMetadata(credit.metadata, credit.origin);
      const sinceChanged = reading.arrearsSince !== meta.arrearsSince;
      if (days !== credit.daysPastDue || sinceChanged) {
        // Este update dispara el trigger que abre o cierra el episodio de mora.
        await tx.credit.update({
          where: { id: credit.id },
          data: {
            daysPastDue: days,
            ...(sinceChanged ? { metadata: withArrearsSince(credit.metadata, reading.arrearsSince) } : {}),
          },
        });
        out.updated++;
      }

      // Sin saldo o sin mora no hay episodio abierto (o el trigger lo acaba de cerrar): nada que priorizar.
      if (balance <= 0.005 || days < 1) continue;
      const after = await this.priority.recomputeForCredit(tx, credit.id);
      const was = before.get(credit.id);
      if (after && was !== undefined && after !== was) out.reprioritized++;
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
      origin?: string | null;
      installments: { id: string; number: number; dueDate: Date; amount: unknown; paidAmount: unknown; status: string }[];
    },
    params: ArrearParams,
    asOf: Date,
  ): { days: number; arrearsSince: string | undefined } | null {
    const meta = readCreditMetadata(credit.metadata, credit.origin);
    const balance = Number(credit.outstandingBalance);
    // Importada y manual no usan el método: su dueño es otro. La fecha de primer atraso queda como está.
    const keep = (days: number) => ({ days, arrearsSince: meta.arrearsSince });

    switch (arrearsSourceOf(meta)) {
      case 'IMPORTED':
        // Su archivo manda hasta la próxima carga (§6). Se deja tal cual vino; el episodio lo abre el trigger.
        return keep(credit.daysPastDue);
      case 'MANUAL':
        return keep(manualArrears(meta.moraSince, balance, asOf));
      default:
        if (credit.installments.length > 0) {
          const baseDays = computeArrears(
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
          // D20: el método del crédito sobre la mora de siempre (desde la cuota impaga más antigua).
          const r = withArrearsMethod({
            baseDays,
            method: meta.arrearsMethod,
            oldestUnpaidDue: oldestUnpaid(credit.installments)?.dueDate,
            arrearsSince: meta.arrearsSince,
            asOf,
          });
          return { days: r.daysPastDue, arrearsSince: r.arrearsSince };
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
        {
          const r = arrearsByMethod({
            method: meta.arrearsMethod,
            oldestUnpaidDue: meta.nextDueDate,
            arrearsSince: meta.arrearsSince,
            balance,
            asOf,
          });
          return { days: r.daysPastDue, arrearsSince: r.arrearsSince };
        }
    }
  }

  /** Los parámetros del tenant, con los defaults de siempre. */
  private async config(tx: PrismaClient): Promise<ArrearsConfig> {
    const account = await tx.account.findFirst({ select: { configuration: true } });
    const cfg = (account?.configuration ?? {}) as { arrears?: Partial<ArrearParams> };
    return { arrears: { ...DEFAULT_ARREAR_PARAMS, ...(cfg.arrears ?? {}) } };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

/** La metadata con la fecha de primer atraso puesta o borrada (D20). Prisma rechaza `undefined` en un JSON. */
function withArrearsSince(metadata: unknown, arrearsSince: string | undefined): Prisma.InputJsonObject {
  const m = { ...((metadata ?? {}) as Record<string, unknown>) };
  if (arrearsSince) m.arrearsSince = arrearsSince;
  else delete m.arrearsSince;
  return m as Prisma.InputJsonObject;
}
