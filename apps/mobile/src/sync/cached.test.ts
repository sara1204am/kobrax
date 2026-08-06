/**
 * La capa de lectura offline. Lo que se prueba es **cuándo se cae al respaldo y cuándo no**: caer
 * de más taparía un error real del servidor con datos viejos, y caer de menos dejaría al cobrador
 * mirando una pantalla vacía con la base llena.
 */
const mockStore: { rows: Record<string, unknown[]>; one: unknown } = { rows: {}, one: null };

jest.mock('../db', () => ({
  replaceAll: jest.fn(async (kind: string, items: unknown[], scope?: string) => {
    mockStore.rows[`${kind}|${scope ?? ''}`] = items;
  }),
  putAll: jest.fn(async () => {}),
  putOne: jest.fn(async () => {}),
  getMany: jest.fn(async (kind: string, scope?: string) => mockStore.rows[`${kind}|${scope ?? ''}`] ?? []),
  getOne: jest.fn(async () => mockStore.one),
  fetchedAt: jest.fn(async () => 1_700_000_000_000),
}));

import { cachedList, cachedOne } from './cached';
import type { QueryResult } from '../api-client';

const ok = <T>(data: T[]): QueryResult<T[]> => ({ status: 'ok', data, total: data.length });
const off = <T>(): QueryResult<T> => ({ status: 'offline' });

beforeEach(() => {
  mockStore.rows = {};
  mockStore.one = null;
});

describe('cachedList', () => {
  it('con red devuelve lo del server y lo deja guardado', async () => {
    const r = await cachedList('case', 'q1', async () => ok([{ id: 'a' }]));
    expect(r.status).toBe('ok');
    expect(mockStore.rows['case|q1']).toEqual([{ id: 'a' }]);
  });

  it('sin red devuelve lo guardado, y avisa que es local', async () => {
    mockStore.rows['case|q1'] = [{ id: 'a' }];
    const r = await cachedList<{ id: string }>('case', 'q1', async () => off());
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.data).toEqual([{ id: 'a' }]);
      expect(r.localAt).toBe(1_700_000_000_000); // la pantalla puede decir de cuándo es
    }
  });

  it('sin red y sin nada guardado sigue siendo offline (no inventa una lista vacía)', async () => {
    const r = await cachedList('case', 'q1', async () => off());
    expect(r.status).toBe('offline');
  });

  // Tapar un 500 con datos viejos hace que el bug del servidor sea invisible durante días.
  it('un error del servidor NO cae al respaldo: llega a la pantalla tal cual', async () => {
    mockStore.rows['case|q1'] = [{ id: 'a' }];
    const r = await cachedList('case', 'q1', async () => ({ status: 'error', message: 'boom' }));
    expect(r.status).toBe('error');
  });

  it('una sesión vencida tampoco: tiene que mandar al login', async () => {
    mockStore.rows['case|q1'] = [{ id: 'a' }];
    const r = await cachedList('case', 'q1', async () => ({ status: 'unauthenticated' }));
    expect(r.status).toBe('unauthenticated');
  });

  // Dos consultas del mismo recurso con filtros distintos son dos respuestas distintas.
  it('cada consulta guarda su propia respuesta', async () => {
    await cachedList('case', 'abiertos', async () => ok([{ id: 'a' }]));
    await cachedList('case', 'vencidos', async () => ok([{ id: 'b' }, { id: 'c' }]));
    expect(mockStore.rows['case|abiertos']).toHaveLength(1);
    expect(mockStore.rows['case|vencidos']).toHaveLength(2);
  });
});

describe('cachedOne', () => {
  it('sin red devuelve la ficha guardada', async () => {
    mockStore.one = { item: { id: 'x' }, history: [] };
    const r = await cachedOne('agenda.detail', 'x', async () => off());
    expect(r.status).toBe('ok');
  });

  it('sin red y sin ficha guardada sigue offline', async () => {
    const r = await cachedOne('agenda.detail', 'x', async () => off());
    expect(r.status).toBe('offline');
  });
});
