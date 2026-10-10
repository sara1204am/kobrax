import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PromiseDueService } from './promise-due.service';

const NOW = new Date('2026-06-18T12:00:00Z');
const soon = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

interface Opts {
  installments?: { creditId: string; number: number; dueDate: Date; credit?: { assignedManagerId: string | null } }[];
  /** Reemplazos TEMPORAL vigentes por crédito. */
  temporals?: { creditId: string; userId: string }[];
  /** Notificaciones ya enviadas dentro de la ventana: `userId|creditId`. */
  already?: string[];
  accountIds?: string[];
  throwEnumeration?: boolean;
}

function makeService(opts: Opts = {}) {
  const calls = {
    notified: [] as { userId: string; data: Record<string, unknown> }[],
    installmentWhere: undefined as Record<string, unknown> | undefined,
    temporalWhere: undefined as Record<string, unknown> | undefined,
    dupWhere: [] as Record<string, unknown>[],
  };
  const tx = {
    // La zona de la empresa: de ella sale el «hoy» con que se arma la ventana de cuotas.
    account: { findFirst: async () => ({ timezone: 'America/La_Paz', countryCode: 'BO' }) },
    creditInstallment: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.installmentWhere = a.where;
        // Por omisión, el responsable es `col1`.
        return (opts.installments ?? []).map((i) => ({ credit: { assignedManagerId: 'col1' }, ...i }));
      },
    },
    creditAssignment: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.temporalWhere = a.where;
        return opts.temporals ?? [];
      },
    },
    notification: {
      findFirst: async (a: { where: { userId: string; creditId: string } }) => {
        calls.dupWhere.push(a.where);
        return opts.already?.includes(`${a.where.userId}|${a.where.creditId}`) ? { id: 'existing' } : null;
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
  const notifications = {
    notifyUser: async (_accountId: string, userId: string, data: Record<string, unknown>) =>
      void calls.notified.push({ userId, data }),
  };
  const service = new PromiseDueService(prisma as never, notifications as never);
  return { service, calls };
}

describe('PromiseDueService.scanAccount', () => {
  it('avisa al responsable del crédito de la cuota próxima a vencer, con creditId', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
    });
    const n = await service.scanAccount('acc-A', NOW);
    assert.equal(n, 1);
    assert.equal(calls.notified[0]!.userId, 'col1');
    assert.equal(calls.notified[0]!.data.type, 'PROMISE_DUE');
    assert.equal(calls.notified[0]!.data.creditId, 'cr1');
  });

  it('avisa también al reemplazo TEMPORAL vigente (y al responsable, que conserva el crédito)', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
      temporals: [{ creditId: 'cr1', userId: 'tmp1' }],
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 2);
    assert.deepEqual(calls.notified.map((n) => n.userId).sort(), ['col1', 'tmp1']);
    // sólo temporales vigentes: sin revocar, ya empezados y sin vencer
    const w = calls.temporalWhere as { kind: string; revokedAt: null; startsAt: { lte: Date } };
    assert.equal(w.kind, 'TEMPORAL');
    assert.equal(w.revokedAt, null);
    assert.deepEqual(w.startsAt.lte, NOW);
  });

  it('si el temporal es el mismo responsable no avisa dos veces', async () => {
    const { service } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
      temporals: [{ creditId: 'cr1', userId: 'col1' }],
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 1);
  });

  it('toma solo el primer vencimiento por crédito', async () => {
    const { service, calls } = makeService({
      installments: [
        { creditId: 'cr1', number: 3, dueDate: soon(1) },
        { creditId: 'cr1', number: 4, dueDate: soon(2) },
      ],
    });
    const n = await service.scanAccount('acc-A', NOW);
    assert.equal(n, 1);
    assert.equal(calls.notified[0]!.data.body, `La cuota 3 vence el ${soon(1).toISOString().slice(0, 10)}.`);
  });

  it('idempotente por (usuario, crédito): no reavisa si ya hay un PROMISE_DUE reciente', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
      already: ['col1|cr1'],
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(calls.notified.length, 0);
    assert.equal(calls.dupWhere[0]!.creditId, 'cr1');
  });

  it('el dedupe es por usuario: el temporal recibe aunque el responsable ya haya sido avisado', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
      temporals: [{ creditId: 'cr1', userId: 'tmp1' }],
      already: ['col1|cr1'],
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 1);
    assert.equal(calls.notified[0]!.userId, 'tmp1');
  });

  it('omite créditos sin responsable ni temporal', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2), credit: { assignedManagerId: null } }],
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(calls.notified.length, 0);
  });

  it('la consulta sólo excluye créditos saldados, castigados o borrados', async () => {
    const { service, calls } = makeService({ installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }] });
    await service.scanAccount('acc-A', NOW);
    const w = calls.installmentWhere as { credit: Record<string, unknown> };
    assert.equal(w.credit.deletedAt, null);
    assert.equal(w.credit.writtenOffAt, null);
  });

  it('sin cuotas próximas → no hace nada', async () => {
    const { service } = makeService({ installments: [] });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
  });
});

describe('PromiseDueService.run', () => {
  it('barre los tenants enumerados', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 1, dueDate: soon(1) }],
      accountIds: ['acc-A', 'acc-B'],
    });
    const total = await service.run(NOW);
    assert.equal(total, 2); // un aviso por tenant
    assert.equal(calls.notified.length, 2);
  });

  it('resiliente: si la función de enumeración no existe, omite el job', async () => {
    const { service } = makeService({ throwEnumeration: true });
    assert.equal(await service.run(NOW), 0);
  });
});
