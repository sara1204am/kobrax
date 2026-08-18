import { describe, expect, it } from 'vitest';
import { RouteStatus, RouteStopStatus, summarizeDay, type RouteItem } from '@kobrax/shared';
import {
  CATEGORY_TONE,
  DEFAULT_PAGE_SIZE,
  ROUTE_STATUS_TONE,
  STOP_STATUS_TONE,
  hasRouteFilters,
  routeLimit,
  routeQuery,
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

  it('no manda `sort`: el listado ordena por fecha y no acepta otra cosa', () => {
    // Mandarlo haría que la tabla dibujara una flecha sobre una columna que no ordenó nada.
    expect(routeQuery({ date: '2026-08-12' }).has('sort')).toBe(false);
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
