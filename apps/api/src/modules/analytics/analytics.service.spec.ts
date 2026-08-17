import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AGING_BUCKETS } from '@kobrax/shared';
import { AnalyticsService } from './analytics.service';

/**
 * Fake de Prisma que **guarda el SQL y los `where`**: lo que se verifica acá es la consulta, no la
 * base. Las cuatro agregaciones que no se pueden escribir con Prisma pasan por `$queryRaw`; las
 * otras dos por el cliente tipado, y de ésas se mira el filtro.
 */
function makeService(
  rowsFor: (sql: string) => unknown[] = () => [],
  counts: { cases?: number[]; payments?: number[]; groups?: Record<string, unknown>[] } = {},
) {
  const sqls: string[] = [];
  const wheres: Record<string, unknown>[] = [];
  let caseCall = 0;
  let payCall = 0;
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      sqls.push(q.sql);
      return rowsFor(q.sql);
    },
    collectionCase: {
      count: async (args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        return counts.cases?.[caseCall++] ?? 0;
      },
    },
    payment: {
      aggregate: async (args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        return { _sum: { amount: counts.payments?.[payCall++] ?? 0 } };
      },
      count: async (args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        return counts.payments?.[payCall++] ?? 0;
      },
    },
    agendaItem: {
      groupBy: async (args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        return counts.groups ?? [];
      },
    },
    account: { findFirst: async () => ({ currencyCode: 'BOB' }) },
  };
  const prisma = { withTenant: <T>(_acc: string, fn: (t: unknown) => Promise<T>) => fn(tx) };
  const service = new AnalyticsService(prisma as never, { accountId: 'acc-1' } as never);
  return { service, sqls, wheres, find: (needle: string) => sqls.find((s) => s.includes(needle)) };
}

describe('summary', () => {
  it('🔴 los saldos NO inventan su período anterior', async () => {
    // La base no guarda cuánto se debía la semana pasada. `previous: null` es «no se puede saber»,
    // que no es lo mismo que cero: con cero, la pantalla dibujaría una flecha inventada sobre plata.
    const { service } = makeService(
      (sql) => (sql.includes('FROM credits') ? [{ outstanding: 1000, overdue: 250 }] : []),
      { cases: [12, 9], payments: [400, 200] },
    );

    const out = await service.summary({});
    assert.equal(out.outstanding.previous, null);
    assert.equal(out.overdue.previous, null);
    assert.equal(out.overdueRate.previous, null);
    // Los dos que SÍ se pueden reconstruir: lo cobrado (es un flujo) y los casos abiertos
    // (`created_at`/`closed_at` cuentan su propia historia).
    assert.equal(out.collected.previous, 200);
    assert.equal(out.activeCases.previous, 9);
    assert.equal(out.overdueRate.value, 25);
  });

  it('la ventana anterior mide lo mismo y termina justo antes', async () => {
    const { service, wheres } = makeService(() => []);
    await service.summary({ dateFrom: '2026-08-10', dateTo: '2026-08-16' });

    // Los dos rangos de pagos: el pedido y el anterior. Si midieran distinto, la comparación no
    // diría nada; y si se solaparan, contarían dos veces los mismos pagos.
    const rangos = wheres
      .map((w) => (w as { paymentDate?: { gte: Date; lte: Date } }).paymentDate)
      .filter((d): d is { gte: Date; lte: Date } => !!d);
    assert.equal(rangos.length, 2);
    const [ahora, antes] = rangos;
    assert.equal(ahora!.lte.getTime() - ahora!.gte.getTime(), antes!.lte.getTime() - antes!.gte.getTime());
    assert.ok(antes!.lte < ahora!.gte, 'la ventana anterior termina antes de que empiece la actual');
  });

  it('🔴 filtrar por cobrador no duplica el saldo', async () => {
    // Un crédito puede tener más de un caso: con un JOIN su saldo se sumaría una vez por caso y el
    // KPI daría de más sin que nada se vea roto. Por eso va con EXISTS.
    const { service, find } = makeService(() => []);
    await service.summary({ collectorId: ['11111111-2222-3333-4444-555555555555'] });
    const sql = find('FROM credits');
    assert.match(sql!, /EXISTS \(SELECT 1 FROM collection_cases/);
  });

  it('🔴 ningún id se castea a ::uuid', async () => {
    // Los ids del esquema son `text`. `assignee_id = $1::uuid` es `operator does not exist:
    // text = uuid`: un 500 en los seis endpoints apenas alguien elige un cobrador. Este fake no
    // ejecuta SQL —por eso el defecto vivió hasta que se probó contra Postgres—, así que lo que se
    // mira es que el cast no esté escrito.
    const { service, sqls } = makeService(() => []);
    const filtros = {
      collectorId: ['11111111-2222-3333-4444-555555555555'],
      branchId: '22222222-3333-4444-5555-666666666666',
    };
    await service.summary(filtros);
    await service.collectorPerformance(filtros);
    await service.visitMap(filtros);
    await service.collectionTrend(filtros);
    assert.equal(sqls.filter((s) => s.includes('::uuid')).length, 0);
  });

  it('varios cobradores entran al mismo filtro', async () => {
    // Multiselect: la pantalla manda una lista y la consulta usa `IN`. Con `=` sólo miraría el
    // primero y la pantalla mostraría menos de lo que la persona eligió, sin decir nada.
    const { service, find } = makeService(() => []);
    await service.collectorPerformance({ collectorId: ['u1', 'u2'] });
    // Dos marcadores adentro del `IN`: los valores viajan parametrizados, no escritos en el SQL.
    assert.match(find('FROM collection_cases')!, /k\.assignee_id IN \([^)]+,[^)]+\)/);
  });

  it('🔴 una lista vacía no filtra (y no escribe `IN ()`)', async () => {
    // `?collectorId=` llega como lista vacía, que es un objeto y pasa cualquier `if`. Con un
    // `Prisma.join` de cero elementos la consulta sale `IN ()`: error de sintaxis, no «sin filtro».
    const { service, find } = makeService(() => []);
    await service.collectorPerformance({ collectorId: [], caseStatus: [] });
    assert.doesNotMatch(find('FROM collection_cases')!, /IN \(\)/);
  });
});

