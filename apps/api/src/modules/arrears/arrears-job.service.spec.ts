import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrearsJobService } from './arrears-job.service';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const HOY = d('2026-08-17');

interface CreditRow {
  id: string;
  outstandingBalance: number;
  daysPastDue: number;
  metadata: Record<string, unknown>;
  syncStatus?: 'PRESENT' | 'ABSENT' | null;
  reportedAsOf?: Date | null;
  installments?: { id: string; dueDate: Date; amount: number; paidAmount: number; status: string }[];
  /** D1-a: el castigo es una condición aparte; el job no la mira. */
  writtenOffAt?: Date | null;
}

/**
 * Fake en memoria: un solo tenant, y se registra todo lo que el job escribe. Sin `promise_due_account_ids()`
 * se prueba `scanAccount` directo — enumerar tenants es del `run()` y es una línea de SQL.
 *
 * F4/08: el job no maneja casos. Los episodios los abre el trigger de la
 * base; la prioridad la calcula `ArrearsPriorityService`, acá un fake que registra a qué créditos se la pide.
 */
function makeJob(
  credits: CreditRow[],
  openEpisodes: { creditId: string; priority: string }[] = [],
  configuration: unknown = {},
  recomputed: Record<string, string> = {},
) {
  const calls = {
    creditUpdate: [] as { id: string; daysPastDue: number }[],
    recompute: [] as string[],
    creditWhere: undefined as Record<string, unknown> | undefined,
  };
  const tx = {
    account: { findFirst: async () => ({ configuration }) },
    credit: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        calls.creditWhere = args.where;
        return credits.map((c) => ({ installments: [], ...c }));
      },
      update: async (args: { where: { id: string }; data: { daysPastDue: number } }) => {
        calls.creditUpdate.push({ id: args.where.id, daysPastDue: args.data.daysPastDue });
        return {};
      },
    },
    creditArrearEpisode: { findMany: async () => openEpisodes },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const priority = {
    recomputeForCredit: async (_t: unknown, creditId: string) => {
      calls.recompute.push(creditId);
      return recomputed[creditId] ?? null;
    },
  };
  return { job: new ArrearsJobService(prisma as never, priority as never), calls };
}

const manual = (over: Partial<CreditRow> = {}): CreditRow => ({
  id: 'cr1',
  outstandingBalance: 900,
  daysPastDue: 0,
  metadata: { origin: 'manual' },
  ...over,
});

/**
 * La regla que sostiene el módulo: una mora, tres orígenes, **un dueño cada uno**. Si el job pudiera
 * decidir la importada o la manual, aparecería el ciclo de «lo puse al día y volvió a mora».
 */
