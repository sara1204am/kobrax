import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  AGING_BUCKETS,
  type AgendaSummary,
  type AgingBucketRow,
  type AnalyticsSummary,
  type CollectorPerformanceRow,
  type KpiValue,
  type SourceBreakdown,
  type TrendPoint,
  type VisitMapPoint,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AnalyticsQueryDto, TrendQueryDto } from './dto/analytics.dto';

/*
 * 🔴 F4/08 · fase 3 — CAMBIÓ LA DEFINICIÓN de dos números del tablero. Las series de antes y de después NO son comparables:
 *
 * · «Casos activos» (`activeCases`) ahora es **créditos en mora** (`creditsInArrears`): créditos con un episodio de
 *   mora ABIERTO (`credit_arrear_episodes.ended_at IS NULL`). Antes eran los casos de cobranza no terminales, que
 *   el job abría con reglas propias (umbral, dato viejo) y que una persona podía cerrar. El período anterior sale de
 *   las fechas de inicio y fin del episodio.
 * · El ranking por cobrador agrupa por el **responsable del crédito** (`assigned_manager_id`), no por el cobrador del
 *   caso, y cuenta créditos en mora. Su cartera es la de todos sus créditos activos, estén o no en mora.
 *
 * El filtro `caseStatus` desapareció con el estado del caso: el DTO lo acepta y se ignora.
 */

const money = (n: unknown): number => Math.round(Number(n ?? 0) * 100) / 100;

/**
 * Un filtro de varios valores que **de verdad filtra algo**.
 *
 * No es lo mismo que `!!lista`: una lista vacía es un objeto y pasa cualquier `if`. Y ahí abajo hay
 * un `Prisma.join`, que con cero elementos escribe `IN ()` — un error de sintaxis de Postgres, no un
 * «sin filtro». Basta un `?collectorId=` en la URL para llegar con la lista vacía.
 */
const some = <T>(list?: T[]): list is T[] => !!list?.length;

/** Los tres intervalos posibles, escritos acá y no armados con lo que llegó (ver `collectionTrend`). */
const STEP_INTERVAL: Record<string, string> = { day: "'1 day'", week: "'1 week'", month: "'1 month'" };

/** Un año. Más que eso no entra en una transacción de Prisma con granularidad diaria (ver `window`). */
const MAX_SPAN = 366 * 86_400_000;

/**
 * La fuente de un crédito como texto, en SQL: `KOBRAX` si no tiene fuente externa (D7). Es la clave
 * del desglose; `alias` es siempre un literal de este archivo, nunca algo que llegó de afuera.
 */
