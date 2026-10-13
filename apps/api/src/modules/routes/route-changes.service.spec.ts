import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { RouteChangesService } from './route-changes.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

interface Req {
  id: string;
  routeId: string;
  requestedBy: string;
  kind: string;
  payload: Record<string, unknown>;
  reason: string;
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

function makeService(opts: {
  userId?: string;
  /** Qué es quien pide respecto de la ruta (lo resuelve `RoutesService.contextOf`). */
  canManage?: boolean;
  routeStatus?: string;
  createdBy?: string | null;
  requests?: Req[];
  /** Falla al aplicar el cambio (ej. la parada ya se gestionó). */
  applyFails?: boolean;
  stops?: Record<string, { status: string }>;
}) {
  const requests: Req[] = (opts.requests ?? []).map((r) => ({ ...r }));
  const calls = { applied: [] as string[], events: [] as Record<string, unknown>[], audit: [] as string[] };
  const tx = {
    routeStop: { findFirst: async (a: { where: { id: string } }) => opts.stops?.[a.where.id] ?? null },
    routeChangeRequest: {
      create: async (a: { data: Partial<Req> }) => {
        const r: Req = { id: 'q-new', status: 'PENDING', decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date('2026-10-08T10:00:00Z'), payload: {}, ...a.data } as Req;
        requests.push(r);
        return r;
      },
      findMany: async (a: { where: { routeId: string; requestedBy?: string } }) =>
        requests.filter((r) => r.routeId === a.where.routeId && (!a.where.requestedBy || r.requestedBy === a.where.requestedBy)),
      findFirst: async (a: { where: { id: string } }) => requests.find((r) => r.id === a.where.id) ?? null,
      findFirstOrThrow: async (a: { where: { id: string } }) => requests.find((r) => r.id === a.where.id)!,
      updateMany: async (a: { where: { id: string; status?: string }; data: Partial<Req> }) => {
        const r = requests.find((x) => x.id === a.where.id);
        if (!r || (a.where.status && r.status !== a.where.status)) return { count: 0 };
        Object.assign(r, a.data);
        return { count: 1 };
      },
    },
    profile: { findMany: async () => [{ userId: 'u-pide', firstName: 'Rosa', lastName: 'Aliaga' }] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: opts.userId ?? 'u1' };
  const audit = { record: async (e: { entity: string; action: string }) => void calls.audit.push(`${e.entity}:${e.action}`) };
  const events = { emit: (_n: string, p: Record<string, unknown>) => void calls.events.push(p) };
  const routes = {
    contextOf: async () => ({
      route: { id: 'r1', collectorId: 'u-cobrador', createdBy: opts.createdBy === undefined ? 'u-manager' : opts.createdBy, status: opts.routeStatus ?? 'PLANNED', plannedDate: new Date('2026-10-09') },
      roles: { canManage: opts.canManage ?? false },
    }),
    addStop: async () => { if (opts.applyFails) throw new BadRequestException({ code: 'X', message: 'ya está' }); calls.applied.push('addStop'); },
    removeStop: async () => { if (opts.applyFails) throw new BadRequestException({ code: 'X', message: 'La parada ya fue gestionada' }); calls.applied.push('removeStop'); },
    updateStop: async () => void calls.applied.push('updateStop'),
    updateStatus: async () => void calls.applied.push('updateStatus'),
  };
  const service = new RouteChangesService(prisma as never, tenant as never, audit as never, events as never, routes as never);
  return { service, requests, calls };
}

const PENDING: Req = {
  id: 'q1', routeId: 'r1', requestedBy: 'u-pide', kind: 'REMOVE_STOP', payload: { stopId: 's1' }, reason: 'El cliente se mudó',
  status: 'PENDING', decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date('2026-10-08T09:00:00Z'),
};

describe('RouteChangesService.create · pedir un cambio (F4/12)', () => {
  it('quien no armó la ruta pide el cambio con su motivo, y se le avisa a quien la armó', async () => {
    const { service, requests, calls } = makeService({ userId: 'u-pide', stops: { s1: { status: 'PENDING' } } });
    const r = await service.create('r1', { kind: 'REMOVE_STOP', payload: { stopId: 's1' }, reason: 'El cliente se mudó' } as never);
    assert.equal(r.status, 'PENDING');
    assert.equal(requests[0]!.requestedBy, 'u-pide');
    assert.equal(r.requestedByName, 'Rosa Aliaga');
    assert.equal(calls.events[0]!.kind, 'CHANGE_REQUESTED');
    assert.equal(calls.events[0]!.recipientId, 'u-manager');
    assert.ok(calls.audit.includes('route_change_request:CREATE'));
  });

  it('con id del teléfono: reintentar devuelve el mismo pedido, sin duplicar ni avisar de nuevo', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { service, requests, calls } = makeService({ userId: 'u-pide', stops: { s1: { status: 'PENDING' } } });
    const first = await service.create('r1', { id, kind: 'REMOVE_STOP', payload: { stopId: 's1' }, reason: 'El cliente se mudó' } as never);
    const again = await service.create('r1', { id, kind: 'REMOVE_STOP', payload: { stopId: 's1' }, reason: 'El cliente se mudó' } as never);
    assert.equal(first.id, id);
    assert.equal(again.id, id);
    assert.equal(requests.length, 1);
    assert.equal(calls.events.length, 1);
    assert.equal(calls.audit.filter((a) => a === 'route_change_request:CREATE').length, 1);
  });

  it('el id de un pedido ajeno se rechaza (ROUTE_REQUEST_ID) y no revela el contenido', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const { service } = makeService({ userId: 'u-pide', requests: [{ ...PENDING, id, requestedBy: 'otra-persona' }] });
    await rejectsWithCode(service.create('r1', { id, kind: 'CANCEL', reason: 'Cambio de zona' } as never), 'ROUTE_REQUEST_ID');
  });

  it('quien manda sobre la ruta no pide permiso: lo hace directo (ROUTE_REQUEST_NOT_NEEDED)', async () => {
    const { service, requests } = makeService({ canManage: true });
    await rejectsWithCode(service.create('r1', { kind: 'CANCEL', reason: 'Cambio de zona' } as never), 'ROUTE_REQUEST_NOT_NEEDED');
    assert.equal(requests.length, 0);
  });

  it('el motivo es obligatorio (ROUTE_REASON_REQUIRED)', async () => {
    const { service } = makeService({});
    await rejectsWithCode(service.create('r1', { kind: 'CANCEL', reason: '  .  ' } as never), 'ROUTE_REASON_REQUIRED');
  });

  it('una ruta cerrada ya no admite pedidos (ROUTE_CLOSED)', async () => {
    const { service } = makeService({ routeStatus: 'COMPLETED' });
    await rejectsWithCode(service.create('r1', { kind: 'CANCEL', reason: 'Ya no hace falta' } as never), 'ROUTE_CLOSED');
  });

  it('lo pedido tiene que referirse a algo real de ESTA ruta', async () => {
    const { service } = makeService({ stops: {} });
    await rejectsWithCode(service.create('r1', { kind: 'REMOVE_STOP', payload: { stopId: 'fantasma' }, reason: 'Para probar' } as never), 'RESOURCE_NOT_FOUND');
    await rejectsWithCode(service.create('r1', { kind: 'ADD_STOP', payload: {}, reason: 'Falta el cliente' } as never), 'ROUTE_REQUEST_PAYLOAD');
    const ok = makeService({ stops: { s1: { status: 'PENDING' } } });
    await rejectsWithCode(ok.service.create('r1', { kind: 'REORDER', payload: { stopId: 's1' }, reason: 'Falta la posición' } as never), 'ROUTE_REQUEST_PAYLOAD');
  });

  it('una ruta anterior a F4/12 (sin creador) no avisa a nadie: no hay quién apruebe', async () => {
    const { service, calls } = makeService({ createdBy: null, stops: { s1: { status: 'PENDING' } } });
    await service.create('r1', { kind: 'REMOVE_STOP', payload: { stopId: 's1' }, reason: 'Quitar esta parada' } as never);
    assert.equal(calls.events.length, 0);
  });
});

