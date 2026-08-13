import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { CaseStatus, Prisma } from '@prisma/client';
import {
  AGING_BUCKETS,
  type AgendaSummary,
  type AgingBucketRow,
  type AnalyticsSummary,
  type CollectorPerformanceRow,
  type TrendPoint,
  type VisitMapPoint,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AnalyticsQueryDto, TrendQueryDto } from './dto/analytics.dto';

/** Los estados en los que un caso ya no se trabaja. Mismo criterio que `cases`. */
const TERMINAL = [CaseStatus.PAID, CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF];

const money = (n: unknown): number => Math.round(Number(n ?? 0) * 100) / 100;

/** Los tres intervalos posibles, escritos acá y no armados con lo que llegó (ver `collectionTrend`). */
const STEP_INTERVAL: Record<string, string> = { day: "'1 day'", week: "'1 week'", month: "'1 month'" };

/** Un año. Más que eso no entra en una transacción de Prisma con granularidad diaria (ver `window`). */
const MAX_SPAN = 366 * 86_400_000;

/** Una ventana de fechas, con la anterior de igual largo para poder comparar. */
interface Window {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

/**
 * Las seis agregaciones del dashboard.
 *
 * 🔴 **Acá agrega la base, no Node.** Con 1500 créditos y 5500 agendados, traer filas para contarlas
 * en memoria es traerse la base por HTTP en cada carga de la pantalla. Cada método hace unas pocas
 * consultas de tamaño fijo — nunca una por fila.
 *
 * Todo corre dentro de `withTenant`, o sea bajo la policy `tenant_isolation`: por eso ninguna
 * consulta filtra `account_id` a mano. Fuera de ese contexto no devuelven nada.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /**
   * La ventana que se está mirando y la anterior **del mismo largo**: una semana se compara con la
   * semana previa y un mes con el mes previo, sin que el panel tenga que calcular nada.
   */
  private window(query: AnalyticsQueryDto): Window {
    const to = query.dateTo ? new Date(`${query.dateTo}T23:59:59.999Z`) : new Date();
    let from = query.dateFrom
      ? new Date(`${query.dateFrom}T00:00:00.000Z`)
      : new Date(to.getTime() - 6 * 86_400_000);
    /*
     * Los dos rangos son **cerrados en los dos extremos**, así que el anterior termina 1 ms antes de
     * que empiece el actual y arranca un `span` más atrás. Con `prevFrom = from - span` medía un
     * milisegundo menos que el actual: invisible en la pantalla y suficiente para que un pago del
     * borde se cayera de la comparación.
     *
     * 🔴 **El rango tiene techo de un año.** Nada lo acotaba: los dos `<input type="date">` aceptan
     * cualquier fecha, y un rango de tres años con granularidad diaria genera ~1100 puntos cruzados
     * contra todos los pagos del tenant **dentro de la transacción interactiva de Prisma** — que
     * corta a los 5 segundos y devuelve 500. Se recorta el arranque en vez de rechazar el pedido:
     * quien pidió tres años quiere ver la serie, no un error.
     */
    const span = Math.min(MAX_SPAN, Math.max(86_400_000, to.getTime() - from.getTime()));
    if (to.getTime() - from.getTime() > MAX_SPAN) from = new Date(to.getTime() - MAX_SPAN);
    return {
      from,
      to,
      prevFrom: new Date(from.getTime() - span - 1),
      prevTo: new Date(from.getTime() - 1),
    };
  }

