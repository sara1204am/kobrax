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

jest.mock('../mora.service', () => ({
  MORA_LIMIT: 100,
  TENANT_CURRENCY_PROBE_LIMIT: 1,
  listPortfolio: jest.fn(async () => {
    mockLlamadas.push({ fn: 'listPortfolio' });
    return mockRes.portfolio ?? ok([{ id: 'cr1', creditId: 'cr1', clientId: 'cl1' }]);
  }),
  listMora: jest.fn(async (p: unknown) => {
    mockLlamadas.push({ fn: 'listMora', params: p });
    return mockRes.mora ?? ok([]);
  }),
  getMora: jest.fn(async (id: string) => {
    mockLlamadas.push({ fn: 'getMora', params: id });
    return ok([]);
  }),
  listMoraEpisodes: jest.fn(async (id: string) => {
    mockLlamadas.push({ fn: 'listMoraEpisodes', params: id });
    return mockRes.episodes ?? ok([]);
  }),
  getMoraMetrics: jest.fn(async (id: string) => {
    mockLlamadas.push({ fn: 'getMoraMetrics', params: id });
    return ok([]);
  }),
  listMoraPromises: jest.fn(async (id: string) => {
    mockLlamadas.push({ fn: 'listMoraPromises', params: id });
    return mockRes.promises ?? ok([]);
  }),
  listMoraNotes: jest.fn(async (id: string) => {
    mockLlamadas.push({ fn: 'listMoraNotes', params: id });
    return ok([]);
  }),
  listArrearCategories: jest.fn(async () => {
    mockLlamadas.push({ fn: 'listArrearCategories' });
    return ok([]);
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
  clientContext: jest.fn(async () => ({ status: 'ok', data: { credits: [{ creditId: 'cr1' }, { creditId: 'cr2' }] }, total: 1 })),
}));
jest.mock('../catalogs.service', () => ({ listCatalog: jest.fn(async () => ok([{ id: 'k' }])) }));
jest.mock('../notifications.service', () => ({ listNotifications: jest.fn(async () => ok([])) }));
jest.mock('../payments.service', () => ({
  listPaymentsByDay: jest.fn(async () => {
    mockLlamadas.push({ fn: 'listPaymentsByDay' });
    return ok([]);
  }),
  listCreditPayments: jest.fn(async (id: string) => {
    mockLlamadas.push({ fn: 'listCreditPayments', params: id });
    return ok([]);
  }),
}));
jest.mock('../clients.service', () => ({ getClient: jest.fn(async () => ({ status: 'ok', data: { id: 'cl1' } })) }));
jest.mock('../db', () => ({ getMany: jest.fn(async (kind: string) => (kind === 'portfolio' ? [{ clientId: 'cl1' }] : [])), putAll: jest.fn(), fetchedAt: jest.fn(async () => null) }));

import { hydrate } from './hydrate';

const llamada = (fn: string) => mockLlamadas.find((l) => l.fn === fn);

beforeEach(() => {
  mockLlamadas.length = 0;
  delete mockRes.portfolio;
  delete mockRes.mora;
  delete mockRes.routes;
  delete mockRes.agenda;
  delete mockRes.episodes;
  delete mockRes.promises;
});

describe('hydrate · usa las consultas de las pantallas', () => {
  // Si estos parámetros dejan de coincidir con los de la pantalla, el respaldo se guarda en una
  // casilla que nadie lee y la pantalla sale vacía sin señal, aunque la bajada haya salido bien.
  // La cartera es TODOS los créditos del cobrador (al día incluidos): `listPortfolio` no recibe filtros, así que la
  // casilla de caché es una sola para Cobranza, Rutas y la hidratación.
  it('la cartera se baja con listPortfolio, la misma llamada que la Cobranza', async () => {
    const r = await hydrate('u1');
    expect(llamada('listPortfolio')).toBeDefined();
    expect(r.ok).toContain('cartera');
  });

  // El Inicio lee la moneda con `tenantCurrency` → `listMora({ limit: 1 })`: si el parámetro cambia, la casilla es otra.
  it('baja «créditos en mora» con la misma consulta que usa el Inicio', async () => {
    const r = await hydrate('u1');
    expect(mockLlamadas.filter((l) => l.fn === 'listMora').map((l) => l.params)).toContainEqual({ limit: 1 });
    expect(r.ok).toContain('créditos en mora');
    expect(r.ok).not.toContain('casos abiertos');
  });

  it('baja la ficha de cada crédito del cliente (la que abre la pantalla por creditId)', async () => {
    await hydrate('u1');
    expect(mockLlamadas.filter((l) => l.fn === 'getMora').map((l) => l.params)).toEqual(['cr1', 'cr2']);
  });

  // La ficha de mora abre con `listMoraEpisodes(creditId)` y `getMoraMetrics(creditId)` y la Cobranza con `listArrearCategories()`:
  // misma llamada, mismo parámetro, o el respaldo queda en otra casilla.
  it('por cada crédito baja también sus episodios y sus métricas, como la ficha de mora', async () => {
    await hydrate('u1');
    expect(mockLlamadas.filter((l) => l.fn === 'listMoraEpisodes').map((l) => l.params)).toEqual(['cr1', 'cr2']);
    expect(mockLlamadas.filter((l) => l.fn === 'getMoraMetrics').map((l) => l.params)).toEqual(['cr1', 'cr2']);
  });

  // La ficha de mora también abre con `listMoraPromises`, `listMoraNotes` y `listCreditPayments` (app/mora/[creditId].tsx):
  // sin ellas, esas secciones salen vacías sin señal.
  it('por cada crédito baja también sus promesas, sus notas y sus pagos, como la ficha de mora', async () => {
    await hydrate('u1');
    for (const fn of ['listMoraPromises', 'listMoraNotes', 'listCreditPayments']) {
      expect(mockLlamadas.filter((l) => l.fn === fn).map((l) => l.params)).toEqual(['cr1', 'cr2']);
    }
  });

  it('sin señal en las promesas corta las fichas y lo dice', async () => {
    mockRes.promises = { status: 'offline' };
    const r = await hydrate('u1');
    expect(r.offline).toBe(true);
    expect(r.failed).toContain('fichas de la cartera');
  });

  it('baja las categorías de mora de la cuenta con la misma llamada (sin parámetros)', async () => {
    const r = await hydrate('u1');
    expect(llamada('listArrearCategories')).toBeDefined();
    expect(r.ok).toContain('categorías de mora');
  });

  it('no baja el equipo: los nombres ya vienen en cada respuesta (un cobrador no puede leer /users)', async () => {
    await hydrate('u1');
    expect(mockLlamadas.some((l) => l.fn === 'listTeamNames')).toBe(false);
  });

  it('sin señal en los episodios corta las fichas y lo dice', async () => {
    mockRes.episodes = { status: 'offline' };
    const r = await hydrate('u1');
    expect(r.offline).toBe(true);
    expect(r.failed).toContain('fichas de la cartera');
  });

  // La mora de la Cobranza se pide con `limit: 100`; con otro parámetro el respaldo queda en otra casilla.
  it('la mora se baja con los mismos parámetros que el chip «En mora» de la Cobranza', async () => {
    await hydrate('u1');
    expect(llamada('listMora')!.params).toEqual({ limit: 100 });
  });

  it('una mora que falla no tumba la cartera', async () => {
    mockRes.mora = { status: 'error', message: 'boom' };
    const r = await hydrate('u1');
    expect(r.failed).toContain('mora');
    expect(r.ok).toContain('cartera');
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
    mockRes.portfolio = { status: 'offline' };
    const r = await hydrate('u1');
    expect(r.offline).toBe(true);
  });

  it('si no hay ruta activa no pide el detalle de nada', async () => {
    mockRes.routes = ok([]);
    await hydrate('u1');
    expect(llamada('getRoute')).toBeUndefined();
  });
});
