import { describe, expect, it } from 'vitest';
import { RouteStatus, RouteStopStatus, summarizeDay, type RouteItem } from '@kobrax/shared';
import {
  CATEGORY_TONE,
  DEFAULT_PAGE_SIZE,
  ROUTE_STATUS_TONE,
  STOP_STATUS_TONE,
  hasRouteFilters,
  routeLimit,
  routeMode,
  routePeriod,
  routeQuery,
  routeView,
  summarizeByCollector,
  totalWork,
} from './routes';

const COLLECTOR = '11111111-2222-3333-4444-555555555555';

describe('routeQuery', () => {
  it('no manda los filtros vacíos', () => {
    expect(routeQuery({}).toString()).toBe(`page=1&limit=${DEFAULT_PAGE_SIZE}`);
  });

  it('manda el día, el cobrador y el estado cuando están', () => {
    const query = routeQuery({ date: '2026-08-12', collectorId: COLLECTOR, status: 'IN_PROGRESS' });
    expect(query.get('date')).toBe('2026-08-12');
    expect(query.get('collectorId')).toBe(COLLECTOR);
    expect(query.get('status')).toBe('IN_PROGRESS');
  });

  it('una página inválida cae en la primera', () => {
    expect(routeQuery({ page: '0' }).get('page')).toBe('1');
    expect(routeQuery({ page: 'x' }).get('page')).toBe('1');
  });

  it('🔴 un cobrador o un estado inventado NO viajan', () => {
    // El DTO los valida como uuid y como enum: un valor de más —una preferencia guardada, una URL
    // tocada a mano— devolvería 400 y dejaría la pantalla entera sin rutas.
    expect(routeQuery({ collectorId: 'u1' }).has('collectorId')).toBe(false);
    expect(routeQuery({ status: 'CUALQUIERA' }).has('status')).toBe(false);
  });

  it('el tamaño de página sale de la URL, y uno inventado cae en el default', () => {
    expect(routeQuery({ pageSize: '100' }).get('limit')).toBe('100');
    // La API valida `limit ≤ 100`: pedir 500 es un 400, no una lista más larga.
    expect(routeLimit({ pageSize: '500' })).toBe(DEFAULT_PAGE_SIZE);
    expect(routeLimit({})).toBe(DEFAULT_PAGE_SIZE);
  });

  it('manda las tres claves que la API sabe ordenar', () => {
    expect(routeQuery({ sort: 'collector', dir: 'asc' }).get('sort')).toBe('collector');
    expect(routeQuery({ sort: 'collector', dir: 'asc' }).get('dir')).toBe('asc');
    expect(routeQuery({ sort: 'status' }).get('sort')).toBe('status');
    expect(routeQuery({ sort: 'date' }).get('sort')).toBe('date');
  });

  it('🔴 una clave que el servidor no conoce NO viaja', () => {
    // La API caería a su orden por defecto y la tabla dibujaría una flecha sobre una columna que no
    // ordenó nada. `stops` y `distance` son justamente las dos que no se ofrecen.
    expect(routeQuery({ sort: 'stops' }).has('sort')).toBe(false);
    expect(routeQuery({ sort: 'distance' }).has('sort')).toBe(false);
    expect(routeQuery({}).has('sort')).toBe(false);
  });

  it('sin sentido explícito, descendente', () => {
    expect(routeQuery({ sort: 'date' }).get('dir')).toBe('desc');
  });
});

describe('modo y vista', () => {
  it('sin nada en la URL: historial, por día', () => {
    // Es la pantalla que se abre veinte veces al día. Cualquier otra cosa por default sería
    // hacerle pagar a todo el mundo el camino que se recorre una vez por semana.
    expect(routeMode({})).toBe('historial');
    expect(routeView({})).toBe('dia');
  });

  it('un valor inventado cae al default en vez de dejar la pantalla en blanco', () => {
    expect(routeMode({ modo: 'cualquiera' })).toBe('historial');
    expect(routeView({ vista: 'cualquiera' })).toBe('dia');
    expect(routeMode({ modo: 'planificacion' })).toBe('planificacion');
    expect(routeView({ vista: 'periodo' })).toBe('periodo');
  });
});

describe('routePeriod', () => {
  const HOY = new Date('2026-08-18T12:00:00.000Z');

  it('sin período en la URL, la última semana contando hoy', () => {
    expect(routePeriod({}, HOY)).toEqual({ from: '2026-08-12', to: '2026-08-18' });
  });

  it('una fecha inventada cae al default, no rompe ni viaja', () => {
    expect(routePeriod({ from: 'ayer', to: '18/08/2026' }, HOY)).toEqual({ from: '2026-08-12', to: '2026-08-18' });
  });

  it('🔴 un rango al revés se ordena en vez de devolver cero rutas', () => {
    // Pasa editando la URL a mano, y un rango invertido no da error: da una lista vacía que se
    // lee como «esta semana nadie trabajó».
    expect(routePeriod({ from: '2026-08-18', to: '2026-08-12' }, HOY)).toEqual({
      from: '2026-08-12',
      to: '2026-08-18',
    });
  });
});

describe('routeQuery con período', () => {
  it('manda el rango y NO el día: la API le da prioridad al día', () => {
    // Mandando los dos, la API devuelve una jornada y la pantalla mostraría una semana con una
    // sola fecha adentro.
    const q = routeQuery({ date: '2026-08-20', period: { from: '2026-08-12', to: '2026-08-18' } });
    expect(q.get('from')).toBe('2026-08-12');
    expect(q.get('to')).toBe('2026-08-18');
    expect(q.has('date')).toBe(false);
  });

  it('sin período sigue mandando el día, como siempre', () => {
    const q = routeQuery({ date: '2026-08-20' });
    expect(q.get('date')).toBe('2026-08-20');
    expect(q.has('from')).toBe(false);
  });
});

