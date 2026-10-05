/**
 * `listMora` guarda cada consulta bajo su propia clave y cae al respaldo SÓLO sin red. La clave tiene que
 * ser la misma que usa `hydrate`, o la pantalla sale vacía sin señal con la base llena.
 */
const mockStore: Record<string, unknown[]> = {};
const mockApi = jest.fn();
const mockMutate = jest.fn();

jest.mock('./api-client', () => ({
  apiQuery: (...a: unknown[]) => mockApi(...a),
  apiMutate: (...a: unknown[]) => mockMutate(...a),
  toQuery: (p: Record<string, unknown>) => {
    const q = Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join('&');
    return q ? `?${q}` : '';
  },
}));
jest.mock('./db', () => ({
  replaceAll: jest.fn(async (kind: string, items: unknown[], scope?: string) => {
    mockStore[`${kind}|${scope ?? ''}`] = items;
  }),
  getMany: jest.fn(async (kind: string, scope?: string) => mockStore[`${kind}|${scope ?? ''}`] ?? []),
  fetchedAt: jest.fn(async () => 1_700_000_000_000),
  putOne: jest.fn(async (kind: string, id: string, v: unknown) => {
    mockStore[`${kind}|${id}`] = [v];
  }),
  getOne: jest.fn(async (kind: string, id: string) => mockStore[`${kind}|${id}`]?.[0] ?? null),
}));

import { deleteMoraNote, getMoraMetrics, listArrearCategories, listMoraEpisodes, MORA_LIMIT, listMora, listPortfolio, tenantCurrency, updateMoraNote } from './mora.service';

const item = { creditId: 'cr1', clientId: 'cl1', currency: 'BOB', daysPastDue: 12, arrearsSource: 'SCHEDULE', hasActivePromise: false };

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockApi.mockReset();
  mockMutate.mockReset();
});

describe('listMora', () => {
  it('pide /mora con el límite y le pone a cada fila el id del crédito', async () => {
    mockApi.mockResolvedValue({ status: 'ok', data: [item], total: 1 });
    const r = await listMora({ limit: MORA_LIMIT });
    expect(mockApi).toHaveBeenCalledWith('/mora?limit=100');
    expect(r.status === 'ok' && r.data[0].id).toBe('cr1');
  });

  it('guarda la respuesta bajo la consulta que la pidió', async () => {
    mockApi.mockResolvedValue({ status: 'ok', data: [item], total: 1 });
    await listMora({ limit: MORA_LIMIT });
    expect(mockStore['mora|?limit=100']).toHaveLength(1);
  });

  it('sin red devuelve lo guardado y avisa de qué hora es', async () => {
    mockApi.mockResolvedValueOnce({ status: 'ok', data: [item], total: 1 });
    await listMora({ limit: MORA_LIMIT });
    mockApi.mockResolvedValueOnce({ status: 'offline' });
    const r = await listMora({ limit: MORA_LIMIT });
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.localAt).toBe(1_700_000_000_000);
    expect(r.status === 'ok' && r.data[0].creditId).toBe('cr1');
  });

  it('un error del servidor NO se tapa con datos viejos', async () => {
    mockApi.mockResolvedValueOnce({ status: 'ok', data: [item], total: 1 });
    await listMora({ limit: MORA_LIMIT });
    mockApi.mockResolvedValueOnce({ status: 'error', message: 'boom' });
    expect((await listMora({ limit: MORA_LIMIT })).status).toBe('error');
  });

  it('sin red y sin nada guardado sigue siendo offline', async () => {
    mockApi.mockResolvedValue({ status: 'offline' });
    expect((await listMora({ limit: MORA_LIMIT })).status).toBe('offline');
  });
});

