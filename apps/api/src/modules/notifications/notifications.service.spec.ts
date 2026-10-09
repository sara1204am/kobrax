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
          agendaItemId: (args.data.agendaItemId as string) ?? null,
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

describe('NotificationsService · avisos de agenda (F4/11)', () => {
  const payload = (over: Record<string, unknown> = {}) =>
    ({
      accountId: 'acc-A',
      itemId: 'item-1',
      creditId: 'cr1',
      clientId: 'cl1',
      recipientId: 'cobrador-1',
      actorId: 'sup-1',
      actorName: 'Sandra Soria',
      clientName: 'Ana Ruiz',
      itemType: 'VISIT',
      scheduledDate: '2026-10-10',
      kind: 'ASSIGNED',
      ...over,
    }) as never;

  it('una gestión asignada avisa al responsable, dice quién la asignó, qué y cuándo, y enlaza a la gestión', async () => {
    const { service, calls } = makeService();
    await service.onAgendaAssigned(payload());
    const n = calls.created[0]!;
    assert.equal(n.userId, 'cobrador-1');
    assert.equal(n.type, 'AGENDA_ASSIGNED');
    assert.equal(n.body, 'Sandra Soria te asignó una visita con Ana Ruiz para el 10/10.');
    assert.equal(n.agendaItemId, 'item-1');
    assert.equal(n.creditId, 'cr1');
  });

  it('un cambio avisa con el verbo correcto según lo que se hizo', async () => {
    const { service, calls } = makeService();
    for (const kind of ['RESCHEDULED', 'CANCELLED', 'UPDATED']) await service.onAgendaChanged(payload({ kind }));
    assert.deepEqual(calls.created.map((n) => n.title), ['Gestión reagendada', 'Gestión cancelada', 'Gestión modificada']);
    assert.match(String(calls.created[0]!.body), /reagendó una visita/);
    assert.match(String(calls.created[1]!.body), /canceló una visita/);
    assert.ok(calls.created.every((n) => n.type === 'AGENDA_CHANGED' && n.agendaItemId === 'item-1'));
  });

  it('una gestión eliminada avisa pero NO enlaza: la gestión ya no existe y el enlace daría 404', async () => {
    const { service, calls } = makeService();
    await service.onAgendaChanged(payload({ kind: 'DELETED' }));
    assert.equal(calls.created[0]!.title, 'Gestión eliminada');
    assert.equal(calls.created[0]!.agendaItemId, null);
  });

  it('sin nombre de quien lo hizo no inventa uno', async () => {
    const { service, calls } = makeService();
    await service.onAgendaAssigned(payload({ actorName: undefined, clientName: undefined }));
    assert.equal(calls.created[0]!.body, 'Alguien te asignó una visita para el 10/10.');
  });
});