const sourceOf = (alias: string): Prisma.Sql => Prisma.raw(`COALESCE(${alias}.external_source, 'KOBRAX')`);

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
 *
 * 🔴 **Ningún id se castea a `::uuid`.** Los ids del esquema son `text` —Prisma los genera con
 * `@default(uuid())`, pero la columna es `text`—, así que `assignee_id = $1::uuid` no compara: es
 * `operator does not exist: text = uuid`, un 500 en los seis endpoints apenas alguien elige un
 * cobrador. Los parámetros de Prisma ya llegan como texto; el cast sobra y rompe.
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
   * El cobrador es el **responsable del crédito** (F4/08). La prioridad vive en el episodio abierto y va con un
   * `EXISTS` y no con un `JOIN`: así el saldo del crédito nunca se suma dos veces.
   */
  private creditWhere(q: AnalyticsQueryDto): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`cr.deleted_at IS NULL`, Prisma.sql`cr.status = 'ACTIVE'::"CreditStatus"`, Prisma.sql`cr.written_off_at IS NULL`];
    if (q.branchId) conds.push(Prisma.sql`cr.branch_id = ${q.branchId}`);
    const source = this.sourceSql('cr', q);
    if (source) conds.push(source);
    if (some(q.collectorId)) conds.push(Prisma.sql`cr.assigned_manager_id IN (${Prisma.join(q.collectorId)})`);
    if (some(q.priority)) {
      conds.push(
        Prisma.sql`EXISTS (SELECT 1 FROM credit_arrear_episodes pe WHERE pe.credit_id = cr.id AND pe.ended_at IS NULL AND pe.priority::text IN (${Prisma.join(q.priority)}))`,
      );
    }
    return Prisma.join(conds, ' AND ');
  }

  /**
   * El `WHERE` de los episodios de mora **abiertos o históricos** (alias `e`) con su crédito (`cr`): sucursal, fuente,
   * responsable y prioridad del episodio. `caseStatus` ya no existe (se ignora).
   */
  private episodeWhere(q: AnalyticsQueryDto): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`cr.deleted_at IS NULL`];
    if (q.branchId) conds.push(Prisma.sql`cr.branch_id = ${q.branchId}`);
    const source = this.sourceSql('cr', q);
    if (source) conds.push(source);
    if (some(q.collectorId)) conds.push(Prisma.sql`cr.assigned_manager_id IN (${Prisma.join(q.collectorId)})`);
    if (some(q.priority)) conds.push(Prisma.sql`e.priority::text IN (${Prisma.join(q.priority)})`);
    return Prisma.join(conds, ' AND ');
  }

  /**
   * D7: el crédito es de la fuente pedida. `KOBRAX` = sin fuente externa. `null` = sin filtro.
   * `alias` es un literal de este archivo (ver `sourceOf`).
   */
  private sourceSql(alias: string, q: AnalyticsQueryDto): Prisma.Sql | null {
    if (!q.source) return null;
    const column = Prisma.raw(`${alias}.external_source`);
    return q.source === 'KOBRAX' ? Prisma.sql`${column} IS NULL` : Prisma.sql`${column} = ${q.source}`;
  }

  /**
   * El mismo filtro para una tabla que apunta al crédito (pagos, agenda): un `EXISTS`, que
   * también sirve donde la referencia es suave y Prisma no tiene relación por la que filtrar.
   */
  private creditOfSource(creditId: Prisma.Sql, q: AnalyticsQueryDto): Prisma.Sql | null {
    const source = this.sourceSql('sc', q);
    return source ? Prisma.sql`EXISTS (SELECT 1 FROM credits sc WHERE sc.id = ${creditId} AND ${source})` : null;
  }

  /** El filtro de fuente en Prisma, para las consultas que van por el cliente tipado. */
  private sourceFilter(q: AnalyticsQueryDto): Prisma.CreditWhereInput {
    return { externalSource: q.source === 'KOBRAX' ? null : q.source };
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
    if (some(q.collectorId)) conds.push(Prisma.sql`p.registered_by IN (${Prisma.join(q.collectorId)})`);
    if (q.branchId) conds.push(Prisma.sql`p.branch_id = ${q.branchId}`);
    const source = this.creditOfSource(Prisma.sql`p.credit_id`, q);
    if (source) conds.push(source);
    return Prisma.join(conds, ' AND ');
  }

  /*
   * El mismo filtro de pagos, en Prisma.
   *
   * ⚠️ **Sí, están escritos dos veces**, y es a propósito: las cuatro consultas que agregan de
   * verdad —tramos, ranking, evolución, mapa— no se pueden expresar con Prisma (`CASE` como clave
   * de grupo, `groupBy` con join, `generate_series`, `DISTINCT ON`), y las que sí se pueden no
   * tienen por qué pagar el SQL crudo. Es el mismo trato que hizo la cartera de W3 con su `where`
   * espejo. El precio es tenerlos alineados; el spec compara los dos caminos.
   */
  private paymentFilter(q: AnalyticsQueryDto): Prisma.PaymentWhereInput {
    return {
      ...(some(q.collectorId) ? { registeredBy: { in: q.collectorId } } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.source ? { credit: this.sourceFilter(q) } : {}),
    };
  }

  // ── 1 · Los cinco números del encabezado ───────────────────────────────────
  async summary(query: AnalyticsQueryDto): Promise<AnalyticsSummary> {
    const w = this.window(query);
    const credits = this.creditWhere(query);
    const episodes = this.episodeWhere(query);
    const payments = this.paymentFilter(query);

    const [stock, collectedBySource, arrearsCount, collectedNow, collectedPrev, account] = await this.tx((tx) =>
      Promise.all([
        // La única que no puede ser Prisma: el `FILTER` saca el saldo total y el saldo en mora **en
        // una sola pasada** por la tabla. Con Prisma serían dos consultas que recorren lo mismo.
        // Agrupada por fuente (D7): el total es la suma de las filas, así el desglose y el KPI salen
        // de la misma pasada y no pueden dejar de sumar lo mismo.
        tx.$queryRaw<StockRow[]>(Prisma.sql`
          SELECT ${sourceOf('cr')}                                                                   AS source,
                 COUNT(*)::int                                                                        AS credits,
                 COALESCE(SUM(cr.outstanding_balance), 0)::float8                                   AS outstanding,
                 COALESCE(SUM(cr.outstanding_balance) FILTER (WHERE cr.days_past_due > 0), 0)::float8 AS overdue,
                 MIN(cr.reported_as_of)                                                               AS as_of_from,
                 MAX(cr.reported_as_of)                                                               AS as_of_to
          FROM credits cr
          WHERE ${credits}
          GROUP BY 1`),
        // Lo recaudado en la ventana, por la fuente del crédito al que se imputó el pago.
        tx.$queryRaw<{ source: string; collected: number }[]>(Prisma.sql`
          SELECT ${sourceOf('pc')} AS source, COALESCE(SUM(p.amount), 0)::float8 AS collected
          FROM payments p
          JOIN credits pc ON pc.id = p.credit_id
          WHERE ${this.paymentWhere(query)} AND p.payment_date BETWEEN ${w.from} AND ${w.to}
          GROUP BY 1`),
        /*
         * Créditos en mora: con episodio abierto hoy, y los que lo tenían abierto al cierre del período anterior
         * (empezó antes o ese día y todavía no había terminado). Es el único KPI de stock con historia propia. Una
         * sola pasada; `COUNT(DISTINCT)` por crédito, aunque dos episodios se solaparan por un dato sucio.
         * Con el filtro de prioridad, la del período anterior usa la prioridad ACTUAL del episodio (no se guarda historia).
         */
        tx.$queryRaw<{ now: number; prev: number }[]>(Prisma.sql`
          SELECT COUNT(DISTINCT e.credit_id) FILTER (WHERE e.ended_at IS NULL)::int AS now,
                 COUNT(DISTINCT e.credit_id) FILTER (
                   WHERE e.started_at <= ${w.prevTo}::date AND (e.ended_at IS NULL OR e.ended_at > ${w.prevTo}::date)
                 )::int AS prev
          FROM credit_arrear_episodes e
          JOIN credits cr ON cr.id = e.credit_id
          WHERE ${episodes}`),
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

    const inArrears: KpiValue = { value: Number(arrearsCount[0]?.now ?? 0), previous: Number(arrearsCount[0]?.prev ?? 0) };
    const outstanding = money(stock.reduce((sum, r) => sum + Number(r.outstanding ?? 0), 0));
    const overdue = money(stock.reduce((sum, r) => sum + Number(r.overdue ?? 0), 0));

    return {
      // 🔴 `previous: null` en los tres saldos, y no es pereza: la base no guarda cuánto se debía la
      // semana pasada. Reconstruirlo sería inventar un número que la pantalla muestra como dato duro.
      outstanding: { value: outstanding, previous: null },
      overdue: { value: overdue, previous: null },
      overdueRate: { value: outstanding > 0 ? Math.round((overdue / outstanding) * 1000) / 10 : 0, previous: null },
      // Mismo número bajo los dos nombres: `activeCases` lo sigue leyendo la web hasta la fase 4 (DEPRECADO); el
      // nombre honesto es `creditsInArrears`. La definición cambió (ver arriba): no comparar con series viejas.
      activeCases: inArrears,
      creditsInArrears: inArrears,
      collected: { value: money(collectedNow._sum.amount), previous: money(collectedPrev._sum.amount) },
      currency: account?.currencyCode ?? 'BOB',
      bySource: breakdown(stock, collectedBySource),
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
   * Cuánta cartera lleva cada responsable y cuánto recuperó (F4/08: por **responsable del crédito**, no por cobrador
   * del caso).
   *
   * La cartera de cada uno es la de todos sus créditos activos (no pagados ni castigados), estén o no en mora; la
   * mora y `creditsInArrears` (créditos con episodio abierto) salen de ahí. Así la suma de esta tabla comparte
   * universo con el KPI de saldo: sólo falta la cartera sin responsable. Cambió de definición: no comparar con la
   * tabla de antes (que sólo contaba créditos con un caso abierto y su cobrador).
   */
  async collectorPerformance(query: AnalyticsQueryDto): Promise<CollectorPerformanceRow[]> {
    const w = this.window(query);
    const credits = this.creditWhere(query);
    const payments = this.paymentWhere(query);

    const [load, collected] = await this.tx((tx) =>
      Promise.all([
        tx.$queryRaw<{ collector: string; arrears: number; outstanding: number; overdue: number }[]>(Prisma.sql`
          SELECT cr.assigned_manager_id                                                                AS collector,
                 COUNT(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM credit_arrear_episodes oe WHERE oe.credit_id = cr.id AND oe.ended_at IS NULL)
                 )::int                                                                                AS arrears,
                 COALESCE(SUM(cr.outstanding_balance), 0)::float8                                     AS outstanding,
                 COALESCE(SUM(cr.outstanding_balance) FILTER (WHERE cr.days_past_due > 0), 0)::float8 AS overdue
          FROM credits cr
          WHERE ${credits} AND cr.assigned_manager_id IS NOT NULL
          GROUP BY cr.assigned_manager_id`),
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
          // `cases` queda con el mismo número que `creditsInArrears` mientras la web lo lea (deprecado).
          cases: r.arrears,
          creditsInArrears: r.arrears,
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
   * Una sola consulta sobre la agenda, con las dos ventanas en `FILTER`: de ahí salen los cortes por
   * tipo y por estado y los indicadores de hoy y del período anterior.
   *
   * Es SQL y no `groupBy` por D7: `agenda_items.credit_id` es una referencia suave —sin relación en
   * el esquema— y Prisma no puede filtrar por la fuente del crédito. Con un `EXISTS` sí, y sin traer
   * a memoria la lista de ids de ninguna cartera.
   */
  async agendaSummary(query: AnalyticsQueryDto): Promise<AgendaSummary> {
    const w = this.window(query);
    const conds: Prisma.Sql[] = [
      Prisma.sql`a.deleted_at IS NULL`,
      // Las dos ventanas juntas: la anterior termina justo donde empieza la actual.
      Prisma.sql`a.scheduled_date BETWEEN ${w.prevFrom} AND ${w.to}`,
    ];
    if (some(query.collectorId)) conds.push(Prisma.sql`a.assignee_id IN (${Prisma.join(query.collectorId)})`);
    const source = this.creditOfSource(Prisma.sql`a.credit_id`, query);
    if (source) conds.push(source);
    const payments = this.paymentFilter(query);

    const [rows, pagosNow, pagosPrev] = await this.tx((tx) =>
      Promise.all([
        tx.$queryRaw<{ type: string; status: string; now: number; prev: number }[]>(Prisma.sql`
          SELECT a.type::text   AS type,
                 a.status::text AS status,
                 COUNT(*) FILTER (WHERE a.scheduled_date BETWEEN ${w.from} AND ${w.to})::int        AS now,
                 COUNT(*) FILTER (WHERE a.scheduled_date BETWEEN ${w.prevFrom} AND ${w.prevTo})::int AS prev
          FROM agenda_items a
          WHERE ${Prisma.join(conds, ' AND ')}
          GROUP BY 1, 2`),
        tx.payment.count({ where: { ...payments, paymentDate: { gte: w.from, lte: w.to } } }),
        tx.payment.count({ where: { ...payments, paymentDate: { gte: w.prevFrom, lte: w.prevTo } } }),
      ]),
    );

    const total = (key: 'type' | 'status') => {
      const out = new Map<string, number>();
      for (const r of rows) if (r.now > 0) out.set(r[key], (out.get(r[key]) ?? 0) + r.now);
      return [...out];
    };
    const executed = rows.filter((r) => r.status === 'EXECUTED');
    const now = (type: string): number => executed.filter((r) => r.type === type).reduce((s, r) => s + r.now, 0);
    const before = (type: string): number => executed.filter((r) => r.type === type).reduce((s, r) => s + r.prev, 0);

    return {
      byType: total('type').map(([type, n]) => ({ type, total: n })),
      byStatus: total('status').map(([status, n]) => ({ status, total: n })),
      // Códigos, no rótulos: el panel es bilingüe y el texto vive en sus diccionarios.
      indicators: [
        { code: 'VISITS_DONE', value: now('VISIT'), previous: before('VISIT') },
        { code: 'CALLS_DONE', value: now('CALL'), previous: before('CALL') },
        {
          code: 'CONTACTS',
          value: executed.reduce((s, r) => s + r.now, 0),
          previous: executed.reduce((s, r) => s + r.prev, 0),
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
    if (some(query.collectorId)) conds.push(Prisma.sql`rp.collector_id IN (${Prisma.join(query.collectorId)})`);
    if (query.branchId) conds.push(Prisma.sql`rp.branch_id = ${query.branchId}`);
    // D7: la parada es de la fuente de su crédito. Una parada sin crédito no es de ninguna y no entra.
    const source = this.sourceSql('vc', query);
    if (source) {
      conds.push(
        Prisma.sql`EXISTS (SELECT 1 FROM credits vc WHERE vc.id = rs.credit_id AND ${source})`,
      );
    }

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
   * Lo recaudado por período y el saldo de cada punto, **cada fuente con su regla** (D7).
   *
   * - **Kobrax: reconstruido hacia atrás.** El de hoy más todo lo cobrado después sobre créditos de
   *   Kobrax. ⚠️ Es la curva de lo que la cobranza bajó, **no la historia del saldo** — ignora
   *   desembolsos y castigos posteriores.
   * - **Externas: el último saldo reportado a esa fecha**, de los snapshots de cada importación. No se
   *   reconstruye con pagos: el saldo de un PSF lo manda su reporte y un pago en Kobrax no lo baja
   *   (D3). Sumarle lo cobrado lo contaba dos veces; y una baja informada por el banco no es cobranza.
   *
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
    const credits = this.creditWhere(query);
    const puntos = Prisma.sql`
      SELECT generate_series(date_trunc(${step}, ${w.from}::timestamptz), ${w.to}::timestamptz, ${interval}::interval) AS d`;

    const [rows, stock, external] = await this.tx((tx) =>
      Promise.all([
        // El `LEFT JOIN` no ata el pago a su punto: cada punto ve TODOS los pagos y los reparte con
        // dos `FILTER` —lo cobrado en el punto y lo cobrado desde el punto en adelante, que es lo
        // que reconstruye el saldo—. Es un cruce de `puntos × pagos`: con 30 puntos y unos miles de
        // pagos no se nota. ponytail: si un día el rango es de años, esto va a una CTE que agregue
        // por período antes de cruzar.
        tx.$queryRaw<{ date: Date; collected: number; after: number }[]>(Prisma.sql`
          WITH puntos AS (${puntos})
          SELECT s.d AS date,
                 COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= s.d AND p.payment_date < s.d + ${interval}::interval), 0)::float8 AS collected,
                 -- Sólo lo cobrado sobre créditos de Kobrax reconstruye saldo (D3, D7).
                 COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= s.d AND pc.external_source IS NULL), 0)::float8 AS after
          FROM puntos s
          -- El tope es HOY y no el fin del rango: el saldo de cada punto se reconstruye con todo lo
          -- cobrado desde esa fecha hasta el saldo actual, que es el único que conocemos. Cortando
          -- en el fin del rango, mirar «mes anterior» dibujaba la curva por debajo de lo real, sin
          -- todo lo cobrado entre esa fecha y hoy.
          LEFT JOIN payments p ON ${payments} AND p.payment_date <= now()
          LEFT JOIN credits pc ON pc.id = p.credit_id
          GROUP BY s.d
          ORDER BY s.d`),
        tx.$queryRaw<{ outstanding: number }[]>(Prisma.sql`
          SELECT COALESCE(SUM(cr.outstanding_balance), 0)::float8 AS outstanding
          FROM credits cr WHERE ${credits} AND cr.external_source IS NULL`),
        /*
         * Cada snapshot vale desde su fecha de corte hasta el corte siguiente de la misma operación
         * (`LEAD`). El punto toma el vigente a su cierre; el período en curso, el último que haya —
         * así el punto de hoy coincide con el saldo del encabezado aunque un reporte venga fechado
         * adelante—. Con dos corridas del mismo corte gana la última: la anterior tiene `next = asof`.
         *
         * Los snapshots `ABSENT` no cortan la curva: la ausencia no cambia el saldo (D4), así que
         * sigue valiendo el último reportado — igual que en el encabezado, que suma el saldo de las
         * ausentes. Y una operación **sin ningún snapshot** (importada antes de que existieran) suma
         * su saldo actual en todos los puntos: no hay historia, pero tampoco es cero.
         */
        tx.$queryRaw<{ date: Date; external: number }[]>(Prisma.sql`
          WITH puntos AS (${puntos}),
          sn AS (
            SELECT x.reported_balance, x.asof,
                   LEAD(x.asof) OVER (PARTITION BY x.credit_id ORDER BY x.asof, x.created_at) AS next_asof
            FROM (
              SELECT sn.credit_id, sn.reported_balance, sn.created_at,
                     COALESCE(sn.reported_as_of, sn.created_at::date) AS asof
              FROM credit_external_snapshots sn
              JOIN credits cr ON cr.id = sn.credit_id
              WHERE ${credits} AND sn.sync_status = 'PRESENT'
            ) x
          ),
          sin_historia AS (
            SELECT COALESCE(SUM(cr.outstanding_balance), 0) AS saldo
            FROM credits cr
            WHERE ${credits} AND cr.external_source IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM credit_external_snapshots z WHERE z.credit_id = cr.id)
          )
          SELECT s.d AS date,
                 (COALESCE(SUM(sn.reported_balance), 0) + (SELECT saldo FROM sin_historia))::float8 AS external
          FROM puntos s
          LEFT JOIN sn ON (
              (s.d + ${interval}::interval > now() AND sn.next_asof IS NULL)
              OR (
                s.d + ${interval}::interval <= now()
                AND sn.asof < s.d + ${interval}::interval
                AND (sn.next_asof IS NULL OR sn.next_asof >= s.d + ${interval}::interval)
              )
            )
          GROUP BY s.d
          ORDER BY s.d`),
      ]),
    );

    const today = money(stock[0]?.outstanding);
    const externalAt = new Map(external.map((e) => [e.date.toISOString(), money(e.external)]));
    return rows.map((r) => {
      const ext = externalAt.get(r.date.toISOString()) ?? 0;
      return {
        date: r.date.toISOString().slice(0, 10),
        collected: money(r.collected),
        outstanding: money(today + Number(r.after ?? 0) + ext),
        outstandingExternal: ext,
      };
    });
  }
}

interface StockRow {
  source?: string;
  credits?: number;
  outstanding: number;
  overdue: number;
  as_of_from?: Date | null;
  as_of_to?: Date | null;
}

/**
 * El desglose por fuente del encabezado (D7): saldo y mora de la misma pasada que el total, y lo
 * recaudado de su propia consulta. Kobrax primero; una fuente sin créditos ni cobros no viaja.
 */
function breakdown(stock: StockRow[], collected: { source: string; collected: number }[]): SourceBreakdown[] {
  const bySource = new Map<string, SourceBreakdown>();
  const entry = (source: string): SourceBreakdown => {
    let e = bySource.get(source);
    if (!e) {
      e = { source: source as SourceBreakdown['source'], credits: 0, outstanding: 0, overdue: 0, collected: 0 };
      bySource.set(source, e);
    }
    return e;
  };
  for (const r of stock) {
    if (!r.source) continue;
    const e = entry(r.source);
    e.credits = r.credits ?? 0;
    e.outstanding = money(r.outstanding);
    e.overdue = money(r.overdue);
    if (r.source !== 'KOBRAX' && r.as_of_from && r.as_of_to) {
      e.reportedAsOf = { from: r.as_of_from.toISOString().slice(0, 10), to: r.as_of_to.toISOString().slice(0, 10) };
    }
  }
  for (const c of collected) {
    if (c.source) entry(c.source).collected = money(c.collected);
  }
  return [...bySource.values()].sort((a, b) =>
    a.source === 'KOBRAX' ? -1 : b.source === 'KOBRAX' ? 1 : a.source.localeCompare(b.source),
  );
}
