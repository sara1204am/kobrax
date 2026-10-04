import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreditsService } from './credits.service';

/**
 * F4/08 · fase 3 — «vincular a otro cliente» mueve TODO lo que lleva al cliente del crédito: actividades, agenda y
 * paradas de ruta por `credit_id` (y los casos, que viven hasta la fase 6).
 */
function make() {
  const writes: { table: string; where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const upd = (table: string) => async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    writes.push({ table, where: a.where, data: a.data });
    return { count: 1 };
  };
  const credit = { id: 'cr1', clientId: 'from', externalSource: null, metadata: {} };
  const clients: Record<string, unknown> = {
    from: { id: 'from', metadata: {}, linkReviewPending: false },
    to: { id: 'to', metadata: {} },
  };
  const tx = {
    credit: {
      findFirst: async () => credit,
      update: async () => credit,
      count: async () => 1,
    },
    client: { findFirst: async (a: { where: { id: string } }) => clients[a.where.id] ?? null },
    creditActivity: { updateMany: upd('credit_activities') },
    agendaItem: { updateMany: upd('agenda_items') },
    routeStop: { updateMany: upd('route_stops') },
    paymentRequest: { updateMany: upd('payment_requests') },
    collectionCase: { findMany: async () => [{ id: 'k1' }], updateMany: upd('collection_cases') },
    account: { findUnique: async () => ({ currencyCode: 'BOB', configuration: {}, settings: {} }) },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'u1', can: () => true };
  const audit = { record: async () => undefined, recordMany: async () => undefined };
  const service = new CreditsService(prisma as never, tenant as never, audit as never, {} as never, {} as never, {} as never);
  return { service, writes };
}

describe('CreditsService.linkClient — re-apunta lo que lleva al cliente', () => {
  it('actividades, agenda y paradas se mueven por credit_id al cliente elegido', async () => {
    const { service, writes } = make();
    await service.linkClient('cr1', 'to');
    for (const table of ['credit_activities', 'agenda_items', 'route_stops']) {
      const w = writes.find((x) => x.table === table && x.where.creditId === 'cr1');
      assert.ok(w, `${table} se re-apunta por credit_id`);
      assert.equal(w!.data.clientId, 'to');
    }
  });

  it('los casos (que viven hasta la fase 6) y los pedidos de cobro también se mueven', async () => {
    const { service, writes } = make();
    await service.linkClient('cr1', 'to');
    assert.ok(writes.some((w) => w.table === 'collection_cases' && w.data.clientId === 'to'));
    assert.ok(writes.some((w) => w.table === 'payment_requests' && w.data.clientId === 'to'));
  });

  it('mismo cliente: no mueve nada', async () => {
    const { service, writes } = make();
    await service.linkClient('cr1', 'from');
    assert.equal(writes.length, 0);
  });
});
