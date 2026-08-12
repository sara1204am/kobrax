import { describe, expect, it } from 'vitest';
import { RouteStatus, RouteStopStatus, summarizeDay, type RouteItem } from '@kobrax/shared';
import { ROUTE_STATUS_TONE, STOP_STATUS_TONE, hasRouteFilters, routeQuery } from './routes';

describe('routeQuery', () => {
  it('no manda los filtros vacíos', () => {
    expect(routeQuery({}, 20).toString()).toBe('page=1&limit=20');
  });

  it('manda el día, el cobrador y el estado cuando están', () => {
    const query = routeQuery({ date: '2026-08-12', collectorId: 'u1', status: 'IN_PROGRESS' }, 20);
    expect(query.get('date')).toBe('2026-08-12');
    expect(query.get('collectorId')).toBe('u1');
    expect(query.get('status')).toBe('IN_PROGRESS');
  });

  it('una página inválida cae en la primera', () => {
    expect(routeQuery({ page: '0' }, 20).get('page')).toBe('1');
    expect(routeQuery({ page: 'x' }, 20).get('page')).toBe('1');
  });

  it('no manda `sort`: el listado ordena por fecha y no acepta otra cosa', () => {
    // Mandarlo haría que la tabla dibujara una flecha sobre una columna que no ordenó nada.
    expect(routeQuery({ date: '2026-08-12' }, 20).has('sort')).toBe(false);
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
