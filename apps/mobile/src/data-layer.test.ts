jest.mock('./api', () => ({ apiFetch: jest.fn() }));
jest.mock('./session', () => ({
  getSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

import { RouteStopStatus } from '@kobrax/shared';
import { apiFetch } from './api';
import { getSession } from './session';
import { apiQuery, toQuery } from './api-client';
import { listPortfolio } from './mora.service';
import { routeProgress, type RouteItem } from './routes.service';
import { listByDay, listOverdue } from './agenda.service';

const mockFetch = apiFetch as jest.Mock;
const mockGetSession = getSession as jest.Mock;
const SESSION = { accessToken: 'acc', refreshToken: 'ref' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION);
});

describe('toQuery', () => {
  it('omite undefined/null/vacío y prefija con ?', () => {
    expect(toQuery({ a: 1, b: undefined, c: '', d: 'x' })).toBe('?a=1&d=x');
    expect(toQuery({})).toBe('');
  });
});

describe('apiQuery', () => {
  it('200 con meta.total → ok con total del server', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: [{ id: '1' }], error: null, meta: { total: 42 } });
    const res = await apiQuery<{ id: string }[]>('/x');
    expect(res).toEqual({ status: 'ok', data: [{ id: '1' }], total: 42 });
  });

  it('sin meta → total = largo del array', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: [{ id: '1' }, { id: '2' }], error: null });
    const res = await apiQuery<unknown[]>('/x');
    expect(res).toEqual({ status: 'ok', data: [{ id: '1' }, { id: '2' }], total: 2 });
  });

  it('status 0 → offline; error → error con mensaje', async () => {
    mockFetch.mockResolvedValueOnce({ status: 0, data: null, error: null });
    expect(await apiQuery('/x')).toEqual({ status: 'offline' });
    mockFetch.mockResolvedValueOnce({ status: 500, data: null, error: { code: 'X', message: 'boom' } });
    expect(await apiQuery('/x')).toEqual({ status: 'error', message: 'boom' });
  });
});

describe('listPortfolio', () => {
  const row = (n: number) => ({ creditId: `cr${n}`, clientId: 'cl1', currency: 'BOB', daysPastDue: 0, hasActivePromise: false, situation: 'CURRENT', writtenOff: false });

  it('pide /mora con todos=true y la página máxima de 100', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: [row(1)], error: null, meta: { total: 1 } });
    await listPortfolio();
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain('/mora?');
    expect(path).toContain('todos=true');
    expect(path).toContain('limit=100');
    expect(path).toContain('page=1');
  });

  it('pagina hasta cubrir el total y junta las filas, con el crédito como id', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => row(i));
    const page2 = [row(100), row(101)];
    mockFetch
      .mockResolvedValueOnce({ status: 200, data: page1, error: null, meta: { total: 102 } })
      .mockResolvedValueOnce({ status: 200, data: page2, error: null, meta: { total: 102 } });
    const res = await listPortfolio();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain('page=2');
    expect(res.status === 'ok' && res.data).toHaveLength(102);
    expect(res.status === 'ok' && res.total).toBe(102);
    expect(res.status === 'ok' && res.data[101]!.id).toBe('cr101');
  });

  it('si una página falla no devuelve una cartera a medias', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 200, data: Array.from({ length: 100 }, (_, i) => row(i)), error: null, meta: { total: 150 } })
      .mockResolvedValueOnce({ status: 500, data: null, error: { code: 'X', message: 'boom' } });
    const res = await listPortfolio();
    expect(res).toEqual({ status: 'error', message: 'boom' });
  });
});

describe('agenda.service', () => {
  it('listByDay → /agenda?date=YYYY-MM-DD', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: [], error: null });
    await listByDay('2026-07-08');
    expect(mockFetch.mock.calls[0]![0]).toContain('/agenda?date=2026-07-08');
  });

  it('listOverdue → /agenda/overdue?limit= y devuelve total', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: [], error: null, meta: { total: 3 } });
    const res = await listOverdue(100);
    expect(mockFetch.mock.calls[0]![0]).toContain('/agenda/overdue?limit=100');
    expect(res.status === 'ok' && res.total).toBe(3);
  });
});

describe('routeProgress', () => {
  it('cuenta VISITED y SKIPPED como paradas hechas', () => {
    const route = {
      stops: [
        { status: RouteStopStatus.VISITED },
        { status: RouteStopStatus.SKIPPED },
        { status: RouteStopStatus.PENDING },
        { status: RouteStopStatus.IN_ROUTE },
      ],
    } as RouteItem;
    expect(routeProgress(route)).toEqual({ done: 2, total: 4 });
  });

  it('sin stops → 0/0', () => {
    expect(routeProgress({} as RouteItem)).toEqual({ done: 0, total: 0 });
  });
});
