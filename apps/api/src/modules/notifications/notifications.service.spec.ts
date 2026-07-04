import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationsService } from './notifications.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

interface NotifRow {
  id: string;
  accountId: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  clientId: string | null;
  creditId: string | null;
  caseId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function makeService(opts: { supervisors?: string[]; notifications?: NotifRow[]; userId?: string } = {}) {
  const supervisors = opts.supervisors ?? ['sup1', 'sup2'];
  const store: NotifRow[] = opts.notifications ?? [];
  const calls = {
    created: [] as NotifRow[],
    wsToUser: [] as { userId: string; event: string }[],
    wsToTenant: [] as string[],
    wsToSupervisors: [] as string[],
    channelDeliveries: 0,
    updateMany: [] as { where: Record<string, unknown> }[],
  };
  let seq = 0;

  const tx = {
    notification: {
      create: async (args: { data: Record<string, unknown> }) => {
        const row: NotifRow = {
          id: `n${(seq += 1)}`,
          accountId: args.data.accountId as string,
          userId: args.data.userId as string,
          type: args.data.type as string,
          title: args.data.title as string,
          body: (args.data.body as string) ?? null,
          clientId: (args.data.clientId as string) ?? null,
          creditId: (args.data.creditId as string) ?? null,
          caseId: (args.data.caseId as string) ?? null,
          readAt: null,
          createdAt: new Date('2026-06-18T12:00:00Z'),
        };
        store.push(row);
        calls.created.push(row);
        return row;
      },
      findMany: async (args: { where: { userId: string; readAt?: null } }) =>
        store
          .filter((n) => n.userId === args.where.userId && (args.where.readAt === null ? n.readAt === null : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      count: async (args: { where: { userId: string; readAt?: null } }) =>
        store.filter((n) => n.userId === args.where.userId && (args.where.readAt === null ? n.readAt === null : true)).length,
      updateMany: async (args: { where: { id?: string; userId: string; readAt?: null } }) => {
        calls.updateMany.push(args);
        const matched = store.filter(
          (n) =>
            (args.where.id ? n.id === args.where.id : true) &&
            n.userId === args.where.userId &&
            (args.where.readAt === null ? n.readAt === null : true),
        );
        matched.forEach((n) => (n.readAt = new Date()));
        return { count: matched.length };
      },
      findFirst: async (args: { where: { id?: string; userId: string } }) =>
        store.find((n) => (args.where.id ? n.id === args.where.id : true) && n.userId === args.where.userId) ?? null,
    },
    userAccount: {
      findMany: async () => supervisors.map((userId) => ({ userId })),
    },
  };

  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: opts.userId ?? 'me' };
  const events = { on: () => {}, emit: () => {} };
  const gateway = {
    emitToTenant: (_a: string) => calls.wsToTenant.push(_a),
    emitToSupervisors: (_a: string) => calls.wsToSupervisors.push(_a),
    emitToUser: (userId: string, event: string) => calls.wsToUser.push({ userId, event }),
  };
  const channels = [{ name: 'push', deliver: async () => void (calls.channelDeliveries += 1) }];

  const service = new NotificationsService(
    prisma as never,
    tenant as never,
    events as never,
    gateway as never,
    channels as never,
  );
  return { service, calls, store };
}

describe('NotificationsService · traductor de eventos', () => {
  it('case.assigned → notifica DIRECTO al cobrador + feed en vivo del tenant', async () => {
    const { service, calls } = makeService();
    await service.onCaseAssigned({ caseId: 'c1', collectorId: 'col1', accountId: 'acc-A' });
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0]!.userId, 'col1');
    assert.equal(calls.created[0]!.type, 'CASE_ASSIGNED');
    assert.deepEqual(calls.wsToTenant, ['acc-A']);
    assert.equal(calls.wsToUser[0]!.userId, 'col1');
    assert.equal(calls.channelDeliveries, 1);
  });

  it('case.updated con cambio de estado → persiste a TODOS los supervisores', async () => {
    const { service, calls } = makeService({ supervisors: ['sup1', 'sup2'] });
    await service.onCaseUpdated({ caseId: 'c1', accountId: 'acc-A', status: 'IN_PROGRESS' });
    assert.equal(calls.created.length, 2);
    assert.deepEqual(calls.created.map((n) => n.userId).sort(), ['sup1', 'sup2']);
    assert.deepEqual(calls.wsToSupervisors, ['acc-A']);
  });

  it('case.updated de bitácora (sin estado) → solo live, NO persiste', async () => {
    const { service, calls } = makeService();
    await service.onCaseUpdated({ caseId: 'c1', accountId: 'acc-A', activity: 'CALL' });
    assert.equal(calls.created.length, 0);
    assert.deepEqual(calls.wsToSupervisors, ['acc-A']);
  });

  it('payment.registered → persiste a supervisores con tipo PAYMENT_REGISTERED', async () => {
    const { service, calls } = makeService({ supervisors: ['sup1'] });
    await service.onPaymentRegistered({ paymentId: 'p1', creditId: 'cr1', amount: 250, accountId: 'acc-A' });
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0]!.type, 'PAYMENT_REGISTERED');
    assert.equal(calls.created[0]!.creditId, 'cr1');
  });
});

describe('NotificationsService · REST (scope own)', () => {
  const rows = (userId: string, n: number, read = false): NotifRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${userId}-${i}`,
      accountId: 'acc-A',
      userId,
      type: 'SYSTEM',
      title: `t${i}`,
      body: null,
      clientId: null,
      creditId: null,
      caseId: null,
      readAt: read ? new Date() : null,
      createdAt: new Date(`2026-06-1${i}T00:00:00Z`),
    }));

  it('list solo devuelve las notificaciones del usuario actual', async () => {
    const store = [...rows('me', 2), ...rows('otro', 3)];
    const { service } = makeService({ notifications: store, userId: 'me' });
    const res = await service.list({});
    assert.equal(res.meta.total, 2);
    assert.ok(res.data!.every((n) => n.id.startsWith('me-')));
  });

  it('list ?unread=true filtra las leídas', async () => {
    const store = [...rows('me', 1, false), ...rows('me', 0)];
    store.push({ ...rows('me', 1, true)[0]!, id: 'me-leida' });
    const { service } = makeService({ notifications: store, userId: 'me' });
    const res = await service.list({ unread: true });
    assert.equal(res.meta.total, 1);
  });

  it('markRead marca la propia y es idempotente', async () => {
    const store = rows('me', 1);
    const { service } = makeService({ notifications: store, userId: 'me' });
    await service.markRead('me-0');
    assert.ok(store[0]!.readAt !== null);
    await service.markRead('me-0'); // idempotente: ya leída, no lanza
  });

  it('markRead de una notificación ajena/inexistente → 404', async () => {
    const { service } = makeService({ notifications: rows('otro', 1), userId: 'me' });
    await rejectsWithCode(service.markRead('otro-0'), 'RESOURCE_NOT_FOUND');
  });

  it('markAllRead marca todas las no leídas del usuario', async () => {
    const store = rows('me', 3);
    const { service } = makeService({ notifications: store, userId: 'me' });
    await service.markAllRead();
    assert.ok(store.every((n) => n.readAt !== null));
  });
});
