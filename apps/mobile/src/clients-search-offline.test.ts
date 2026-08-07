/**
 * Buscar clientes sin señal. Sale de la cartera ya bajada y no del caché de la consulta: cada
 * texto tecleado es una consulta distinta, así que nunca habría un resultado guardado para lo que
 * el cobrador está escribiendo ahora.
 */
const mockCasos: { clientId?: string; clientName?: string }[] = [];
const mockApi: { res: unknown } = { res: { status: 'offline' } };

jest.mock('./api-client', () => ({
  apiQuery: jest.fn(async () => mockApi.res),
  apiMutate: jest.fn(),
  toQuery: jest.fn(() => ''),
}));
jest.mock('./sync/cached', () => ({ cachedOne: jest.fn() }));
jest.mock('./db', () => ({
  getMany: jest.fn(async () => mockCasos),
  fetchedAt: jest.fn(async () => 1_700_000_000_000),
}));

import { searchClients } from './clients.service';

beforeEach(() => {
  mockApi.res = { status: 'offline' };
  mockCasos.length = 0;
  mockCasos.push(
    { clientId: 'c1', clientName: 'QUISPE MAMANI ROSA ELENA' },
    { clientId: 'c2', clientName: 'Martínez Durán Juan' },
    { clientId: 'c1', clientName: 'QUISPE MAMANI ROSA ELENA' }, // el mismo cliente en otro caso
    { clientId: 'c3' }, // caso sin nombre: no debe romper
  );
});

describe('searchClients sin señal', () => {
  it('encuentra por parte del nombre', async () => {
    const r = await searchClients('rosa');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.data[0]!.id).toBe('c1');
  });

  // Nadie escribe los acentos al buscar apurado en la calle.
  it('ignora acentos y mayúsculas', async () => {
    const r = await searchClients('MARTINEZ');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.data[0]!.id).toBe('c2');
  });

  // Un cliente con dos créditos aparece en dos casos; en la búsqueda tiene que salir una vez.
  it('no repite un cliente que está en varios casos', async () => {
    const r = await searchClients('quispe');
    if (r.status === 'ok') expect(r.data).toHaveLength(1);
  });

  it('avisa que sigue sin señal cuando no hay coincidencia', async () => {
    const r = await searchClients('nadie');
    expect(r.status).toBe('offline');
  });

  it('marca de cuándo son los datos que muestra', async () => {
    const r = await searchClients('rosa');
    if (r.status === 'ok') expect(r.localAt).toBe(1_700_000_000_000);
  });

  it('con señal manda lo del servidor y no toca la base local', async () => {
    mockApi.res = { status: 'ok', data: [{ id: 'server-1' }], total: 1 };
    const r = await searchClients('rosa');
    if (r.status === 'ok') expect(r.data[0]!.id).toBe('server-1');
  });
});
