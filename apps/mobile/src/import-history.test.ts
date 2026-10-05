/**
 * Paridad de la importación con el panel (F4/08 · fase 5): contadores, «ya aplicado», «asignar todo a mí»
 * y el historial de corridas.
 */
const mockApi: { calls: string[]; res: unknown } = { calls: [], res: { status: 'offline' } };

jest.mock('@/api-client', () => ({
  apiQuery: jest.fn(async (path: string) => {
    mockApi.calls.push(path);
    return mockApi.res;
  }),
  apiMutate: jest.fn(),
  refreshSession: jest.fn(),
  toQuery: (p: Record<string, unknown>) =>
    '?' + Object.entries(p).map(([k, v]) => `${k}=${String(v)}`).join('&'),
}));
const mockCache = new Map<string, unknown[]>();
jest.mock('@/db', () => ({
  replaceAll: jest.fn(async (kind: string, items: unknown[], scope: string) => void mockCache.set(`${kind}|${scope}`, items)),
  getMany: jest.fn(async (kind: string, scope: string) => mockCache.get(`${kind}|${scope}`) ?? []),
  putOne: jest.fn(),
  getOne: jest.fn(),
  fetchedAt: jest.fn(async () => 1_700_000_000_000),
}));

import {
  alreadyAppliedText,
  countTiles,
  listRunItems,
  listRuns,
  runActions,
  selfAssignments,
  unassignedNewCodes,
} from './import.service';

const row = (code: string, suggestedAssigneeId?: string | null) => ({ code, clientName: code, suggestedAssigneeId });
const preview = (toCreate: ReturnType<typeof row>[], assignment?: { mode: 'SELF' | 'CHOOSE'; selfUserId: string }) =>
  ({ assignment, preview: { toCreate } }) as unknown as Parameters<typeof selfAssignments>[0];

describe('countTiles', () => {
  it('con la regla por defecto muestra ausentes y volvieron, no «Al día» en cero', () => {
    const t = countTiles({ created: 3, updated: 10, setCurrent: 0, absent: 2, reappeared: 1, ignored: 0 });
    expect(t.map((x) => [x.label, x.value])).toEqual([
      ['Agregados', 3],
      ['Actualizados', 10],
      ['Ya no vienen', 2],
      ['Volvieron', 1],
    ]);
  });
  it('suma Ignorados si hay y «Al día» sólo con la regla ponerlos al día', () => {
    const t = countTiles({ created: 0, updated: 0, setCurrent: 4, absent: 4, reappeared: 0, ignored: 6 });
    expect(t.map((x) => x.label)).toEqual(['Agregados', 'Actualizados', 'Ya no vienen', 'Volvieron', 'Ignorados', 'Al día']);
  });
  it('sin `absent` (API vieja / lectura desde Ajustes) quedan los tres baldes de antes', () => {
    expect(countTiles({ created: 1, updated: 2, setCurrent: 3 }).map((x) => x.label)).toEqual(['Agregados', 'Actualizados', 'Al día']);
  });
});

describe('alreadyAppliedText', () => {
  const now = new Date(2026, 9, 4, 12, 0);
  it('dice cuándo y quién', () => {
    const at = new Date(2026, 9, 4, 8, 14).toISOString();
    expect(alreadyAppliedText({ at, by: 'Ana Ruiz' }, now)).toBe('Este archivo ya se importó el Hoy 08:14 por Ana Ruiz.');
  });
  it('sin autor o sin dato, cae a algo honesto', () => {
    const at = new Date(2026, 9, 1, 9, 5).toISOString();
    expect(alreadyAppliedText({ at, by: null }, now)).toBe('Este archivo ya se importó el 1 oct 09:05.');
    expect(alreadyAppliedText(undefined, now)).toBe('Este archivo ya se importó.');
  });
});

describe('asignar todo a mí', () => {
  it('sólo los nuevos sin sugerencia van a quien confirma', () => {
    const p = preview([row('A', 'u9'), row('B', null), row('C')], { mode: 'CHOOSE', selfUserId: 'me' });
    expect(unassignedNewCodes(p)).toEqual(['B', 'C']);
    expect(selfAssignments(p)).toEqual({ version: 1, create: [{ userId: 'me', externalIds: ['B', 'C'] }], reassign: [] });
  });
  it('si todos traen sugerencia o no hay quien confirme, no pide nada', () => {
    expect(selfAssignments(preview([row('A', 'u9')], { mode: 'CHOOSE', selfUserId: 'me' }))).toBeUndefined();
    expect(selfAssignments(preview([row('B')]))).toBeUndefined();
  });
});

describe('historial de corridas', () => {
  beforeEach(() => {
    mockApi.calls = [];
    mockCache.clear();
  });
  it('lista con señal, la guarda, y sin señal devuelve lo guardado', async () => {
    mockApi.res = { status: 'ok', data: [{ id: 'r1' }], total: 1 };
    expect((await listRuns()).status).toBe('ok');
    expect(mockApi.calls[0]).toContain('/imports/portfolio/runs');
    mockApi.res = { status: 'offline' };
    const off = await listRuns();
    expect(off.status).toBe('ok');
    if (off.status === 'ok') expect(off.data).toEqual([{ id: 'r1' }]);
  });
  it('los movimientos se piden por acción y cada acción se guarda aparte', async () => {
    mockApi.res = { status: 'ok', data: [{ id: 'i1', action: 'ABSENT' }], total: 1 };
    await listRunItems('run-1', 'ABSENT');
    expect(mockApi.calls[0]).toBe('/imports/portfolio/runs/run-1/items?action=ABSENT&limit=100');
    mockApi.res = { status: 'offline' };
    const other = await listRunItems('run-1', 'CREATED');
    expect(other.status).toBe('offline'); // no hay copia de ESA lista
  });
  it('runActions sólo ofrece las que tienen registros, en orden', () => {
    expect(runActions({ created: 1, updated: 0, reappeared: 2, setCurrent: 0, absent: 3, rejected: 1 })).toEqual([
      'CREATED',
      'REAPPEARED',
      'ABSENT',
      'REJECTED',
    ]);
  });
});
