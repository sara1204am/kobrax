import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrearsJobService } from './arrears-job.service';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const HOY = d('2026-08-17');

interface CreditRow {
  id: string;
  clientId?: string;
  branchId?: string | null;
  outstandingBalance: number;
  daysPastDue: number;
  metadata: Record<string, unknown>;
  assignedManagerId?: string | null;
  client?: { riskSegment?: string | null };
  installments?: { id: string; dueDate: Date; amount: number; paidAmount: number; status: string }[];
}

/**
 * Fake en memoria: un solo tenant, y se registra todo lo que el job escribe. Sin `promise_due_account_ids()`
 * se prueba `scanAccount` directo — enumerar tenants es del `run()` y es una línea de SQL.
 */
function makeJob(
  credits: CreditRow[],
  openCases: { id: string; creditId: string; priority: string; priorityPinnedAt?: Date | null }[] = [],
  configuration: unknown = {},
) {
  const calls = {
    creditUpdate: [] as { id: string; daysPastDue: number }[],
    caseCreate: [] as Record<string, unknown>[],
    caseUpdate: [] as { id: string; data: Record<string, unknown> }[],
  };
  const tx = {
    account: { findFirst: async () => ({ configuration }) },
    credit: {
      findMany: async () =>
        credits.map((c) => ({
          branchId: null,
          clientId: 'cl1',
          assignedManagerId: null,
          client: { riskSegment: null },
          installments: [],
          ...c,
        })),
      update: async (args: { where: { id: string }; data: { daysPastDue: number } }) => {
        calls.creditUpdate.push({ id: args.where.id, daysPastDue: args.data.daysPastDue });
        return {};
      },
    },
    collectionCase: {
      findMany: async () => openCases,
      // La re-verificación de `openCaseIfNone`: idempotente aunque dos pasadas se pisen.
      findFirst: async (args: { where: { creditId: string } }) =>
        openCases.find((c) => c.creditId === args.where.creditId) ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.caseCreate.push(args.data);
        return { id: 'k-new' };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.caseUpdate.push({ id: args.where.id, data: args.data });
        return {};
      },
      updateMany: async (args: { where: { creditId: string }; data: Record<string, unknown> }) => {
        calls.caseUpdate.push({ id: args.where.creditId, data: args.data });
        return { count: 1 };
      },
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { job: new ArrearsJobService(prisma as never), calls };
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
    const { job, calls } = makeJob([
      manual({ daysPastDue: 37, metadata: { origin: 'import', nextDueDate: '2026-08-16' } }),
    ]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0, 'no se toca el número que trajo el archivo');
    // …y con esos 37 días igual se le abre el caso: es cómo entra a Mora una cartera de archivo.
    assert.equal(calls.caseCreate.length, 1);
  });

  it('🔴 la manual envejece sola desde `moraSince`, sin que nadie la reescriba', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', moraSince: '2026-08-02' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 15);
  });

  it('la marca a mano gana sobre la fecha de vencimiento del propio crédito', async () => {
    // Vencía hace 2 días, pero alguien la marcó hace 15: manda la marca.
    const { job, calls } = makeJob([
      manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-15', moraSince: '2026-08-02' } }),
    ]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 15);
  });
});