describe('portfolioAging', () => {
  it('los tramos salen de la constante de shared, no de una copia', async () => {
    const { service, sqls } = makeService(() => []);
    await service.portfolioAging({});
    // Un `WHEN` por tramo, y **todos menos el último con techo**: el de arriba es `>= 451` y nada
    // más. Se cuentan en vez de mirar el texto porque los valores viajan parametrizados.
    assert.equal((sqls[0]!.match(/WHEN/g) ?? []).length, AGING_BUCKETS.length);
    assert.equal((sqls[0]!.match(/BETWEEN/g) ?? []).length, AGING_BUCKETS.length - 1);
  });

  it('un tramo sin créditos viaja en cero, no desaparece', async () => {
    // Una porción que falta se lee como que ese tramo no existe; lo que pasa es que hoy no hay nadie.
    const { service } = makeService(() => [{ bucket: 'D1_30', amount: 500, credits: 2 }]);
    const rows = await service.portfolioAging({});
    assert.equal(rows.length, AGING_BUCKETS.length);
    assert.deepEqual(rows[0], { bucket: 'D1_30', amount: 500, credits: 2 });
    assert.deepEqual(rows[1], { bucket: 'D31_90', amount: 0, credits: 0 });
  });
});

describe('collectorPerformance', () => {
  it('🔴 el `deleted_at` del crédito va en el ON', async () => {
    // En el WHERE, el LEFT JOIN se comporta como INNER y el cobrador sin créditos vivos desaparece
    // del ranking en vez de aparecer en cero. Es el mismo defecto que ya se pagó en la cartera (W3).
    const { service, find } = makeService(() => []);
    await service.collectorPerformance({});
    assert.match(find('LEFT JOIN credits')!, /LEFT JOIN credits cr ON cr\.id = k\.credit_id AND cr\.deleted_at IS NULL/);
  });

  it('junta la carga con lo recaudado por persona', async () => {
    const { service } = makeService((sql) =>
      sql.includes('FROM collection_cases')
        ? [{ collector: 'u1', cases: 10, outstanding: 1000, overdue: 400 }]
        : [{ collector: 'u1', collected: 250 }],
    );
    const rows = await service.collectorPerformance({});
    assert.deepEqual(rows[0], {
      collectorId: 'u1',
      cases: 10,
      outstanding: 1000,
      overdue: 400,
      overdueRate: 40,
      collected: 250,
    });
  });
});

describe('collectionTrend', () => {
  it('🔴 un período sin pagos existe y vale cero', async () => {
    // Sin `generate_series` la línea saltea los días vacíos: el gráfico miente por omisión.
    const { service, sqls } = makeService(() => []);
    await service.collectionTrend({});
    assert.match(sqls[0]!, /generate_series/);
  });

  it('el saldo de cada punto es el de hoy más lo cobrado después', async () => {
    const { service } = makeService((sql) =>
      sql.includes('generate_series')
        ? [{ date: new Date('2026-08-10T00:00:00.000Z'), collected: 100, after: 300 }]
        : [{ outstanding: 5000 }],
    );
    const points = await service.collectionTrend({});
    assert.deepEqual(points, [{ date: '2026-08-10', collected: 100, outstanding: 5300 }]);
  });
});