describe('summarizeByCollector', () => {
  const ruta = (over: Partial<RouteItem>): RouteItem => ({
    id: 'r',
    collectorId: 'u1',
    plannedDate: '2026-08-12T00:00:00.000Z',
    status: RouteStatus.COMPLETED,
    totalCases: 8,
    createdAt: '2026-08-12T08:00:00.000Z',
    ...over,
  });

  it('suma paradas, visitadas y días por persona', () => {
    const rows = summarizeByCollector([
      ruta({ id: 'a', collectorId: 'ana', plannedDate: '2026-08-12T00:00:00.000Z', totalCases: 8, visitedCount: 7 }),
      ruta({ id: 'b', collectorId: 'ana', plannedDate: '2026-08-13T00:00:00.000Z', totalCases: 9, visitedCount: 8 }),
      ruta({ id: 'c', collectorId: 'juan', plannedDate: '2026-08-12T00:00:00.000Z', totalCases: 4, visitedCount: 1 }),
    ]);

    expect(rows.map((r) => r.collectorId)).toEqual(['ana', 'juan']); // más paradas primero
    expect(rows[0]).toMatchObject({ days: 2, routes: 2, stops: 17, done: 15, pending: 2 });
    expect(rows[1]).toMatchObject({ days: 1, routes: 1, stops: 4, done: 1, pending: 3 });
  });

  it('🔴 dos rutas el mismo día cuentan UN día activo', () => {
    // No debería pasar (la base lo impide desde el unique), pero si pasara, «días activos» tiene
    // que seguir contando días y no rutas: son dos preguntas distintas y hay una columna para cada una.
    const rows = summarizeByCollector([
      ruta({ id: 'a', plannedDate: '2026-08-12T00:00:00.000Z' }),
      ruta({ id: 'b', plannedDate: '2026-08-12T00:00:00.000Z' }),
    ]);
    expect(rows[0]!.days).toBe(1);
    expect(rows[0]!.routes).toBe(2);
  });

  it('sin `visitedCount` no inventa un cero de completadas… pero tampoco un pendiente negativo', () => {
    const rows = summarizeByCollector([ruta({ totalCases: 5, visitedCount: undefined })]);
    expect(rows[0]!.done).toBe(0);
    expect(rows[0]!.pending).toBe(5);

    // Y si un día el contador viniera más alto que el total, «sin gestionar» es cero, no -2.
    const raro = summarizeByCollector([ruta({ totalCases: 3, visitedCount: 5 })]);
    expect(raro[0]!.pending).toBe(0);
  });

  it('sin rutas, sin filas: nadie trabajó, no es un cobrador en cero', () => {
    expect(summarizeByCollector([])).toEqual([]);
    expect(totalWork([])).toEqual({ collectors: 0, stops: 0, done: 0, pending: 0 });
  });

  it('los totales son la suma de las filas que se ven', () => {
    const rows = summarizeByCollector([
      ruta({ collectorId: 'ana', totalCases: 8, visitedCount: 7 }),
      ruta({ collectorId: 'juan', totalCases: 4, visitedCount: 1 }),
    ]);
    expect(totalWork(rows)).toEqual({ collectors: 2, stops: 12, done: 8, pending: 4 });
  });
});

describe('hasRouteFilters', () => {
  it('el día NO cuenta como filtro: siempre hay uno', () => {
    // Si contara, el vacío diría «no hay resultados con esos filtros» en vez de «no hubo rutas ese
    // día», que es lo que de verdad pasó.
    expect(hasRouteFilters({})).toBe(false);
    expect(hasRouteFilters({ collectorId: 'u1' })).toBe(true);
    expect(hasRouteFilters({ status: 'PLANNED' })).toBe(true);
  });
});

describe('los tonos cubren todos los estados', () => {
  it('ninguno queda sin color', () => {
    for (const status of Object.values(RouteStatus)) expect(ROUTE_STATUS_TONE[status]).toBeTruthy();
    for (const status of Object.values(RouteStopStatus)) expect(STOP_STATUS_TONE[status]).toBeTruthy();
  });

  it('cada categoría del resumen tiene el suyo, y ninguna queda afuera', () => {
    // `summarizeDay` sólo devuelve categorías con al menos una parada, pero las cinco existen y
    // una sin color se dibujaría como neutra sin que nadie lo haya decidido.
    const all = ['COLLECTED', 'PROMISED', 'NO_ANSWER', 'UNREACHABLE', 'OTHER'] as const;
    for (const key of all) expect(CATEGORY_TONE[key]).toBeTruthy();
    expect(CATEGORY_TONE.COLLECTED).toBe('success');
    expect(CATEGORY_TONE.NO_ANSWER).toBe('danger');
  });
});

describe('summarizeDay sobre una ruta del listado', () => {
  it('🔴 sin paradas no inventa avance: el listado no las trae', () => {
    // `GET /routes` no incluye `stops`. Mostrar «0 de 0» sería una mentira, no un cero — por eso
    // el avance vive en el detalle y no en la tabla.
    const route: RouteItem = {
      id: 'r1',
      collectorId: 'u1',
      plannedDate: '2026-08-12',
      status: RouteStatus.IN_PROGRESS,
      totalCases: 8,
      createdAt: '2026-08-12T08:00:00.000Z',
    };
    const summary = summarizeDay(route);
    expect(summary.total).toBe(0);
    expect(summary.percent).toBe(0);
    expect(route.totalCases).toBe(8); // lo que la tabla SÍ puede mostrar
  });
});