  /**
   * El `WHERE` del lado de los créditos (el saldo es de ellos).
   *
   * El filtro por cobrador va con un `EXISTS` sobre casos y no con un `JOIN`: un crédito puede
   * tener más de un caso, y con el join su saldo se sumaría una vez por caso — el KPI daría de más
   * sin que nada se vea roto.
   */
  private creditWhere(q: AnalyticsQueryDto): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`cr.deleted_at IS NULL`, Prisma.sql`cr.status = 'ACTIVE'::"CreditStatus"`];
    if (q.branchId) conds.push(Prisma.sql`cr.branch_id = ${q.branchId}::uuid`);
    if (q.collectorId || q.caseStatus || q.priority) {
      const inner: Prisma.Sql[] = [Prisma.sql`k.credit_id = cr.id`, Prisma.sql`k.deleted_at IS NULL`];
      if (q.collectorId) inner.push(Prisma.sql`k.assignee_id = ${q.collectorId}::uuid`);
      if (q.caseStatus) inner.push(Prisma.sql`k.status = ${q.caseStatus}::"CaseStatus"`);
      if (q.priority) inner.push(Prisma.sql`k.priority = ${q.priority}::"CasePriority"`);
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM collection_cases k WHERE ${Prisma.join(inner, ' AND ')})`);
    }
    return Prisma.join(conds, ' AND ');
  }

  /** El `WHERE` del lado de los casos. */
  private caseWhere(q: AnalyticsQueryDto): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`k.deleted_at IS NULL`];
    if (q.branchId) conds.push(Prisma.sql`k.branch_id = ${q.branchId}::uuid`);
    if (q.collectorId) conds.push(Prisma.sql`k.assignee_id = ${q.collectorId}::uuid`);
    if (q.caseStatus) conds.push(Prisma.sql`k.status = ${q.caseStatus}::"CaseStatus"`);
    if (q.priority) conds.push(Prisma.sql`k.priority = ${q.priority}::"CasePriority"`);
    return Prisma.join(conds, ' AND ');
  }

  /**
   * El `WHERE` del lado de los pagos.
   *
   * ⚠️ El pago se atribuye a **quien lo registró** (`registered_by`). Es lo que pasa en campo: lo
   * carga el cobrador que cobró. Un pago que entra por transferencia y lo carga la oficina no se le
   * cuenta a nadie — y eso es correcto, no un agujero.
   */
  private paymentWhere(q: AnalyticsQueryDto): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q.collectorId) conds.push(Prisma.sql`p.registered_by = ${q.collectorId}::uuid`);
    if (q.branchId) conds.push(Prisma.sql`p.branch_id = ${q.branchId}::uuid`);
    return Prisma.join(conds, ' AND ');
  }

  /*
   * Los mismos dos filtros, en Prisma.
   *
   * ⚠️ **Sí, están escritos dos veces**, y es a propósito: las cuatro consultas que agregan de
   * verdad —tramos, ranking, evolución, mapa— no se pueden expresar con Prisma (`CASE` como clave
   * de grupo, `groupBy` con join, `generate_series`, `DISTINCT ON`), y las que sí se pueden no
   * tienen por qué pagar el SQL crudo. Es el mismo trato que hizo la cartera de W3 con su `where`
   * espejo. El precio es tenerlos alineados; el spec compara los dos caminos.
   */
  private caseFilter(q: AnalyticsQueryDto): Prisma.CollectionCaseWhereInput {
    return {
      deletedAt: null,
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.collectorId ? { assigneeId: q.collectorId } : {}),
      ...(q.caseStatus ? { status: q.caseStatus } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
    };
  }

  private paymentFilter(q: AnalyticsQueryDto): Prisma.PaymentWhereInput {
    return {
      ...(q.collectorId ? { registeredBy: q.collectorId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
    };
  }

  // ── 1 · Los cinco números del encabezado ───────────────────────────────────
  async summary(query: AnalyticsQueryDto): Promise<AnalyticsSummary> {
    const w = this.window(query);
    const credits = this.creditWhere(query);
    const cases = this.caseFilter(query);
    const payments = this.paymentFilter(query);

    const [stock, activeNow, activePrev, collectedNow, collectedPrev, account] = await this.tx((tx) =>
      Promise.all([
        // La única que no puede ser Prisma: el `FILTER` saca el saldo total y el saldo en mora **en
        // una sola pasada** por la tabla. Con Prisma serían dos consultas que recorren lo mismo.
        tx.$queryRaw<{ outstanding: number; overdue: number }[]>(Prisma.sql`
          SELECT COALESCE(SUM(cr.outstanding_balance), 0)::float8                                   AS outstanding,
                 COALESCE(SUM(cr.outstanding_balance) FILTER (WHERE cr.days_past_due > 0), 0)::float8 AS overdue
          FROM credits cr
          WHERE ${credits}`),
        tx.collectionCase.count({ where: { ...cases, status: { notIn: TERMINAL } } }),
        // Los casos activos **sí** se pueden reconstruir: un caso estaba abierto en una fecha si ya
        // existía y todavía no se había cerrado. Es el único KPI de stock con historia propia.
        tx.collectionCase.count({
          where: { ...cases, createdAt: { lte: w.prevTo }, OR: [{ closedAt: null }, { closedAt: { gt: w.prevTo } }] },
        }),
        tx.payment.aggregate({ _sum: { amount: true }, where: { ...payments, paymentDate: { gte: w.from, lte: w.to } } }),
        tx.payment.aggregate({
          _sum: { amount: true },
          where: { ...payments, paymentDate: { gte: w.prevFrom, lte: w.prevTo } },
        }),
        // Con `where` explícito: `accounts` es una tabla global y sin él un `findFirst` puede
        // devolver la moneda de OTRO tenant.
        tx.account.findFirst({ where: { id: this.tenant.accountId }, select: { currencyCode: true } }),
      ]),
    );

    const outstanding = money(stock[0]?.outstanding);
    const overdue = money(stock[0]?.overdue);

    return {
      // 🔴 `previous: null` en los tres saldos, y no es pereza: la base no guarda cuánto se debía la
      // semana pasada. Reconstruirlo sería inventar un número que la pantalla muestra como dato duro.
      outstanding: { value: outstanding, previous: null },
      overdue: { value: overdue, previous: null },
      overdueRate: { value: outstanding > 0 ? Math.round((overdue / outstanding) * 1000) / 10 : 0, previous: null },
      activeCases: { value: activeNow, previous: activePrev },
      collected: { value: money(collectedNow._sum.amount), previous: money(collectedPrev._sum.amount) },
      currency: account?.currencyCode ?? 'BOB',
    };
  }

  // ── 2 · Cartera por tramo de mora ──────────────────────────────────────────
  /**
   * Los tramos salen de `AGING_BUCKETS` de `shared`: el `CASE` se arma con la constante en vez de
   * escribirlo a mano, así el corte de la API y el rótulo del gráfico **no pueden separarse**.
   */
  async portfolioAging(query: AnalyticsQueryDto): Promise<AgingBucketRow[]> {
    const where = this.creditWhere(query);
    const cases = AGING_BUCKETS.map((b) =>
      b.max === null
        ? Prisma.sql`WHEN cr.days_past_due >= ${b.min} THEN ${b.code}`
        : Prisma.sql`WHEN cr.days_past_due BETWEEN ${b.min} AND ${b.max} THEN ${b.code}`,
    );

    const rows = await this.tx((tx) =>
      tx.$queryRaw<{ bucket: string; amount: number; credits: number }[]>(Prisma.sql`
        SELECT CASE ${Prisma.join(cases, ' ')} END               AS bucket,
               COALESCE(SUM(cr.outstanding_balance), 0)::float8  AS amount,
               COUNT(*)::int                                     AS credits
        FROM credits cr
        WHERE ${where} AND cr.days_past_due >= 1
        GROUP BY 1`),
    );

    const byCode = new Map(rows.map((r) => [r.bucket, r]));
    // Los tramos vacíos viajan en cero: un gráfico al que le falta una porción se lee como que ese
    // tramo no existe, y lo que pasa es que hoy nadie está ahí.
    return AGING_BUCKETS.map((b) => ({
      bucket: b.code,
      amount: money(byCode.get(b.code)?.amount),
      credits: byCode.get(b.code)?.credits ?? 0,
    }));
  }

  // ── 3 · Ranking de cobradores ──────────────────────────────────────────────
  /**
   * Cuánta cartera lleva cada cobrador y cuánto recuperó.
   *
   * ⚠️ **La suma de esta tabla es un poco menor que el KPI de saldo, y está bien**: acá sólo entra
   * la cartera que tiene un caso abierto **con cobrador asignado**. Un crédito activo sin caso no es
   * de nadie todavía. Lo que sí tienen que compartir es el universo de créditos —activos, ni
   * pagados ni castigados—, o serían dos números rotulados «saldo» que no dan lo mismo.
   */
  async collectorPerformance(query: AnalyticsQueryDto): Promise<CollectorPerformanceRow[]> {
    const w = this.window(query);
    const cases = this.caseWhere(query);
    const payments = this.paymentWhere(query);

    const [load, collected] = await this.tx((tx) =>
      Promise.all([
        // 🔴 El `deleted_at` del crédito va en el ON: en el WHERE, este LEFT JOIN se comporta como
        // INNER y el cobrador sin créditos vivos desaparece del ranking en vez de aparecer en cero.
        // Es el mismo defecto que ya se pagó una vez en la cartera de W3, y tiene spec.
        tx.$queryRaw<{ collector: string; cases: number; outstanding: number; overdue: number }[]>(Prisma.sql`
          SELECT k.assignee_id                                                                        AS collector,
                 COUNT(*)::int                                                                        AS cases,
                 COALESCE(SUM(cr.outstanding_balance), 0)::float8                                     AS outstanding,
                 COALESCE(SUM(cr.outstanding_balance) FILTER (WHERE cr.days_past_due > 0), 0)::float8 AS overdue
          FROM collection_cases k
          -- El filtro de ACTIVE es el mismo que usa el KPI de saldo: sin eso, el ranking sumaba
          -- también los créditos pagados y castigados, y en la misma pantalla convivían dos números
          -- rotulados «saldo» que no daban lo mismo, sin forma de saber cuál era el bueno.
          LEFT JOIN credits cr ON cr.id = k.credit_id AND cr.deleted_at IS NULL AND cr.status = 'ACTIVE'::"CreditStatus"
          WHERE ${cases} AND k.assignee_id IS NOT NULL AND k.status::text NOT IN (${Prisma.join(TERMINAL)})
          GROUP BY k.assignee_id`),
        tx.$queryRaw<{ collector: string; collected: number }[]>(Prisma.sql`
          SELECT p.registered_by AS collector, COALESCE(SUM(p.amount), 0)::float8 AS collected
          FROM payments p
          WHERE ${payments} AND p.registered_by IS NOT NULL AND p.payment_date BETWEEN ${w.from} AND ${w.to}
          GROUP BY p.registered_by`),
      ]),
    );

    const byId = new Map(collected.map((c) => [c.collector, c.collected]));
    return load
      .map((r) => {
        const outstanding = money(r.outstanding);
        const overdue = money(r.overdue);
        return {
          collectorId: r.collector,
          cases: r.cases,
          outstanding,
          overdue,
          overdueRate: outstanding > 0 ? Math.round((overdue / outstanding) * 1000) / 10 : 0,
          collected: money(byId.get(r.collector)),
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding);
  }

  // ── 4 · Agenda del período ─────────────────────────────────────────────────
  /**
   * Toda esta la hace Prisma: son `groupBy` planos sobre una tabla y dos conteos. El SQL crudo acá
   * no compraría nada y costaría los nombres de columna sin tipar.
   */
  async agendaSummary(query: AnalyticsQueryDto): Promise<AgendaSummary> {
    const w = this.window(query);
    const where: Prisma.AgendaItemWhereInput = {
      deletedAt: null,
      scheduledDate: { gte: w.from, lte: w.to },
      ...(query.collectorId ? { assigneeId: query.collectorId } : {}),
    };
    const payments = this.paymentFilter(query);

    const [byType, byStatus, done, prev, pagosNow, pagosPrev] = await this.tx((tx) =>
      Promise.all([
        tx.agendaItem.groupBy({ by: ['type'], where, _count: { _all: true } }),
        tx.agendaItem.groupBy({ by: ['status'], where, _count: { _all: true } }),
        tx.agendaItem.groupBy({ by: ['type'], where: { ...where, status: 'EXECUTED' }, _count: { _all: true } }),
        // El mismo corte en la ventana anterior: es de donde salen las flechitas de los indicadores.
        tx.agendaItem.groupBy({
          by: ['type'],
          where: { ...where, status: 'EXECUTED', scheduledDate: { gte: w.prevFrom, lte: w.prevTo } },
          _count: { _all: true },
        }),
        tx.payment.count({ where: { ...payments, paymentDate: { gte: w.from, lte: w.to } } }),
        tx.payment.count({ where: { ...payments, paymentDate: { gte: w.prevFrom, lte: w.prevTo } } }),
      ]),
    );

    const now = (type: string): number => done.find((d) => d.type === type)?._count._all ?? 0;
    const before = (type: string): number => prev.find((d) => d.type === type)?._count._all ?? 0;

    return {
      byType: byType.map((r) => ({ type: r.type, total: r._count._all })),
      byStatus: byStatus.map((r) => ({ status: r.status, total: r._count._all })),
      // Códigos, no rótulos: el panel es bilingüe y el texto vive en sus diccionarios.
      indicators: [
        { code: 'VISITS_DONE', value: now('VISIT'), previous: before('VISIT') },
        { code: 'CALLS_DONE', value: now('CALL'), previous: before('CALL') },
        {
          code: 'CONTACTS',
          value: done.reduce((s, d) => s + d._count._all, 0),
          previous: prev.reduce((s, d) => s + d._count._all, 0),
        },
        { code: 'PROMISES', value: now('PROMISE_TO_PAY'), previous: before('PROMISE_TO_PAY') },
        { code: 'PAYMENTS', value: pagosNow, previous: pagosPrev },
      ],
    };
  }

  // ── 5 · Mapa de visitas ────────────────────────────────────────────────────
  /**
   * Las paradas de un día con su punto.
   *
   * `DISTINCT ON (rs.id)`: un deudor puede tener varias ubicaciones —casa y trabajo— y sin esto la
   * misma parada aparecería dos veces en el mapa, en dos lugares distintos.
   */
  async visitMap(query: AnalyticsQueryDto): Promise<VisitMapPoint[]> {
    const day = query.dateTo ?? query.dateFrom ?? new Date().toISOString().slice(0, 10);
    const conds: Prisma.Sql[] = [Prisma.sql`rp.planned_date = ${day}::date`];
    if (query.collectorId) conds.push(Prisma.sql`rp.collector_id = ${query.collectorId}::uuid`);
    if (query.branchId) conds.push(Prisma.sql`rp.branch_id = ${query.branchId}::uuid`);

    const rows = await this.tx((tx) =>
      tx.$queryRaw<
        { id: string; client_id: string; lat: number; lng: number; status: string; seq: number; collector: string }[]
      >(Prisma.sql`
        SELECT DISTINCT ON (rs.id)
               rs.id AS id, rs.client_id, rs.status::text AS status, rs.sequence_order AS seq,
               rp.collector_id AS collector,
               cl.latitude::float8 AS lat, cl.longitude::float8 AS lng
        FROM route_stops rs
        JOIN route_plans rp ON rp.id = rs.route_id
        JOIN client_locations cl ON cl.client_id = rs.client_id
        WHERE ${Prisma.join(conds, ' AND ')} AND cl.latitude IS NOT NULL AND cl.longitude IS NOT NULL
        ORDER BY rs.id, cl.location_type`),
    );

    return rows.map((r) => ({
      stopId: r.id,
      clientId: r.client_id,
      latitude: r.lat,
      longitude: r.lng,
      status: r.status,
      sequenceOrder: r.seq,
      collectorId: r.collector,
    }));
  }

  // ── 6 · Evolución ──────────────────────────────────────────────────────────
  /**
   * Lo recaudado por período y el saldo **reconstruido hacia atrás**.
   *
   * ⚠️ El saldo de cada punto es el de hoy más todo lo que se cobró después: es la curva de lo que
   * la cobranza bajó, **no la historia del saldo** — ignora desembolsos y castigos posteriores.
   * `generate_series` es lo que hace que un día sin pagos exista y valga cero; sin él, la línea
   * saltea días y el gráfico miente por omisión.
   */
  async collectionTrend(query: TrendQueryDto): Promise<TrendPoint[]> {
    const w = this.window(query);
    const step = query.granularity ?? 'day';
    /*
     * 🔴 **El único fragmento de esta clase que NO va parametrizado**, porque un intervalo no puede
     * serlo. Por eso no se arma con el valor que llegó: se busca en una tabla fija. El DTO ya valida
     * el enum, pero un `Prisma.raw` construido con texto de afuera es una inyección esperando un
     * día en que alguien saltee esa validación —y la validación está a tres archivos de acá—.
     */
    const interval = Prisma.raw(STEP_INTERVAL[step] ?? STEP_INTERVAL.day);
    const payments = this.paymentWhere(query);

    const [rows, stock] = await this.tx((tx) =>
      Promise.all([
        // El `LEFT JOIN` no ata el pago a su punto: cada punto ve TODOS los pagos y los reparte con
        // dos `FILTER` —lo cobrado en el punto y lo cobrado desde el punto en adelante, que es lo
        // que reconstruye el saldo—. Es un cruce de `puntos × pagos`: con 30 puntos y unos miles de
        // pagos no se nota. ponytail: si un día el rango es de años, esto va a una CTE que agregue
        // por período antes de cruzar.
        tx.$queryRaw<{ date: Date; collected: number; after: number }[]>(Prisma.sql`
          WITH puntos AS (
            SELECT generate_series(date_trunc(${step}, ${w.from}::timestamptz), ${w.to}::timestamptz, ${interval}::interval) AS d
          )
          SELECT s.d AS date,
                 COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= s.d AND p.payment_date < s.d + ${interval}::interval), 0)::float8 AS collected,
                 COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= s.d), 0)::float8 AS after
          FROM puntos s
          -- El tope es HOY y no el fin del rango: el saldo de cada punto se reconstruye con todo lo
          -- cobrado desde esa fecha hasta el saldo actual, que es el único que conocemos. Cortando
          -- en el fin del rango, mirar «mes anterior» dibujaba la curva por debajo de lo real, sin
          -- todo lo cobrado entre esa fecha y hoy.
          LEFT JOIN payments p ON ${payments} AND p.payment_date <= now()
          GROUP BY s.d
          ORDER BY s.d`),
        tx.$queryRaw<{ outstanding: number }[]>(Prisma.sql`
          SELECT COALESCE(SUM(cr.outstanding_balance), 0)::float8 AS outstanding
          FROM credits cr WHERE ${this.creditWhere(query)}`),
      ]),
    );

    const today = money(stock[0]?.outstanding);
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      collected: money(r.collected),
      outstanding: money(today + Number(r.after ?? 0)),
    }));
  }
}
