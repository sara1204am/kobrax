/**
 * La hidratación es una secuencia de bajadas independientes. Lo que se prueba acá es justamente
 * eso: que **una que falle no se lleve puestas a las demás** (un dato viejo sirve más que ninguno),
 * y que la ruta de ayer no quede pegada cuando hoy no hay ruta.
 */
const mockDb: { replaced: { kind: string; count: number; scope?: string }[] } = { replaced: [] };

jest.mock('../db', () => ({
  replaceAll: jest.fn(async (kind: string, items: unknown[], scope?: string) => {
    mockDb.replaced.push({ kind, count: items.length, scope });
  }),
  putAll: jest.fn(async () => {}),
  getMany: jest.fn(async () => []),
  fetchedAt: jest.fn(async () => null),
}));

const mockRes = {
  cases: { status: 'ok', data: [{ id: 'c1', clientId: 'cl1' }], total: 1 } as never,
  routes: { status: 'ok', data: [] as unknown[], total: 0 } as never,
  agenda: { status: 'ok', data: [], total: 0 } as never,
  overdue: { status: 'ok', data: [], total: 0 } as never,
  catalog: { status: 'ok', data: [{ id: 'k1' }], total: 1 } as never,
  notif: { status: 'ok', data: [], total: 0 } as never,
};

jest.mock('../cases.service', () => ({ listCases: jest.fn(async () => mockRes.cases) }));
jest.mock('../routes.service', () => ({
  listRoutes: jest.fn(async () => mockRes.routes),
  getRoute: jest.fn(async () => ({ status: 'ok', data: { id: 'r1', stops: [] } })),
}));
jest.mock('../agenda.service', () => ({
  listByDay: jest.fn(async () => mockRes.agenda),
  listOverdue: jest.fn(async () => mockRes.overdue),
}));
jest.mock('../catalogs.service', () => ({ listCatalog: jest.fn(async () => mockRes.catalog) }));
jest.mock('../notifications.service', () => ({ listNotifications: jest.fn(async () => mockRes.notif) }));
jest.mock('../clients.service', () => ({ getClient: jest.fn(async () => ({ status: 'ok', data: { id: 'cl1' } })) }));

import { hydrate } from './hydrate';

beforeEach(() => {
  mockDb.replaced = [];
  mockRes.cases = { status: 'ok', data: [{ id: 'c1', clientId: 'cl1' }], total: 1 } as never;
  mockRes.agenda = { status: 'ok', data: [], total: 0 } as never;
  mockRes.routes = { status: 'ok', data: [], total: 0 } as never;
});

describe('hydrate', () => {
  it('baja la jornada completa y lo reporta', async () => {
    const r = await hydrate('u1');
    expect(r.failed).toEqual([]);
    expect(r.ok).toContain('cartera');
    expect(r.ok).toContain('agenda');
    expect(r.offline).toBe(false);
  });

  // Si un fallo cortara la secuencia, quedarse sin agenda dejaría al cobrador también sin cartera.
  it('una bajada que falla no impide las otras', async () => {
    mockRes.agenda = { status: 'error', message: 'boom' } as never;
    const r = await hydrate('u1');
    expect(r.failed).toContain('agenda');
    expect(r.ok).toContain('cartera');
    expect(mockDb.replaced.some((x) => x.kind === 'case')).toBe(true);
  });

  it('sin red lo dice, para que la pantalla no culpe al servidor', async () => {
    mockRes.cases = { status: 'offline' } as never;
    const r = await hydrate('u1');
    expect(r.offline).toBe(true);
    expect(r.failed).toContain('cartera');
  });

  // Sin esto, el cobrador abre la app un martes y ve el itinerario del lunes como si fuera de hoy.
  it('si hoy no hay ruta activa, borra la de ayer', async () => {
    mockRes.routes = { status: 'ok', data: [], total: 0 } as never;
    await hydrate('u1');
    const ruta = mockDb.replaced.find((x) => x.kind === 'route');
    expect(ruta).toBeDefined();
    expect(ruta!.count).toBe(0);
  });

  it('la agenda de hoy y los vencidos se guardan por separado', async () => {
    await hydrate('u1');
    const scopes = mockDb.replaced.filter((x) => x.kind === 'agenda').map((x) => x.scope);
    expect(scopes).toContain('overdue');
    expect(scopes.filter((s) => s !== 'overdue').length).toBe(1);
  });
});
