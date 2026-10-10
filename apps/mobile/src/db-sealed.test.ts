/**
 * La base con el cifrado REAL (`at-rest`): lo que llega al SQL no es texto legible, y lo que se lee vuelve en claro.
 */
const mockSql: { query: string; args: unknown[] }[] = [];
const mockState: { rows: unknown[] } = { rows: [] };
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
}));
let mockN = 0;
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + ++mockN) % 256),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async (q: string, a: unknown[] = []) => {
      mockSql.push({ query: q, args: a });
      return { lastInsertRowId: 1, changes: 1 };
    }),
    getFirstAsync: jest.fn(async (q: string, a: unknown[] = []) => {
      mockSql.push({ query: q, args: a });
      return { value: '3', ...((mockState.rows[0] as object | undefined) ?? {}) };
    }),
    getAllAsync: jest.fn(async (q: string) => (/FROM queue WHERE user_id/.test(q) || /FROM cache/.test(q) ? mockState.rows : [])),
  })),
}));

import { resetKeyForTests } from './at-rest';
import { enqueue, getOne, pending, putOne, resetForTests, SCHEMA_VERSION } from './db';

beforeEach(async () => {
  mockStore.clear();
  mockSql.length = 0;
  mockState.rows = [];
  resetKeyForTests();
  await resetForTests();
});

const lastInsert = (table: string) => [...mockSql].reverse().find((s) => s.query.includes(`INTO ${table}`))!;

describe('base cifrada', () => {
  it('SCHEMA_VERSION no cambió: la cola vieja no se borra por cifrar', () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('el caché se guarda cifrado: ni nombre ni teléfono aparecen en el SQL', async () => {
    await putOne('client', 'c1', { id: 'c1', nombre: 'Ana Pérez', telefono: '70012345' });
    const json = String(lastInsert('cache').args[3]);
    expect(json.startsWith('enc1:')).toBe(true);
    expect(json).not.toContain('Ana');
    expect(json).not.toContain('70012345');
  });

  it('la cola se guarda cifrada y se lee en claro', async () => {
    await enqueue({ userId: 'u1', kind: 'payment', payload: { input: { amount: 450, creditId: 'cr1' } } });
    const stored = String(lastInsert('queue').args[2]);
    expect(stored.startsWith('enc1:')).toBe(true);
    expect(stored).not.toContain('450');

    mockState.rows = [{ id: 1, user_id: 'u1', kind: 'payment', payload: stored, idempotency_key: null, attempts: 0, last_error: null, created_at: 1 }];
    const [row] = await pending('u1');
    expect(JSON.parse(row!.payload)).toEqual({ input: { amount: 450, creditId: 'cr1' } });
  });

  it('una fila de la cola anterior al cifrado se lee igual', async () => {
    mockState.rows = [{ id: 2, user_id: 'u1', kind: 'payment', payload: '{"old":true}', idempotency_key: null, attempts: 0, last_error: null, created_at: 1 }];
    const [row] = await pending('u1');
    expect(row!.payload).toBe('{"old":true}');
  });

  it('una fila de caché ilegible se descarta (devuelve null, no revienta)', async () => {
    mockState.rows = [{ json: 'enc1:00ff' }];
    expect(await getOne('client', 'c1')).toBeNull();
  });
});
