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

import { dequeue, enqueue, markFailed, pending, putAll, resetForTests } from './db';

/** Las queries emitidas desde que arrancó el caso, en texto plano. */
const emitido = () => mockSql.map((s) => s.query.replace(/\s+/g, ' ').trim());
const ultima = () => mockSql[mockSql.length - 1]!;

beforeEach(async () => {
  // La conexión se abre una sola vez y se cachea, así que el chequeo de versión corre sólo en la
  // primera apertura. Sin este reset, el caso de "versión vieja" nunca lo ejecutaría.
  await resetForTests();
  mockSql.length = 0;
  mockState.firstRow = { value: '1' }; // versión de esquema al día: no dispara el borrado
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
  it('una versión vieja tira el caché pero NO la cola', async () => {
    mockState.firstRow = { value: '999' }; // no coincide con SCHEMA_VERSION
    await putAll('client', [{ id: 'c1' }]);
    const borrados = emitido().filter((q) => q.startsWith('DELETE'));
    expect(borrados.some((q) => q.includes('DELETE FROM cache'))).toBe(true);
    expect(borrados.some((q) => q.includes('DELETE FROM queue'))).toBe(false);
  });

  it('el caché guarda el JSON del server tal cual, para que un campo nuevo no rompa nada', async () => {
    await putAll('client', [{ id: 'c1', nombre: 'Ana', campoQueElServerAgregoAyer: 42 } as never]);
    const ins = mockSql.find((s) => s.query.includes('INSERT OR REPLACE INTO cache'))!;
    expect(String(ins.args[3])).toContain('campoQueElServerAgregoAyer');
  });
});
