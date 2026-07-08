import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgendaService } from './agenda.service';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', caseId: 'ca1', clientId: 'cl1', creditId: 'cr1', assigneeId: 'u1',
    type: 'CALL', status: 'SCHEDULED', priorityCode: null, expectedResultCode: null,
    scheduledDate: new Date('2026-07-08'), timeMode: 'FIXED', scheduledTime: '09:00',
    timeSlot: null, observations: null, details: {}, resultActivityId: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function makeService(opts: { permissions?: string[]; rows?: unknown[]; clients?: unknown[] } = {}) {
  const calls = { listWhere: undefined as Record<string, unknown> | undefined };
  const tx = {
    agendaItem: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        calls.listWhere = args.where;
        return opts.rows ?? [];
      },
      count: async () => (opts.rows ?? []).length,
    },
    client: {
      findMany: async () => opts.clients ?? [],
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const perms = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'u1', permissions: perms, can: (p: string) => perms.includes(p) };
  const service = new AgendaService(prisma as never, tenant as never);
  return { service, calls };
}

describe('AgendaService.listByDay (scope + enriquecimiento)', () => {
  it('cobrador sin AGENDA_ASSIGN queda acotado a sus agendados', async () => {
    const { service, calls } = makeService({ rows: [] });
    await service.listByDay('2026-07-08');
    assert.equal(calls.listWhere!.assigneeId, 'u1');
    assert.ok((calls.listWhere!.scheduledDate as Date) instanceof Date);
  });

  it('con AGENDA_ASSIGN no fuerza el assigneeId', async () => {
    const { service, calls } = makeService({ permissions: ['agenda:assign'], rows: [] });
    await service.listByDay('2026-07-08');
    assert.equal(calls.listWhere!.assigneeId, undefined);
  });

  it('enriquece con el nombre del deudor (ref suave → lookup)', async () => {
    const { service } = makeService({
      rows: [row({ clientId: 'cl1' })],
      clients: [{ id: 'cl1', firstName: 'Ana', lastName: 'Ruiz', businessName: null }],
    });
    const res = await service.listByDay('2026-07-08');
    assert.equal(res.data![0]!.clientName, 'Ana Ruiz');
  });
});

describe('AgendaService.listOverdue', () => {
  it('filtra SCHEDULED con fecha < hoy, desc, y respeta el scope', async () => {
    const { service, calls } = makeService({ rows: [] });
    await service.listOverdue({ limit: 2 });
    assert.equal(calls.listWhere!.status, 'SCHEDULED');
    assert.ok((calls.listWhere!.scheduledDate as { lt: Date }).lt instanceof Date);
    assert.equal(calls.listWhere!.assigneeId, 'u1');
  });
});
