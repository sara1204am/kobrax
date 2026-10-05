/**
 * Las altas hechas sin señal tienen que VERSE (búsqueda, ficha, préstamos del cliente) hasta que la cola las suba.
 * La base es un mapa en memoria con la misma clave que usa el caché real: (kind, id).
 */
const mockRows = new Map<string, unknown>();
const key = (kind: string, id: string) => `${kind}|${id}`;

jest.mock('../db', () => ({
  getOne: jest.fn(async (kind: string, id: string) => mockRows.get(key(kind, id)) ?? null),
  putOne: jest.fn(async (kind: string, id: string, value: unknown) => void mockRows.set(key(kind, id), value)),
  removeOne: jest.fn(async (kind: string, id: string) => void mockRows.delete(key(kind, id))),
}));

import {
  confirmProvisionalRow,
  dropProvisionalRow,
  writeProvisionalClient,
  writeProvisionalCredit,
} from './optimistic';

type Row = Record<string, unknown>;
const get = (kind: string, id: string) => mockRows.get(key(kind, id)) as Row | undefined;

beforeEach(() => mockRows.clear());

describe('writeProvisionalClient', () => {
  const input = {
    id: 'cli-1',
    clientType: 'PERSON' as const,
    firstName: 'Ana',
    lastName: 'Rojas',
    nationalId: '1234567',
    contacts: [{ contactType: 'PHONE' as const, value: '70012345', isPrimary: true }],
    locations: [{ locationType: 'HOME' as const, address: 'Calle 1 #23', latitude: -17.7, longitude: -63.1 }],
  };

  it('deja el cliente en `client` marcado como pendiente (lo lee la ficha y el buscador)', async () => {
    await writeProvisionalClient(input);
    expect(get('client', 'cli-1')).toMatchObject({ id: 'cli-1', firstName: 'Ana', lastName: 'Rojas', pending: true });
  });

  it('deja su contexto en `client.context` con nombre, teléfonos y direcciones, sin créditos', async () => {
    await writeProvisionalClient(input);
    const ctx = get('client.context', 'cli-1') as { client: Row; credits: unknown[]; contacts: Row[]; locations: Row[]; pending: boolean };
    expect(ctx.pending).toBe(true);
    expect(ctx.client).toMatchObject({ id: 'cli-1', displayName: 'Ana Rojas', nationalId: '1234567' });
    expect(ctx.credits).toEqual([]);
    expect(ctx.contacts[0]).toMatchObject({ contactType: 'PHONE', value: '70012345', isPrimary: true });
    expect(ctx.locations[0]).toMatchObject({ locationType: 'HOME', address: 'Calle 1 #23', latitude: -17.7 });
  });

  it('NUNCA pisa una ficha real ya cacheada del mismo id', async () => {
    mockRows.set(key('client', 'cli-1'), { id: 'cli-1', firstName: 'Real', nationalId: null, status: 'ACTIVE' });
    await writeProvisionalClient(input);
    expect(get('client', 'cli-1')).toMatchObject({ firstName: 'Real' });
    expect(get('client', 'cli-1')!.pending).toBeUndefined();
  });

  it('sin id no escribe nada (no hay clave estable)', async () => {
    await writeProvisionalClient({ clientType: 'PERSON', firstName: 'X' });
    expect(mockRows.size).toBe(0);
  });

  it('una empresa se muestra por su razón social', async () => {
    await writeProvisionalClient({ id: 'e1', clientType: 'COMPANY', businessName: 'Ferretería Sol' });
    expect((get('client.context', 'e1') as { client: Row }).client.displayName).toBe('Ferretería Sol');
  });
});