describe('RouteChangesService.list', () => {
  it('quien manda ve todos los pedidos; quien pide, solo los suyos', async () => {
    const reqs = [PENDING, { ...PENDING, id: 'q2', requestedBy: 'otro' }];
    const owner = makeService({ canManage: true, requests: reqs });
    assert.equal((await owner.service.list('r1')).length, 2);
    const asker = makeService({ userId: 'u-pide', requests: reqs });
    assert.deepEqual((await asker.service.list('r1')).map((r) => r.id), ['q1']);
  });

  it('los sin resolver van primero', async () => {
    const { service } = makeService({ canManage: true, requests: [{ ...PENDING, id: 'q-viejo', status: 'REJECTED' }, PENDING] });
    assert.equal((await service.list('r1'))[0]!.status, 'PENDING');
  });
});

describe('RouteChangesService.decide · aprobar, rechazar, retirar', () => {
  it('🔴 solo quien manda sobre la ruta resuelve (ROUTE_REQUEST_FORBIDDEN)', async () => {
    const { service, calls } = makeService({ userId: 'u-otro', canManage: false, requests: [PENDING] });
    await rejectsWithCode(service.decide('r1', 'q1', { decision: 'APPROVE' } as never), 'ROUTE_REQUEST_FORBIDDEN');
    await rejectsWithCode(service.decide('r1', 'q1', { decision: 'REJECT' } as never), 'ROUTE_REQUEST_FORBIDDEN');
    assert.equal(calls.applied.length, 0);
  });

  it('aprobar APLICA el cambio con las reglas de siempre, marca quién lo aprobó y avisa a quien lo pidió', async () => {
    const { service, requests, calls } = makeService({ canManage: true, requests: [PENDING] });
    const r = await service.decide('r1', 'q1', { decision: 'APPROVE', note: 'Dale' } as never);
    assert.equal(r.status, 'APPROVED');
    assert.deepEqual(calls.applied, ['removeStop']);
    assert.equal(requests[0]!.decidedBy, 'u1');
    assert.equal(calls.events[0]!.kind, 'CHANGE_APPROVED');
    assert.equal(calls.events[0]!.recipientId, 'u-pide');
  });

  it('cada tipo aplica lo suyo: agregar, mover y cancelar', async () => {
    const mk = (kind: string, payload: Record<string, unknown>) => ({ ...PENDING, kind, payload });
    const add = makeService({ canManage: true, requests: [mk('ADD_STOP', { clientId: 'c1', locationId: 'l1' })] });
    await add.service.decide('r1', 'q1', { decision: 'APPROVE' } as never);
    const move = makeService({ canManage: true, requests: [mk('REORDER', { stopId: 's1', sequenceOrder: 3 })] });
    await move.service.decide('r1', 'q1', { decision: 'APPROVE' } as never);
    const cancel = makeService({ canManage: true, requests: [mk('CANCEL', {})] });
    await cancel.service.decide('r1', 'q1', { decision: 'APPROVE' } as never);
    assert.deepEqual([add.calls.applied[0], move.calls.applied[0], cancel.calls.applied[0]], ['addStop', 'updateStop', 'updateStatus']);
  });

  it('🔴 si ya no se puede aplicar, el pedido vuelve a quedar sin resolver y se explica por qué', async () => {
    const { service, requests } = makeService({ canManage: true, requests: [PENDING], applyFails: true });
    await rejectsWithCode(service.decide('r1', 'q1', { decision: 'APPROVE' } as never), 'ROUTE_REQUEST_STALE');
    assert.equal(requests[0]!.status, 'PENDING');
    assert.equal(requests[0]!.decidedBy, null);
  });

  it('rechazar no aplica nada y avisa con la nota', async () => {
    const { service, calls } = makeService({ canManage: true, requests: [PENDING] });
    const r = await service.decide('r1', 'q1', { decision: 'REJECT', note: 'Esa parada se queda' } as never);
    assert.equal(r.status, 'REJECTED');
    assert.equal(calls.applied.length, 0);
    assert.equal(calls.events[0]!.kind, 'CHANGE_REJECTED');
    assert.equal(calls.events[0]!.reason, 'Esa parada se queda');
  });

  it('quien lo pidió puede retirarlo; otra persona no', async () => {
    const mine = makeService({ userId: 'u-pide', requests: [PENDING] });
    assert.equal((await mine.service.decide('r1', 'q1', { decision: 'WITHDRAW' } as never)).status, 'WITHDRAWN');
    const other = makeService({ userId: 'u-otro', requests: [PENDING] });
    await rejectsWithCode(other.service.decide('r1', 'q1', { decision: 'WITHDRAW' } as never), 'ROUTE_REQUEST_FORBIDDEN');
  });

  it('un pedido ya resuelto no se resuelve dos veces (ROUTE_REQUEST_RESOLVED); uno inexistente da 404', async () => {
    const done = makeService({ canManage: true, requests: [{ ...PENDING, status: 'APPROVED' }] });
    await rejectsWithCode(done.service.decide('r1', 'q1', { decision: 'REJECT' } as never), 'ROUTE_REQUEST_RESOLVED');
    const none = makeService({ canManage: true });
    await rejectsWithCode(none.service.decide('r1', 'q-x', { decision: 'APPROVE' } as never), 'ROUTE_REQUEST_NOT_FOUND');
  });
});
