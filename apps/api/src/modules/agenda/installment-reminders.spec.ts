import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InstallmentReminderService, reminderId } from './installment-reminders.service';

const NOW = new Date('2026-10-04T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

interface Opts {
  installments?: Record<string, unknown>[];
  imported?: Record<string, unknown>[];
  staleAfterDays?: number;
  accountIds?: string[];
  throwEnumeration?: boolean;
}

function makeService(opts: Opts = {}) {
  /** El «ledger» de agenda persiste entre corridas: así se prueba la idempotencia de verdad. */
  const stored = new Map<string, Record<string, unknown>>();
  const calls = { installmentWhere: undefined as Record<string, unknown> | undefined, importedWhere: undefined as Record<string, unknown> | undefined };
  const tx = {
    account: { findUnique: async () => ({ configuration: opts.staleAfterDays ? { importConfig: { staleAfterDays: opts.staleAfterDays } } : {} }) },
    creditInstallment: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.installmentWhere = a.where;
        return opts.installments ?? [];
      },
    },
    credit: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.importedWhere = a.where;
        return opts.imported ?? [];
      },
    },
    agendaItem: {
      createMany: async (a: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
        assert.equal(a.skipDuplicates, true);
        let count = 0;
        for (const d of a.data) {
          if (stored.has(d.id as string)) continue;
          stored.set(d.id as string, d);
          count += 1;
        }
        return { count };
      },
    },
  };
  const prisma = {
    withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    $queryRaw: async () => {
      if (opts.throwEnumeration) throw new Error('function does not exist');
      return (opts.accountIds ?? ['acc-A']).map((account_id) => ({ account_id }));
    },
  };
  return { service: new InstallmentReminderService(prisma as never), stored, calls };
}

const kobraxInstallment = (over: Record<string, unknown> = {}) => ({
  creditId: 'cr1',
  number: 3,
  dueDate: new Date(`${day(2)}T00:00:00Z`),
  credit: { clientId: 'cl1', assignedManagerId: 'col1', origin: 'MANUAL', metadata: {} },
  ...over,
});

const importedCredit = (over: Record<string, unknown> = {}) => ({
  id: 'cr2',
  clientId: 'cl2',
  assignedManagerId: 'col2',
  origin: 'IMPORT',
  metadata: { origin: 'import', nextDueDate: day(1) },
  reportedAsOf: new Date(`${day(-1)}T00:00:00Z`),
  ...over,
});

describe('InstallmentReminderService · créditos de Kobrax (cronograma)', () => {
  it('crea el recordatorio «Cobrar cuota» para el responsable, con la fecha de la cuota', async () => {
    const { service, stored } = makeService({ installments: [kobraxInstallment()] });
    assert.equal(await service.scanAccount('acc-A', NOW), 1);
    const item = [...stored.values()][0]!;
    assert.equal(item.type, 'REMINDER');
    assert.equal(item.assigneeId, 'col1');
    assert.equal(item.creditId, 'cr1');
    assert.equal(item.clientId, 'cl1');
    assert.equal(item.accountId, 'acc-A');
    assert.deepEqual(item.details, { description: 'Cobrar cuota' });
    assert.equal((item.scheduledDate as Date).toISOString().slice(0, 10), day(2));
    assert.equal(item.id, reminderId('cr1', 3));
  });

  it('la consulta pide cuotas impagas dentro de los próximos 3 días de créditos vivos', async () => {
    const { service, calls } = makeService({ installments: [] });
    await service.scanAccount('acc-A', NOW);
    const w = calls.installmentWhere as { dueDate: { gte: Date; lte: Date }; status: { not: string } };
    assert.equal(w.dueDate.gte.toISOString().slice(0, 10), day(0));
    assert.equal(w.dueDate.lte.toISOString().slice(0, 10), day(3));
    assert.equal(w.status.not, 'PAID');
  });

  it('idempotente: volver a correr (o correr dos veces a la vez) no duplica', async () => {
    const { service, stored } = makeService({ installments: [kobraxInstallment()] });
    assert.equal(await service.scanAccount('acc-A', NOW), 1);
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(stored.size, 1);
  });

  it('una cuota distinta del mismo crédito tiene otro id', async () => {
    const { service, stored } = makeService({ installments: [kobraxInstallment(), kobraxInstallment({ number: 4 })] });
    assert.equal(await service.scanAccount('acc-A', NOW), 2);
    assert.equal(stored.size, 2);
  });

  it('sin responsable no hay a quién recordarle: se omite', async () => {
    const { service, stored } = makeService({ installments: [kobraxInstallment({ credit: { clientId: 'cl1', assignedManagerId: null, origin: 'MANUAL', metadata: {} } })] });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(stored.size, 0);
  });

  it('un crédito importado con cuotas sueltas no se recuerda por cronograma (manda el reporte)', async () => {
    const { service } = makeService({ installments: [kobraxInstallment({ credit: { clientId: 'cl1', assignedManagerId: 'col1', origin: 'IMPORT', metadata: {} } })] });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
  });
});