describe('writeProvisionalCredit', () => {
  const contexto = {
    client: { id: 'cli-1', displayName: 'Ana Rojas', nationalId: null },
    credits: [{ creditId: 'viejo', principalAmount: 500, outstandingBalance: 300, overdueAmount: 0, currency: 'USD', daysPastDue: 0 }],
    contacts: [],
    locations: [],
  };
  const credito = { id: 'cre-1', clientId: 'cli-1', principalAmount: 1000, installmentAmount: 100, frequency: 'MONTHLY', nextDueDate: '2026-11-01' } as never;

  it('suma el préstamo al contexto del cliente, marcado pendiente y con la moneda de los demás', async () => {
    mockRows.set(key('client.context', 'cli-1'), contexto);
    await writeProvisionalCredit(credito);
    const ctx = get('client.context', 'cli-1') as { credits: Row[] };
    expect(ctx.credits).toHaveLength(2);
    expect(ctx.credits[1]).toMatchObject({ creditId: 'cre-1', principalAmount: 1000, outstandingBalance: 1000, currency: 'USD', pending: true });
    expect(ctx.credits[0]).toMatchObject({ creditId: 'viejo' }); // lo que ya estaba no se toca
  });

  // La ficha esconde «Registrar pago/gestión» mientras `pending` esté puesto: sin caso ni id de server que usar.
  it('el préstamo provisional no inventa un caseId: sólo creditId y la marca pending', async () => {
    mockRows.set(key('client.context', 'cli-1'), contexto);
    await writeProvisionalCredit(credito);
    const ctx = get('client.context', 'cli-1') as { credits: Row[] };
    expect(ctx.credits[1]).not.toHaveProperty('caseId');
    expect(ctx.credits[1]).toMatchObject({ creditId: 'cre-1', pending: true });
  });

  it('no duplica si el mismo préstamo ya está (se reintentó el encolado)', async () => {
    mockRows.set(key('client.context', 'cli-1'), contexto);
    await writeProvisionalCredit(credito);
    await writeProvisionalCredit(credito);
    expect((get('client.context', 'cli-1') as { credits: unknown[] }).credits).toHaveLength(2);
  });

  it('si el contexto del cliente no está en el caché, no inventa uno', async () => {
    await writeProvisionalCredit(credito);
    expect(mockRows.size).toBe(0);
  });

  it('con saldo y mora informados usa los suyos', async () => {
    mockRows.set(key('client.context', 'cli-1'), contexto);
    await writeProvisionalCredit({ ...(credito as object), outstandingBalance: 700, daysPastDue: 12 } as never);
    const ctx = get('client.context', 'cli-1') as { credits: Row[] };
    expect(ctx.credits[1]).toMatchObject({ outstandingBalance: 700, daysPastDue: 12 });
  });
});

describe('confirmProvisionalRow · el alta subió', () => {
  it('le quita la marca de pendiente al cliente y a su contexto', async () => {
    await writeProvisionalClient({ id: 'cli-1', clientType: 'PERSON', firstName: 'Ana' });
    await confirmProvisionalRow('client', 'cli-1');
    expect(get('client', 'cli-1')).toMatchObject({ firstName: 'Ana' });
    expect(get('client', 'cli-1')!.pending).toBeUndefined();
    expect(get('client.context', 'cli-1')!.pending).toBeUndefined();
  });

  it('le quita la marca al préstamo dentro del contexto', async () => {
    await writeProvisionalClient({ id: 'cli-1', clientType: 'PERSON', firstName: 'Ana' });
    await writeProvisionalCredit({ id: 'cre-1', clientId: 'cli-1', principalAmount: 100 } as never);
    await confirmProvisionalRow('credit', 'cre-1', 'cli-1');
    const ctx = get('client.context', 'cli-1') as { credits: Row[] };
    expect(ctx.credits[0]).toMatchObject({ creditId: 'cre-1' });
    expect(ctx.credits[0]!.pending).toBeUndefined();
  });

  it('no toca una fila real (sin marca)', async () => {
    const real = { id: 'cli-2', firstName: 'Real' };
    mockRows.set(key('client', 'cli-2'), real);
    await confirmProvisionalRow('client', 'cli-2');
    expect(get('client', 'cli-2')).toEqual(real);
  });
});

describe('dropProvisionalRow · el alta se descartó', () => {
  it('borra el cliente provisional pero NUNCA una ficha real', async () => {
    await writeProvisionalClient({ id: 'cli-1', clientType: 'PERSON', firstName: 'Ana' });
    mockRows.set(key('client', 'cli-real'), { id: 'cli-real', firstName: 'Real' });
    await dropProvisionalRow('client', 'cli-1');
    await dropProvisionalRow('client', 'cli-real');
    expect(get('client', 'cli-1')).toBeUndefined();
    expect(get('client.context', 'cli-1')).toBeUndefined();
    expect(get('client', 'cli-real')).toBeDefined();
  });

  it('saca el préstamo provisional del contexto y deja los reales', async () => {
    await writeProvisionalClient({ id: 'cli-1', clientType: 'PERSON', firstName: 'Ana' });
    const ctx = get('client.context', 'cli-1') as { credits: unknown[] };
    mockRows.set(key('client.context', 'cli-1'), { ...ctx, credits: [{ creditId: 'real' }] });
    await writeProvisionalCredit({ id: 'cre-1', clientId: 'cli-1', principalAmount: 100 } as never);
    await dropProvisionalRow('credit', 'cre-1', 'cli-1');
    expect((get('client.context', 'cli-1') as { credits: Row[] }).credits.map((c) => c.creditId)).toEqual(['real']);
  });
});
