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
  counts: { payments?: number[]; groups?: Record<string, unknown>[] } = {},
) {
  const sqls: string[] = [];
  const wheres: Record<string, unknown>[] = [];
  let payCall = 0;
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      sqls.push(q.sql);
      return rowsFor(q.sql);
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
      (sql) =>
        sql.includes('credit_arrear_episodes')
          ? [{ now: 12, prev: 9 }]
          : sql.includes('FROM credits')
            ? [{ outstanding: 1000, overdue: 250 }]
            : [],
      { payments: [400, 200] },
    );

    const out = await service.summary({});
    assert.equal(out.outstanding.previous, null);
    assert.equal(out.overdue.previous, null);
    assert.equal(out.overdueRate.previous, null);
    // Los dos que SÍ se pueden reconstruir: lo cobrado (es un flujo) y los créditos en mora (el episodio
    // cuenta su propia historia con sus fechas de inicio y fin).
    assert.equal(out.collected.previous, 200);
    assert.equal(out.creditsInArrears.previous, 9);
    assert.equal(out.overdueRate.value, 25);
  });

  /**
   * F4/08: «casos activos» pasó a «créditos en mora» (episodios abiertos). `activeCases` sigue en la respuesta, con
   * el mismo número, mientras la web lo lea.
   */
  it('🔴 créditos en mora = episodios ABIERTOS; activeCases es el mismo número (deprecado)', async () => {
    const { service, find } = makeService((sql) => (sql.includes('credit_arrear_episodes') ? [{ now: 12, prev: 9 }] : []));
    const out = await service.summary({});
    assert.deepEqual(out.creditsInArrears, { value: 12, previous: 9 });
    assert.deepEqual(out.activeCases, out.creditsInArrears);
    const sql = find('credit_arrear_episodes')!;
    assert.match(sql, /e\.ended_at IS NULL/);
    assert.doesNotMatch(sql, /collection_cases/);
  });

  it('el período anterior se reconstruye con inicio y fin del episodio', async () => {
    const { service, find } = makeService(() => []);
    await service.summary({ dateFrom: '2026-08-10', dateTo: '2026-08-16' });
    const sql = find('credit_arrear_episodes')!;
    assert.match(sql, /e\.started_at <= .*::date AND \(e\.ended_at IS NULL OR e\.ended_at > .*::date\)/);
  });

  it('sin episodios devuelve cero, no undefined', async () => {
    const { service } = makeService(() => []);
    const out = await service.summary({});
    assert.deepEqual(out.creditsInArrears, { value: 0, previous: 0 });
  });

  it('el filtro caseStatus heredado se acepta y se ignora', async () => {
    const { service, sqls } = makeService(() => []);
    await service.summary({ caseStatus: ['PENDING'] });
    assert.ok(sqls.every((q) => !q.includes('collection_cases') && !/status::text IN/.test(q)));
  });

  it('prioridad: la del episodio abierto; cobrador: el responsable del crédito', async () => {
    const { service, sqls } = makeService(() => []);
    await service.summary({ priority: ['HIGH'], collectorId: ['u1'] });
    const stock = sqls.find((q) => q.includes('FROM credits cr'))!;
    assert.match(stock, /cr\.assigned_manager_id IN/);
    assert.match(stock, /EXISTS \(SELECT 1 FROM credit_arrear_episodes pe WHERE pe\.credit_id = cr\.id AND pe\.ended_at IS NULL AND pe\.priority::text IN/);
    assert.ok(sqls.every((q) => !q.includes('collection_cases')));
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
    // El filtro es sobre una columna del propio crédito (el responsable): sin JOIN no hay nada que duplicar.
    const { service, find } = makeService(() => []);
    await service.summary({ collectorId: ['11111111-2222-3333-4444-555555555555'] });
    const sql = find('FROM credits')!;
    assert.match(sql, /cr\.assigned_manager_id IN/);
    assert.doesNotMatch(sql, /JOIN/);
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
    assert.match(find('assigned_manager_id')!, /cr\.assigned_manager_id IN \([^)]+,[^)]+\)/);
  });

  it('🔴 una lista vacía no filtra (y no escribe `IN ()`)', async () => {
    // `?collectorId=` llega como lista vacía, que es un objeto y pasa cualquier `if`. Con un
    // `Prisma.join` de cero elementos la consulta sale `IN ()`: error de sintaxis, no «sin filtro».
    const { service, find } = makeService(() => []);
    await service.collectorPerformance({ collectorId: [], caseStatus: [] });
    assert.doesNotMatch(find('assigned_manager_id')!, /IN \(\)/);
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
  /** F4/08: agrupa por el responsable del crédito; ya no existe el cobrador del caso. */
  it('🔴 agrupa por el responsable del crédito y no toca los casos', async () => {
    const { service, find } = makeService(() => []);
    await service.collectorPerformance({});
    const sql = find('assigned_manager_id')!;
    assert.match(sql, /GROUP BY cr\.assigned_manager_id/);
    assert.match(sql, /cr\.assigned_manager_id IS NOT NULL/);
    assert.doesNotMatch(sql, /collection_cases/);
  });

  it('cuenta los créditos en mora con un EXISTS sobre el episodio abierto', async () => {
    const { service, find } = makeService(() => []);
    await service.collectorPerformance({});
    assert.match(find('assigned_manager_id')!, /COUNT\(\*\) FILTER \(\s*WHERE EXISTS \(SELECT 1 FROM credit_arrear_episodes oe WHERE oe\.credit_id = cr\.id AND oe\.ended_at IS NULL\)/);
  });

  it('junta la carga con lo recaudado por persona (cases = creditsInArrears, deprecado)', async () => {
    const { service } = makeService((sql) =>
      sql.includes('assigned_manager_id')
        ? [{ collector: 'u1', arrears: 10, outstanding: 1000, overdue: 400 }]
        : [{ collector: 'u1', collected: 250 }],
    );
    const rows = await service.collectorPerformance({});
    assert.deepEqual(rows[0], {
      collectorId: 'u1',
      cases: 10,
      creditsInArrears: 10,
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
      sql.includes('credit_external_snapshots')
        ? []
        : sql.includes('generate_series')
          ? [{ date: new Date('2026-08-10T00:00:00.000Z'), collected: 100, after: 300 }]
          : [{ outstanding: 5000 }],
    );
    const points = await service.collectionTrend({});
    assert.deepEqual(points, [{ date: '2026-08-10', collected: 100, outstanding: 5300, outstandingExternal: 0 }]);
  });

  /**
   * 🔴 D3 + D7: el saldo de un PSF lo manda su reporte y un pago en Kobrax no lo baja. Reconstruirlo
   * sumándole lo cobrado lo contaba dos veces; se toma el último saldo reportado a esa fecha.
   */
  it('🔴 la parte externa sale de los snapshots, no de sumarle pagos', async () => {
    const date = new Date('2026-08-10T00:00:00.000Z');
    const { service, sqls } = makeService((sql) =>
      sql.includes('credit_external_snapshots')
        ? [{ date, external: 2000 }]
        : sql.includes('generate_series')
          ? [{ date, collected: 100, after: 300 }]
          : [{ outstanding: 5000 }],
    );
    const points = await service.collectionTrend({});
    assert.deepEqual(points, [{ date: '2026-08-10', collected: 100, outstanding: 7300, outstandingExternal: 2000 }]);
    // Sólo lo cobrado sobre Kobrax reconstruye; y el saldo de hoy que se reconstruye es sólo el de Kobrax.
    assert.match(sqls.find((q) => q.includes('AS after'))!, /pc\.external_source IS NULL/);
    assert.match(sqls.find((q) => q.includes('FROM credits cr WHERE'))!, /cr\.external_source IS NULL/);
  });
});

/** D7: por fuente, nunca mezclados en silencio. */
describe('fuente de los créditos (D7)', () => {
  it('el encabezado trae el desglose por fuente y el total es su suma', async () => {
    const { service } = makeService((sql) => {
      if (sql.includes('FROM payments p')) return [{ source: 'PSF', collected: 50 }, { source: 'KOBRAX', collected: 400 }];
      if (sql.includes('FROM credits')) {
        return [
          { source: 'KOBRAX', credits: 10, outstanding: 1000, overdue: 200, as_of_from: null, as_of_to: null },
          {
            source: 'PSF',
            credits: 3,
            outstanding: 600,
            overdue: 600,
            as_of_from: new Date('2026-09-28T00:00:00Z'),
            as_of_to: new Date('2026-09-30T00:00:00Z'),
          },
        ];
      }
      return [];
    });
    const out = await service.summary({});
    assert.equal(out.outstanding.value, 1600);
    assert.equal(out.overdue.value, 800);
    assert.deepEqual(out.bySource, [
      { source: 'KOBRAX', credits: 10, outstanding: 1000, overdue: 200, collected: 400 },
      {
        source: 'PSF',
        credits: 3,
        outstanding: 600,
        overdue: 600,
        collected: 50,
        reportedAsOf: { from: '2026-09-28', to: '2026-09-30' },
      },
    ]);
  });

  it('filtrar Kobrax es «sin fuente externa», en los seis caminos', async () => {
    const { service, sqls, wheres } = makeService(() => []);
    await service.summary({ source: 'KOBRAX' });
    await service.agendaSummary({ source: 'KOBRAX' });
    await service.visitMap({ source: 'KOBRAX' });
    assert.match(sqls.find((q) => q.includes('FROM credits cr'))!, /cr\.external_source IS NULL/);
    assert.match(sqls.find((q) => q.includes('FROM payments p'))!, /sc\.external_source IS NULL/);
    assert.match(sqls.find((q) => q.includes('FROM agenda_items a'))!, /sc\.external_source IS NULL/);
    const stops = sqls.find((q) => q.includes('FROM route_stops'))!;
    assert.match(stops, /vc\.external_source IS NULL/);
    assert.match(stops, /FROM credits vc WHERE vc\.id = rs\.credit_id/, 'la parada se une al crédito, no al caso');
    assert.doesNotMatch(stops, /collection_cases/);
    // Los que van por Prisma: los pagos filtran por la relación con el crédito.
    assert.ok(wheres.every((w) => (w as { credit?: unknown }).credit !== undefined));
    assert.deepEqual((wheres[0] as { credit: unknown }).credit, { externalSource: null });
  });

  it('filtrar PSF compara la fuente como parámetro, no pegada en el SQL', async () => {
    const { service, sqls } = makeService(() => []);
    await service.collectorPerformance({ source: 'PSF' });
    const load = sqls.find((q) => q.includes('assigned_manager_id IS NOT NULL'))!;
    assert.match(load, /cr.external_source = (\?|\$\d+)/);
    assert.doesNotMatch(load, /'PSF'/);
  });

  it('sin fuente no filtra nada', async () => {
    const { service, sqls } = makeService(() => []);
    await service.portfolioAging({});
    assert.doesNotMatch(sqls[0]!, /external_source/);
  });
});
