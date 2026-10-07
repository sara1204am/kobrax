import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgendaOverdueService } from './agenda-overdue.service';

// 2026-10-07 02:00 UTC = 06/10 22:00 en La Paz: para la empresa todavía es el 6.
const NOW = new Date('2026-10-07T02:00:00Z');

interface Opts {
  groups?: { assigneeId: string; _count: { _all: number } }[];
  active?: string[];
  already?: string[];
  accountIds?: string[];
  throwEnumeration?: boolean;
}

function makeService(opts: Opts = {}) {
  const calls = {
    notified: [] as { userId: string; data: Record<string, unknown> }[],
    groupWhere: undefined as Record<string, unknown> | undefined,
  };
  const tx = {
    account: { findFirst: async () => ({ timezone: 'America/La_Paz', countryCode: 'BO' }) },
    agendaItem: {
      groupBy: async (a: { where: Record<string, unknown> }) => {
        calls.groupWhere = a.where;
        return opts.groups ?? [];
      },
    },
    userAccount: {
      findMany: async () => (opts.active ?? (opts.groups ?? []).map((g) => g.assigneeId)).map((userId) => ({ userId })),
    },
    notification: {
      findFirst: async (a: { where: { userId: string } }) => (opts.already?.includes(a.where.userId) ? { id: 'previo' } : null),
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
    notifyUser: async (_accountId: string, userId: string, data: Record<string, unknown>) => void calls.notified.push({ userId, data }),
  };
  return { service: new AgendaOverdueService(prisma as never, notifications as never), calls };
}

const G = (assigneeId: string, n: number) => ({ assigneeId, _count: { _all: n } });

describe('AgendaOverdueService (F4/11 · resumen de vencidas)', () => {
  it('un aviso por responsable con cuántas tiene, de tipo AGENDA_OVERDUE', async () => {
    const { service, calls } = makeService({ groups: [G('u1', 3), G('u2', 1)] });
    assert.equal(await service.scanAccount('acc-A', NOW), 2);
    assert.deepEqual(calls.notified.map((n) => [n.userId, n.data.type]), [['u1', 'AGENDA_OVERDUE'], ['u2', 'AGENDA_OVERDUE']]);
    assert.match(String(calls.notified[0]!.data.body), /3 gestiones vencidas/);
    assert.match(String(calls.notified[1]!.data.body), /1 gestión vencida/);
  });

  it('«vencida» es antes del día civil de la EMPRESA: a las 22:00 en La Paz todavía es el 6', async () => {
    const { service, calls } = makeService({ groups: [G('u1', 1)] });
    await service.scanAccount('acc-A', NOW);
    const lt = (calls.groupWhere!.scheduledDate as { lt: Date }).lt;
    assert.equal(lt.toISOString().slice(0, 10), '2026-10-06');
    assert.equal(calls.groupWhere!.status, 'SCHEDULED');
    assert.equal(calls.groupWhere!.deletedAt, null);
  });

  it('no repite el aviso si ya salió uno dentro de la ventana', async () => {
    const { service, calls } = makeService({ groups: [G('u1', 2), G('u2', 2)], already: ['u1'] });
    assert.equal(await service.scanAccount('acc-A', NOW), 1);
    assert.deepEqual(calls.notified.map((n) => n.userId), ['u2']);
  });

  it('a alguien dado de baja no se le avisa', async () => {
    const { service, calls } = makeService({ groups: [G('u1', 2), G('u2', 2)], active: ['u2'] });
    await service.scanAccount('acc-A', NOW);
    assert.deepEqual(calls.notified.map((n) => n.userId), ['u2']);
  });

  it('sin vencidas no avisa a nadie', async () => {
    const { service, calls } = makeService({ groups: [] });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(calls.notified.length, 0);
  });

  it('recorre todos los tenants; si no se puede enumerar, se omite sin romper', async () => {
    assert.equal(await makeService({ groups: [G('u1', 1)], accountIds: ['a', 'b'] }).service.run(NOW), 2);
    assert.equal(await makeService({ throwEnumeration: true }).service.run(NOW), 0);
  });
});