describe('ArrearsJobService — quién es dueño de la mora', () => {
  it('la calculada sale de la próxima fecha de vencimiento', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-07' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 10);
  });

  it('🔴 la importada NO se recalcula: su archivo manda hasta la próxima carga', async () => {
    const { job, calls } = makeJob([manual({ daysPastDue: 37, metadata: { origin: 'import', nextDueDate: '2026-08-16' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0, 'no se toca el número que trajo el archivo');
  });

  it('🔴 la manual envejece sola desde `moraSince`, sin que nadie la reescriba', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', moraSince: '2026-08-02' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 15);
  });

  it('la marca a mano gana sobre la fecha de vencimiento del propio crédito', async () => {
    // Vencía hace 2 días, pero alguien la marcó hace 15: manda la marca.
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-15', moraSince: '2026-08-02' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 15);
  });
});

describe('ArrearsJobService — ya no abre ni cierra casos (los episodios son del trigger)', () => {
  it('una mora nueva solo actualiza los días: no toca los casos', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-16' } })]);
    const r = await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 1);
    assert.equal(r.updated, 1);
  });

  it('🔴 la importada se queda con los días del archivo; su episodio abierto sí recalcula la prioridad', async () => {
    const { job, calls } = makeJob([manual({ daysPastDue: 37, metadata: { origin: 'import', nextDueDate: '2026-08-16' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0);
    assert.deepEqual(calls.recompute, ['cr1']);
  });

  it('saldo en cero: actualiza los días y no recalcula prioridad (no hay episodio abierto)', async () => {
    const { job, calls } = makeJob([
      manual({ outstandingBalance: 0, daysPastDue: 30, metadata: { origin: 'manual', nextDueDate: '2026-07-01' } }),
    ]);
    await job.scanAccount('acc-A', HOY);
    assert.deepEqual(calls.recompute, []);
  });

  it('mover la fecha al futuro deja los días en 0 (el trigger cierra el episodio) y no recalcula', async () => {
    const { job, calls } = makeJob([manual({ daysPastDue: 10, metadata: { origin: 'manual', nextDueDate: '2026-09-15' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 0);
    assert.deepEqual(calls.recompute, []);
  });

  it('el día del vencimiento todavía no hay mora ni prioridad', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-17' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.deepEqual(calls.recompute, []);
  });

  it('un crédito sin fecha y sin mora no hace nada', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0);
    assert.deepEqual(calls.recompute, []);
  });

  /** 🔴 «No sé calcularlo» no es «vale cero», y tampoco es «hay que salir a cobrarlo». */
  it('sin nada de dónde sacar la mora, no la toca ni la prioriza', async () => {
    const { job, calls } = makeJob([manual({ daysPastDue: 120, metadata: {} })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0, 'la mora cargada queda como está');
    assert.deepEqual(calls.recompute, []);
  });

  it('el importado sin fecha igual se prioriza con la mora de su archivo', async () => {
    const { job, calls } = makeJob([manual({ daysPastDue: 120, metadata: { origin: 'import' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.deepEqual(calls.recompute, ['cr1']);
  });
});

/**
 * La prioridad vive en el episodio abierto y es lo que ordena las paradas de la ruta. El job se la pide a
 * `ArrearsPriorityService` (que respeta la fijada a mano: eso se prueba en mora.priority.spec).
 */
describe('ArrearsJobService — la prioridad sigue a la mora', () => {
  it('recalcula la del episodio abierto y cuenta la que cambió', async () => {
    const { job, calls } = makeJob(
      [manual({ outstandingBalance: 90_000, daysPastDue: 200, metadata: { origin: 'manual', moraSince: '2026-01-01' } })],
      [{ creditId: 'cr1', priority: 'LOW' }],
      {},
      { cr1: 'CRITICAL' },
    );
    const r = await job.scanAccount('acc-A', HOY);
    assert.deepEqual(calls.recompute, ['cr1']);
    assert.equal(r.reprioritized, 1);
  });

  it('si no cambió, no cuenta: correr dos veces el mismo día no mueve nada', async () => {
    const { job, calls } = makeJob(
      [manual({ daysPastDue: 10, metadata: { origin: 'manual', nextDueDate: '2026-08-07' } })],
      [{ creditId: 'cr1', priority: 'LOW' }],
      {},
      { cr1: 'LOW' },
    );
    const r = await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0, 'los días ya eran 10');
    assert.equal(r.reprioritized, 0);
  });

  it('el episodio que abrió el trigger en esta misma pasada no cuenta como «repriorizado»', async () => {
    const { job, calls } = makeJob(
      [manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-07' } })],
      [], // no había episodio al leer el lote
      {},
      { cr1: 'MEDIUM' },
    );
    const r = await job.scanAccount('acc-A', HOY);
    assert.deepEqual(calls.recompute, ['cr1']);
    assert.equal(r.reprioritized, 0);
  });
});

/**
 * Operaciones externas (PSF): su mora la manda el reporte, y **la ausencia no es un pago ni un «al día»** (D4).
 * El episodio de la ausente lo cierra el trigger (D9); el job no la toca.
 */
describe('ArrearsJobService — operaciones externas (PSF)', () => {
  const psf = (over: Partial<CreditRow> = {}): CreditRow =>
    manual({ daysPastDue: 40, syncStatus: 'PRESENT', reportedAsOf: d('2026-08-16'), metadata: { origin: 'import' }, ...over });

  it('🔴 la que faltó en su reporte no se toca: ni su mora ni su prioridad', async () => {
    const { job, calls } = makeJob([psf({ syncStatus: 'ABSENT', daysPastDue: 0 })], [{ creditId: 'cr1', priority: 'HIGH' }]);
    const r = await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0);
    assert.deepEqual(calls.recompute, []);
    assert.equal(r.updated + r.reprioritized, 0);
  });

  it('la que vuelve al reporte se prioriza como cualquier otra (el trigger reabre su episodio)', async () => {
    const { job, calls } = makeJob([psf()]);
    await job.scanAccount('acc-A', HOY);
    assert.deepEqual(calls.recompute, ['cr1']);
  });

  it('el dato viejo (D9) ya no frena nada en el job: la ficha lo avisa', async () => {
    const { job, calls } = makeJob([psf({ reportedAsOf: d('2026-08-01') })]);
    await job.scanAccount('acc-A', HOY);
    assert.deepEqual(calls.recompute, ['cr1']);
  });
});

/**
 * F4/08 · D1-a — el castigo es la condición `written_off_at`, no un estado: el crédito castigado sigue ACTIVE y el
 * job lo procesa como a cualquier otro (los días de mora siguen corriendo, y con ellos su categoría).
 */
describe('ArrearsJobService — un crédito castigado se procesa como cualquier activo', () => {
  const castigado = (over: Partial<CreditRow> = {}) =>
    manual({ metadata: { origin: 'manual', moraSince: '2026-01-01' }, writtenOffAt: d('2026-06-01'), ...over });

  it('🔴 los días de mora siguen corriendo aunque esté castigado', async () => {
    const { job, calls } = makeJob([castigado()]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 228, 'del 2026-01-01 al 2026-08-17');
  });

  it('el filtro de créditos no excluye a los castigados (sin writtenOffAt: null)', async () => {
    const { job, calls } = makeJob([castigado()]);
    await job.scanAccount('acc-A', HOY);
    assert.equal('writtenOffAt' in calls.creditWhere!, false);
    const or = calls.creditWhere!.OR as Record<string, unknown>[];
    assert.ok(or.some((w) => w.status === 'ACTIVE' && !('writtenOffAt' in w)), 'ACTIVE entra, castigado o no');
  });

  it('compatibilidad: un viejo con estado WRITTEN_OFF y written_off_at también cuenta sus días', async () => {
    const { job, calls } = makeJob([castigado()]);
    await job.scanAccount('acc-A', HOY);
    const or = calls.creditWhere!.OR as { status?: string; writtenOffAt?: unknown }[];
    assert.ok(or.some((w) => w.status === 'WRITTEN_OFF' && w.writtenOffAt !== undefined));
  });

  it('con el crédito castigado y en mora el job hace lo mismo que con uno sin castigar', async () => {
    const a = makeJob([castigado()]);
    const b = makeJob([castigado({ writtenOffAt: null })]);
    await a.job.scanAccount('acc-A', HOY);
    await b.job.scanAccount('acc-A', HOY);
    assert.deepEqual(a.calls.creditUpdate, b.calls.creditUpdate);
    assert.deepEqual(a.calls.recompute, b.calls.recompute);
  });
});
