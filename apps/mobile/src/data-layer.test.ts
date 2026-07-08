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
import { listCases } from './cases.service';
import { routeProgress, type RouteItem } from './routes.service';

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

describe('listCases', () => {
  it('traduce overdue:true → overdue=true en la query (no boolean)', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: [], error: null, meta: { total: 0 } });
    await listCases({ assigneeId: 'u1', overdue: true, limit: 1 });
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain('assigneeId=u1');
    expect(path).toContain('overdue=true');
    expect(path).toContain('limit=1');
  });

  it('traduce open:true → open=true en la query', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: [], error: null, meta: { total: 0 } });
    await listCases({ assigneeId: 'u1', open: true, limit: 1 });
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain('open=true');
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
