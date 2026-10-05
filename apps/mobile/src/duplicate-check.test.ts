const mockRows: Record<string, unknown[]> = { portfolio: [], client: [] };
const mockApi: { res: unknown } = { res: { status: 'offline' } };

jest.mock('./api-client', () => ({ apiMutate: jest.fn(async () => mockApi.res), apiQuery: jest.fn(), toQuery: jest.fn() }));
jest.mock('./sync/cached', () => ({ cachedOne: jest.fn() }));
jest.mock('./db', () => ({ getMany: jest.fn(async (kind: string) => mockRows[kind] ?? []), fetchedAt: jest.fn() }));

import { initialCliente } from '@kobrax/shared';
import { checkDuplicates, duplicateBlocks, duplicateCheckInput, maskDocument, nameSignature } from './duplicate-check';

beforeEach(() => {
  mockApi.res = { status: 'offline' };
  mockRows.portfolio = [
    { clientId: 'c1', clientName: 'Martínez Durán Juan' },
    { clientId: 'c1', clientName: 'Martínez Durán Juan' },
  ];
  mockRows.client = [{ id: 'p1', firstName: 'Ana', lastName: 'Ruiz', nationalId: '1234567', status: 'ACTIVE' }];
});

const form = (p: Partial<ReturnType<typeof initialCliente>>) => ({ ...initialCliente(), ...p });

describe('duplicateCheckInput', () => {
  it('no pregunta hasta tener documento de 3+ o nombre con apellido', () => {
    expect(duplicateCheckInput(form({ firstName: 'Juan' }))).toBeNull();
    expect(duplicateCheckInput(form({ nationalId: '12' }))).toBeNull();
    expect(duplicateCheckInput(form({ nationalId: '123' }))).toEqual({ clientType: 'PERSON', nationalId: '123' });
    expect(duplicateCheckInput(form({ firstName: 'Juan', lastName: 'Pérez' }))).toEqual({ clientType: 'PERSON', firstName: 'Juan', lastName: 'Pérez' });
  });
});

describe('duplicateBlocks / nameSignature', () => {
  const m = { id: 'x', displayName: 'X', maskedDocument: null, status: 'ACTIVE' as const, creditCount: 0, deleted: false, otherDocument: false };
  it('el documento bloquea siempre; los homónimos hasta confirmar', () => {
    expect(duplicateBlocks({ document: m, names: [] }, true)).toBe('document');
    expect(duplicateBlocks({ document: null, names: [m] }, false)).toBe('names');
    expect(duplicateBlocks({ document: null, names: [m] }, true)).toBeNull();
    expect(duplicateBlocks(null, false)).toBeNull();
  });
  it('la firma ignora mayúsculas y espacios y cambia con el nombre', () => {
    expect(nameSignature(form({ firstName: ' Juan ', lastName: 'PÉREZ' }))).toBe(nameSignature(form({ firstName: 'juan', lastName: 'pérez' })));
    expect(nameSignature(form({ firstName: 'Juan', lastName: 'Pérez' }))).not.toBe(nameSignature(form({ firstName: 'Juan', lastName: 'Perez' })));
  });
});

describe('maskDocument', () => {
  it('enmascara y no toca lo ya enmascarado', () => {
    expect(maskDocument('8812303')).toBe('88***03');
    expect(maskDocument('88****03')).toBe('88****03');
    expect(maskDocument('')).toBeNull();
  });
});

describe('checkDuplicates', () => {
  it('con señal usa la respuesta del servidor', async () => {
    const check = { document: null, names: [] };
    mockApi.res = { status: 'ok', data: check };
    expect(await checkDuplicates({ clientType: 'PERSON', nationalId: '123' })).toEqual({ check, source: 'server' });
  });
  it('un error del servidor no inventa nada', async () => {
    mockApi.res = { status: 'error', message: 'x' };
    expect(await checkDuplicates({ clientType: 'PERSON', nationalId: '123' })).toBeNull();
  });
  it('sin señal bloquea el mismo documento de un cliente cargado en el teléfono', async () => {
    const r = await checkDuplicates({ clientType: 'PERSON', nationalId: '123-4567' });
    expect(r?.source).toBe('local');
    expect(r?.check.document?.id).toBe('p1');
    expect(r?.check.document?.maskedDocument).toBe('12***67');
  });
  it('sin señal avisa del mismo nombre en la cartera, sin importar tildes ni el orden', async () => {
    const r = await checkDuplicates({ clientType: 'PERSON', firstName: 'JUAN', lastName: 'martinez duran' });
    expect(r?.check.document).toBeNull();
    expect(r?.check.names.map((n) => n.id)).toEqual(['c1']);
    expect(r?.check.names[0]?.creditCount).toBe(2);
  });
  it('sin coincidencias devuelve vacío', async () => {
    const r = await checkDuplicates({ clientType: 'PERSON', firstName: 'Zoe', lastName: 'Nadie' });
    expect(r?.check).toEqual({ document: null, names: [] });
  });
});