describe('listPortfolio · la cartera entera, al día incluida', () => {
  it('pide todos=true con la página máxima y la guarda bajo UNA casilla (portfolio)', async () => {
    mockApi.mockResolvedValue({ status: 'ok', data: [item], total: 1 });
    const r = await listPortfolio();
    expect(mockApi).toHaveBeenCalledWith('/mora?todos=true&limit=100&page=1');
    expect(r.status === 'ok' && r.data[0].id).toBe('cr1');
    expect(mockStore['portfolio|todos']).toHaveLength(1);
  });

  it('sin red devuelve la cartera guardada, con su hora', async () => {
    mockApi.mockResolvedValueOnce({ status: 'ok', data: [item], total: 1 });
    await listPortfolio();
    mockApi.mockResolvedValueOnce({ status: 'offline' });
    const r = await listPortfolio();
    expect(r.status === 'ok' && r.localAt).toBe(1_700_000_000_000);
    expect(r.status === 'ok' && r.data).toHaveLength(1);
  });
});

describe('tenantCurrency · moneda del Inicio', () => {
  it('es la del primer crédito en mora', async () => {
    mockApi.mockResolvedValue({ status: 'ok', data: [{ ...item, currency: 'USD' }], total: 1 });
    expect(await tenantCurrency()).toBe('USD');
    expect(mockApi).toHaveBeenCalledWith('/mora?limit=1');
  });

  it('si nadie está en mora, cae a la cartera guardada', async () => {
    mockStore['portfolio|'] = [{ ...item, id: 'cr1', currency: 'USD' }]; // el mock indexa «kind|scope»; getMany sin scope = todos
    mockApi.mockResolvedValue({ status: 'ok', data: [], total: 0 });
    expect(await tenantCurrency()).toBe('USD');
  });

  it('sin nada de nada, BOB', async () => {
    mockApi.mockResolvedValue({ status: 'offline' });
    expect(await tenantCurrency()).toBe('BOB');
  });
});

describe('paridad de la ficha de mora', () => {
  it('episodios: GET /mora/:id/episodes y respaldo local sin señal', async () => {
    const e = { id: 'e1', number: 1, startedAt: '2026-09-01', startedAtEstimated: false, source: 'CALCULATED', reconstructed: false, current: true, durationDays: 3 };
    mockApi.mockResolvedValueOnce({ status: 'ok', data: [e], total: 1 });
    await listMoraEpisodes('cr1');
    expect(mockApi).toHaveBeenCalledWith('/mora/cr1/episodes');
    mockApi.mockResolvedValueOnce({ status: 'offline' });
    const r = await listMoraEpisodes('cr1');
    expect(r.status === 'ok' && r.data[0]!.id).toBe('e1');
  });

  it('métricas: GET /mora/:id/metrics y respaldo local sin señal', async () => {
    mockApi.mockResolvedValueOnce({ status: 'ok', data: { window: 'ALL', recoveredAmount: 5 }, total: 1 });
    await getMoraMetrics('cr1');
    expect(mockApi).toHaveBeenCalledWith('/mora/cr1/metrics');
    mockApi.mockResolvedValueOnce({ status: 'offline' });
    const r = await getMoraMetrics('cr1');
    expect(r.status === 'ok' && r.data.recoveredAmount).toBe(5);
  });

  it('categorías: GET /arrear-categories', async () => {
    mockApi.mockResolvedValueOnce({ status: 'ok', data: [{ id: 'k1', code: 'A', name: 'A', fromDays: 1, toDays: null, color: null, sortOrder: 0 }], total: 1 });
    const r = await listArrearCategories();
    expect(mockApi).toHaveBeenCalledWith('/arrear-categories');
    expect(r.status === 'ok' && r.data[0]!.code).toBe('A');
  });

  it('notas: PATCH y DELETE a /mora/:id/notes/:noteId', async () => {
    mockMutate.mockResolvedValue({ status: 'ok', data: null });
    await updateMoraNote('cr1', 'n1', { body: 'x', color: 'PINK' });
    expect(mockMutate).toHaveBeenCalledWith('/mora/cr1/notes/n1', 'PATCH', { body: 'x', color: 'PINK' });
    await deleteMoraNote('cr1', 'n1');
    expect(mockMutate).toHaveBeenCalledWith('/mora/cr1/notes/n1', 'DELETE');
  });
});
