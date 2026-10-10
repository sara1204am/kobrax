/**
 * Contrato de `db.ts`. **No testea que SQLite funcione** —eso ya lo probó SQLite— sino las
 * decisiones propias, que son las que pueden costar un pago: que un fallo nunca borre de la cola,
 * que el orden sea de inserción y no del reloj, y que tirar el caché no se lleve la cola puesta.
 *
 * El mock captura el SQL emitido en vez de interpretarlo: escribir un intérprete de SQL casero para
 * un test sería más código que lo que se está probando.
 */
// El prefijo `mock` es obligatorio: `jest.mock` se hoistea y sólo deja referenciar variables así.
const mockSql: { query: string; args: unknown[] }[] = [];
const mockState: { firstRow: unknown } = { firstRow: null };

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async (q: string) => void mockSql.push({ query: q, args: [] })),
    runAsync: jest.fn(async (q: string, a: unknown[] = []) => {
      mockSql.push({ query: q, args: a });
      return { lastInsertRowId: 7, changes: 1 };
    }),
    getFirstAsync: jest.fn(async (q: string, a: unknown[] = []) => {
      mockSql.push({ query: q, args: a });
      return mockState.firstRow;
    }),
    getAllAsync: jest.fn(async (q: string, a: unknown[] = []) => {
      mockSql.push({ query: q, args: a });
      return [];
    }),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
  })),
}));

import { dequeue, enqueue, markFailed, pending, purgeCache, putAll, resetForTests, SCHEMA_VERSION } from './db';

/** Las queries emitidas desde que arrancó el caso, en texto plano. */
const emitido = () => mockSql.map((s) => s.query.replace(/\s+/g, ' ').trim());
const ultima = () => mockSql[mockSql.length - 1]!;

beforeEach(async () => {
  // La conexión se abre una sola vez y se cachea, así que el chequeo de versión corre sólo en la
  // primera apertura. Sin este reset, el caso de "versión vieja" nunca lo ejecutaría.
  await resetForTests();
  mockSql.length = 0;
  mockState.firstRow = { value: String(SCHEMA_VERSION) }; // versión de esquema al día: no dispara el borrado
});

describe('cola de escritura', () => {
  it('un fallo NO borra el ítem: cuenta el intento y guarda el motivo', async () => {
    await markFailed(3, 'timeout');
    const q = ultima();
    expect(q.query).toMatch(/UPDATE queue SET attempts = attempts \+ 1/);
    expect(q.query).not.toMatch(/DELETE/);
    expect(q.args).toEqual(['timeout', 3]);
  });

  it('sólo se borra cuando salió bien', async () => {
    await dequeue(3);
    expect(ultima().query).toMatch(/DELETE FROM queue WHERE id = \?/);
  });

  // Con ORDER BY created_at, un teléfono con la hora corrida subiría las acciones desordenadas.
  it('el orden es de inserción, no del reloj del teléfono', async () => {
    await pending('u1');
    expect(ultima().query).toMatch(/ORDER BY id ASC/);
    expect(ultima().query).not.toMatch(/created_at/);
  });

  it('la cola es de un cobrador, no del teléfono', async () => {
    await pending('u1');
    expect(ultima().query).toMatch(/WHERE user_id = \?/);
    expect(ultima().args).toEqual(['u1']);
  });

  it('guarda la clave de idempotencia con la que se encoló, no una nueva al enviar', async () => {
    await enqueue({ userId: 'u1', kind: 'payment', payload: { amount: 100 }, idempotencyKey: 'k-1' });
    const q = mockSql.find((s) => s.query.includes('INSERT INTO queue'))!;
    expect(q.args).toContain('k-1');
  });
});

describe('esquema', () => {
  // F4/08 (dev-only): sin teléfonos con colas reales, el cambio de esquema borra TAMBIÉN la cola y los mapas de
  // ids locales (`meta`), y deja escrita la versión nueva.
  it('una versión vieja tira el caché, la cola y los mapas de ids, y guarda la versión nueva', async () => {
    mockState.firstRow = { value: '2' }; // la anterior a «sin caso»
    await putAll('client', [{ id: 'c1' }]);
    const borrados = emitido().filter((q) => q.startsWith('DELETE'));
    expect(borrados.some((q) => q.includes('DELETE FROM cache'))).toBe(true);
    expect(borrados.some((q) => q.includes('DELETE FROM queue'))).toBe(true);
    expect(borrados.some((q) => q.includes('DELETE FROM meta'))).toBe(true);
    const ver = mockSql.find((s) => s.query.includes('INSERT OR REPLACE INTO meta'))!;
    expect(ver.args).toEqual(['schema_version', String(SCHEMA_VERSION)]);
  });

  it('con la versión al día NO borra nada (ni caché ni cola)', async () => {
    await putAll('client', [{ id: 'c1' }]);
    expect(emitido().filter((q) => q.startsWith('DELETE'))).toEqual([]);
  });

  it('la versión de esquema es la 3 (sin caso)', () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('el caché guarda el JSON del server tal cual, para que un campo nuevo no rompa nada', async () => {
    await putAll('client', [{ id: 'c1', nombre: 'Ana', campoQueElServerAgregoAyer: 42 } as never]);
    const ins = mockSql.find((s) => s.query.includes('INSERT OR REPLACE INTO cache'))!;
    expect(String(ins.args[3])).toContain('campoQueElServerAgregoAyer');
  });
});

describe('purgeCache (D-9)', () => {
  it('saca lo vencido sin tocar sesión, catálogos ni totales, y nunca la cola', async () => {
    mockState.firstRow = { value: String(SCHEMA_VERSION), bytes: 0 };
    await purgeCache(7 * 86_400_000, 50_000_000, 1_000_000_000_000);
    const del = emitido().find((q) => /^DELETE FROM cache WHERE fetched_at < \? AND kind NOT IN/.test(q))!;
    expect(del).toBeDefined();
    const call = mockSql.find((q) => q.query.replace(/\s+/g, ' ').trim() === del)!;
    expect(call.args).toEqual([1_000_000_000_000 - 7 * 86_400_000, 'session', 'catalog', 'arrear.categories', 'list.meta']);
    expect(emitido().some((q) => /DELETE FROM queue/.test(q))).toBe(false);
  });

  it('pasado el tope de tamaño borra las menos recientes, por lotes', async () => {
    mockState.firstRow = { value: String(SCHEMA_VERSION), bytes: 99_000_000 };
    await purgeCache(7 * 86_400_000, 50_000_000);
    expect(emitido().some((q) => /ORDER BY fetched_at ASC LIMIT 100/.test(q))).toBe(true);
  });
});