describe('InstallmentReminderService · importados sin cronograma (nextDueDate del reporte)', () => {
  it('usa metadata.nextDueDate si el reporte no está viejo', async () => {
    const { service, stored, calls } = makeService({ imported: [importedCredit()] });
    assert.equal(await service.scanAccount('acc-A', NOW), 1);
    const item = [...stored.values()][0]!;
    assert.equal(item.assigneeId, 'col2');
    assert.equal(item.id, reminderId('cr2', day(1)));
    assert.equal((item.scheduledDate as Date).toISOString().slice(0, 10), day(1));
    assert.deepEqual(calls.importedWhere!.installments, { none: {} }); // sólo los que NO traen cronograma
  });

  it('reporte viejo (más de staleAfterDays): no genera el recordatorio', async () => {
    const stale = importedCredit({ reportedAsOf: new Date(`${day(-10)}T00:00:00Z`) });
    const { service } = makeService({ imported: [stale], staleAfterDays: 5 });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    // con un umbral más holgado de la cuenta, el mismo reporte sí sirve
    const ok = makeService({ imported: [stale], staleAfterDays: 30 });
    assert.equal(await ok.service.scanAccount('acc-A', NOW), 1);
  });

  it('fecha fuera de la ventana (pasada o a más de 3 días): no genera', async () => {
    const { service } = makeService({
      imported: [
        importedCredit({ id: 'p', metadata: { origin: 'import', nextDueDate: day(-1) } }),
        importedCredit({ id: 'f', metadata: { origin: 'import', nextDueDate: day(4) } }),
        importedCredit({ id: 'n', metadata: { origin: 'import' } }),
      ],
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
  });

  it('idempotente y sin responsable → omitido; un crédito de Kobrax sin cronograma no entra', async () => {
    const { service, stored } = makeService({
      imported: [
        importedCredit(),
        importedCredit({ id: 'sin', assignedManagerId: null }),
        importedCredit({ id: 'mobile', origin: 'MANUAL', metadata: { origin: 'manual', nextDueDate: day(1) } }),
      ],
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 1);
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(stored.size, 1);
  });
});

describe('InstallmentReminderService.run', () => {
  it('barre los tenants enumerados', async () => {
    const { service } = makeService({ installments: [kobraxInstallment()], accountIds: ['acc-A', 'acc-B'] });
    // el ledger del fake es compartido: el segundo tenant ve el mismo id → sólo el primero crea
    assert.equal(await service.run(NOW), 1);
  });

  it('resiliente: si la función de enumeración no existe, omite el job', async () => {
    const { service } = makeService({ throwEnumeration: true });
    assert.equal(await service.run(NOW), 0);
  });

  it('reminderId es estable, con forma de uuid y distinto por cuota/fecha', () => {
    assert.equal(reminderId('c', 1), reminderId('c', 1));
    assert.notEqual(reminderId('c', 1), reminderId('c', 2));
    assert.match(reminderId('c', '2026-10-05'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
