/**
 * La hidratación es una secuencia de bajadas independientes que **llama a los mismos services que
 * las pantallas**, para que el respaldo quede guardado bajo la misma consulta que después se pide.
 *
 * El grueso de estos casos existe por un defecto real encontrado probando por cable: se hidrataba
 * la cartera con `limit: 500` y la Cobranza la pedía con `limit: 100`, y la ruta se hidrataba
 * filtrando por estado mientras la pestaña Rutas la pedía sin filtro. Todo se guardaba en casillas
 * que nadie consultaba, así que sin señal esas pantallas salían vacías.
 */
const mockLlamadas: { fn: string; params?: unknown }[] = [];
const mockRes: Record<string, unknown> = {};

const ok = (data: unknown[] = []) => ({ status: 'ok', data, total: data.length });

jest.mock('../cases.service', () => ({
  listCases: jest.fn(async (p: unknown) => {
    mockLlamadas.push({ fn: 'listCases', params: p });
    return mockRes.cases ?? ok([{ id: 'c1', clientId: 'cl1' }]);
  }),
}));
jest.mock('../routes.service', () => ({
  listRoutes: jest.fn(async (p: unknown) => {
    mockLlamadas.push({ fn: 'listRoutes', params: p });
    return mockRes.routes ?? ok([]);
  }),
  getRoute: jest.fn(async () => {
    mockLlamadas.push({ fn: 'getRoute' });
    return { status: 'ok', data: { id: 'r1', stops: [] } };
  }),
}));
jest.mock('../agenda.service', () => ({
  listByDay: jest.fn(async () => {
    mockLlamadas.push({ fn: 'listByDay' });
    return mockRes.agenda ?? ok([]);
  }),
  listOverdue: jest.fn(async () => {
    mockLlamadas.push({ fn: 'listOverdue' });
    return ok([]);
  }),
  clientContext: jest.fn(async () => ok([])),
}));
jest.mock('../catalogs.service', () => ({ listCatalog: jest.fn(async () => ok([{ id: 'k' }])) }));
jest.mock('../notifications.service', () => ({ listNotifications: jest.fn(async () => ok([])) }));
jest.mock('../payments.service', () => ({
  listPaymentsByDay: jest.fn(async () => {
    mockLlamadas.push({ fn: 'listPaymentsByDay' });
    return ok([]);
  }),
}));
jest.mock('../clients.service', () => ({ getClient: jest.fn(async () => ({ status: 'ok', data: { id: 'cl1' } })) }));
jest.mock('../db', () => ({ getMany: jest.fn(async () => [{ clientId: 'cl1' }]), putAll: jest.fn(), fetchedAt: jest.fn(async () => null) }));

import { hydrate } from './hydrate';

const llamada = (fn: string) => mockLlamadas.find((l) => l.fn === fn);

beforeEach(() => {
  mockLlamadas.length = 0;
  delete mockRes.cases;
  delete mockRes.routes;
  delete mockRes.agenda;
});

describe('hydrate · usa las consultas de las pantallas', () => {
  // Si estos parámetros dejan de coincidir con los de la pantalla, el respaldo se guarda en una
  // casilla que nadie lee y la pantalla sale vacía sin señal, aunque la bajada haya salido bien.
  // 🔴 `open: true` incluido: el trabajo diario de la mora cierra el caso del que pagó, y sin ese
  // filtro la Cobranza y el armador de rutas lo seguirían mostrando para ir a cobrarle.
  it('la cartera se baja con los mismos parámetros que la Cobranza', async () => {
    await hydrate('u1');
    expect(llamada('listCases')!.params).toEqual({ view: 'portfolio', open: true, limit: 100 });
  });

  it('las rutas se bajan SIN filtro de estado, como las pide la pestaña Rutas', async () => {
    await hydrate('u1');
    const sinFiltro = mockLlamadas.filter((l) => l.fn === 'listRoutes').map((l) => l.params);
    expect(sinFiltro).toContainEqual({ collectorId: 'u1' });
  });

  // Sin esto, el cierre de jornada sin señal anunciaba "recaudado hoy Bs 0,00", que es mentira.
  it('baja lo cobrado hoy, que es lo que muestran el Inicio, Rutas y el resumen', async () => {
    await hydrate('u1');
    expect(llamada('listPaymentsByDay')).toBeDefined();
  });

  it('además baja la ruta activa, que es la que mira el Inicio', async () => {
    await hydrate('u1');
    const conEstado = mockLlamadas.filter((l) => l.fn === 'listRoutes').map((l) => JSON.stringify(l.params));
    expect(conEstado.some((p) => p.includes('status'))).toBe(true);
  });
});

describe('hydrate · tolerancia a fallos', () => {
  it('baja la jornada completa y lo reporta', async () => {
    const r = await hydrate('u1');
    expect(r.failed).toEqual([]);
    expect(r.ok).toContain('cartera');
    expect(r.offline).toBe(false);
  });

  // Si un fallo cortara la secuencia, quedarse sin agenda dejaría al cobrador también sin cartera.
  it('una bajada que falla no impide las otras', async () => {
    mockRes.agenda = { status: 'error', message: 'boom' };
    const r = await hydrate('u1');
    expect(r.failed).toContain('agenda');
    expect(r.ok).toContain('cartera');
  });

  it('sin red lo dice, para que la pantalla no culpe al servidor', async () => {
    mockRes.cases = { status: 'offline' };
    const r = await hydrate('u1');
    expect(r.offline).toBe(true);
  });

  it('si no hay ruta activa no pide el detalle de nada', async () => {
    mockRes.routes = ok([]);
    await hydrate('u1');
    expect(llamada('getRoute')).toBeUndefined();
  });
});