describe('ArrearsJobService — abre y cierra el caso solo', () => {
  it('al primer día de vencido abre el caso', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-16' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseCreate.length, 1);
    assert.equal(calls.caseCreate[0]!.status, 'PENDING');
  });

  it('el día del vencimiento todavía NO abre nada', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-17' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseCreate.length, 0);
  });

  it('es idempotente: con un caso ya abierto no crea otro', async () => {
    const { job, calls } = makeJob(
      [manual({ daysPastDue: 10, metadata: { origin: 'manual', nextDueDate: '2026-08-07' } })],
      [{ id: 'k1', creditId: 'cr1', priority: 'MEDIUM' }],
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseCreate.length, 0);
  });

  it('saldo en cero cierra el caso con motivo PAGADO', async () => {
    const { job, calls } = makeJob(
      [manual({ outstandingBalance: 0, daysPastDue: 30, metadata: { origin: 'manual', nextDueDate: '2026-07-01' } })],
      [{ id: 'k1', creditId: 'cr1', priority: 'HIGH' }],
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseUpdate[0]!.data.status, 'CLOSED');
    assert.equal(calls.caseUpdate[0]!.data.closedReason, 'PAID');
  });

  it('mover la fecha al futuro pone al día y cierra el caso', async () => {
    const { job, calls } = makeJob(
      [manual({ daysPastDue: 10, metadata: { origin: 'manual', nextDueDate: '2026-09-15' } })],
      [{ id: 'k1', creditId: 'cr1', priority: 'MEDIUM' }],
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 0);
    assert.equal(calls.caseUpdate[0]!.data.closedReason, 'CURRENT');
  });

  it('un crédito sin fecha y sin mora no abre nada', async () => {
    const { job, calls } = makeJob([manual({ metadata: { origin: 'manual' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseCreate.length, 0);
    assert.equal(calls.caseUpdate.length, 0);
  });

  /**
   * 🔴 **«No sé calcularlo» no es «vale cero», y tampoco es «hay que salir a cobrarlo».**
   *
   * Un crédito sin cronograma, sin próxima fecha, sin marca a mano y sin archivo detrás tiene un
   * número de días que no se puede explicar. En la base de desarrollo son **199.427 créditos** —el
   * lote sintético del benchmark—: sin esta guarda la primera pasada les ponía la mora en cero, o
   * peor, abría 199.421 casos y dejaba Mora inservible.
   */
  it('sin nada de dónde sacar la mora, no la toca NI abre caso', async () => {
    const { job, calls } = makeJob([manual({ daysPastDue: 120, metadata: {} })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0, 'la mora cargada queda como está');
    assert.equal(calls.caseCreate.length, 0, 'y no se sale a cobrar algo que nadie puede fechar');
  });

  /** El importado sí abre caso sin fecha: su archivo es de dónde sale la mora. */
  it('el importado abre caso con la mora del archivo, aunque no traiga fecha', async () => {
    const { job, calls } = makeJob([manual({ daysPastDue: 120, metadata: { origin: 'import' } })]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseCreate.length, 1);
  });

  /**
   * 🔴 Sin heredar el responsable, el caso nace sin dueño — y `routes.generate` filtra por
   * `assigneeId`. La cartera se llenaría de casos que no entran a la ruta de nadie.
   */
  it('el caso hereda el responsable del préstamo', async () => {
    const { job, calls } = makeJob([
      manual({ assignedManagerId: 'u-cobrador', metadata: { origin: 'manual', nextDueDate: '2026-08-07' } }),
    ]);
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseCreate[0]!.assigneeId, 'u-cobrador');
  });
});

/**
 * 🔴 La prioridad se fijaba al abrir el caso y no se tocaba nunca más — y es **lo que ordena las
 * paradas de la ruta**. Un caso que abrió con un día seguía en prioridad baja con doscientos.
 */
describe('ArrearsJobService — la prioridad sigue a la mora', () => {
  it('sube la prioridad del caso abierto cuando la mora creció', async () => {
    const { job, calls } = makeJob(
      [manual({ outstandingBalance: 90_000, daysPastDue: 200, metadata: { origin: 'manual', moraSince: '2026-01-01' } })],
      [{ id: 'k1', creditId: 'cr1', priority: 'LOW' }],
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseUpdate[0]!.id, 'k1');
    assert.equal(calls.caseUpdate[0]!.data.priority, 'CRITICAL');
  });

  /**
   * 🔴 **La prioridad fijada a mano no se toca, y sin esto la función no servía de nada.**
   *
   * El cálculo sale del saldo, la mora y el riesgo — buena regla en general, y equivocada justo en el
   * caso que motivó la marca: un deudor con dos días de atraso cae en baja aunque quien lo conoce
   * sepa que es moroso frecuente y hay que ir hoy. Sin esta guarda, subirla duraba hasta la noche.
   */
  it('no pisa la prioridad que fijó una persona', async () => {
    const { job, calls } = makeJob(
      [manual({ daysPastDue: 2, metadata: { origin: 'manual', nextDueDate: '2026-08-15' } })],
      [{ id: 'k1', creditId: 'cr1', priority: 'CRITICAL', priorityPinnedAt: d('2026-08-10') }],
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseUpdate.length, 0, 'con dos días de mora el cálculo daría LOW, y no la toca');
  });

  it('soltada la marca, el cálculo la vuelve a mandar', async () => {
    const { job, calls } = makeJob(
      [manual({ daysPastDue: 2, metadata: { origin: 'manual', nextDueDate: '2026-08-15' } })],
      [{ id: 'k1', creditId: 'cr1', priority: 'CRITICAL', priorityPinnedAt: null }],
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.caseUpdate[0]!.data.priority, 'LOW');
  });

  it('si no cambió, no escribe: correr dos veces el mismo día no toca nada', async () => {
    const { job, calls } = makeJob(
      [manual({ daysPastDue: 10, metadata: { origin: 'manual', nextDueDate: '2026-08-07' } })],
      [{ id: 'k1', creditId: 'cr1', priority: 'LOW' }],
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate.length, 0, 'los días ya eran 10');
    assert.equal(calls.caseUpdate.length, 0, 'la prioridad ya era la que corresponde');
  });
});

describe('ArrearsJobService — el umbral es del tenant', () => {
  it('con `minDaysPastDue` en 5, cuatro días de mora todavía no abren caso', async () => {
    const { job, calls } = makeJob(
      [manual({ metadata: { origin: 'manual', nextDueDate: '2026-08-13' } })],
      [],
      { caseGeneration: { minDaysPastDue: 5 } },
    );
    await job.scanAccount('acc-A', HOY);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 4);
    assert.equal(calls.caseCreate.length, 0);
  });
});
