import { describe, it } from 'node:test';
import { fakePolicy } from '../../common/authz/testing';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { fakePlanLimits } from '../../common/plan/plan-test-utils';
import { ClientsService } from './clients.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

/** D-7 (F13): las lecturas de Clientes se acotan por oficina con la regla de Mora. */
function makeService(permissions: string[], visibleIds: string[]) {
  const sql: { sql: string; values: unknown[] }[] = [];
  const findManyWhere: Record<string, unknown>[] = [];
  const row = (id: string) => ({ id, clientType: 'PERSON', firstName: 'Ana', createdAt: new Date(), updatedAt: new Date() });
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      sql.push(q);
      if (q.sql.includes('COUNT(*)')) return [{ total: visibleIds.length }];
      if (q.sql.includes('SELECT 1 AS ok')) return q.values.some((v) => visibleIds.includes(String(v))) ? [{ ok: 1 }] : [];
      if (q.sql.includes('FROM clients c')) return visibleIds.map((id) => ({ id, total_debt: 0, max_days_past_due: 0, credit_count: 0, total_debt_external: 0, max_days_past_due_external: 0 }));
      return visibleIds.map((id) => ({ id }));
    },
    client: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        findManyWhere.push(args.where);
        return visibleIds.map(row);
      },
      count: async () => visibleIds.length,
      findFirst: async (args: { where: { id?: string } }) => (args.where.id ? row(args.where.id) : null),
    },
    clientIncomeProfile: { findFirst: async () => null },
    // F14 · F2: `otherCredits` mira los créditos del cliente; acá no hay ninguno que esconder.
    credit: { findMany: async () => [] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx), elevated: async (_tx: unknown, fn: () => Promise<unknown>) => fn() };
  const tenant = { accountId: 'acc-A', userId: 'u1', can: (p: string) => permissions.includes(p) };
  const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
  const service = new ClientsService(
    prisma as never,
    tenant as never,
    crypto as never,
    { hash: () => null } as never,
    { record: async () => undefined } as never,
    fakePlanLimits(),
    undefined,
    fakePolicy().service,
  );
  return { service, sql, findManyWhere };
}

const ALL = [Permission.DATA_SCOPE_ALL];
const SCOPED: [string, string[]][] = [
  ['SUBTREE', [Permission.DATA_SCOPE_SUBTREE]],
  ['BRANCH', [Permission.DATA_SCOPE_BRANCH]],
  ['OWN', []],
];

describe('Clientes · alcance por oficina (D-7)', () => {
  it('ALL: list no filtra por ids visibles y no consulta visibilidad', async () => {
    const { service, sql, findManyWhere } = makeService(ALL, ['c1']);
    await service.list({} as never);
    assert.equal(findManyWhere[0]!.id, undefined);
    assert.equal(sql.length, 0);
  });

  it('ALL: findOne no hace consulta de visibilidad', async () => {
    const { service, sql } = makeService(ALL, []);
    await service.findOne('c9', false);
    assert.equal(sql.length, 0);
  });

  for (const [kind, perms] of SCOPED) {
    describe(kind, () => {
      it('list acota por los ids visibles', async () => {
        const { service, findManyWhere } = makeService(perms, ['c1', 'c2']);
        const res = await service.list({} as never);
        assert.deepEqual(findManyWhere[0]!.id, { in: ['c1', 'c2'] });
        assert.equal(res.meta?.total, 2);
      });

      it('cartera agrega id IN (visibles) a la página y al total', async () => {
        const { service, sql } = makeService(perms, ['c1']);
        await service.list({ view: 'portfolio' } as never);
        const portfolio = sql.filter((q) => q.sql.includes('FROM clients c'));
        assert.equal(portfolio.length, 2);
        for (const q of portfolio) assert.match(q.sql, /c\.id IN \(SELECT cr\.client_id FROM credits cr/);
      });

      it('findOne de un cliente fuera de alcance responde 404', async () => {
        const { service } = makeService(perms, ['c1']);
        await rejectsWithCode(service.findOne('fuera', false), 'RESOURCE_NOT_FOUND');
        await service.findOne('c1', false);
      });

      it('pdfBundle, getIncomeProfile y addContact fuera de alcance responden 404', async () => {
        const { service } = makeService(perms, ['c1']);
        await rejectsWithCode(service.pdfBundle('fuera'), 'RESOURCE_NOT_FOUND');
        await rejectsWithCode(service.getIncomeProfile('fuera'), 'RESOURCE_NOT_FOUND');
        await rejectsWithCode(service.addContact('fuera', { contactType: 'PHONE', value: '7' } as never), 'RESOURCE_NOT_FOUND');
      });

      it('timeline fuera de alcance responde 404', async () => {
        const { service } = makeService([...perms, Permission.PAYMENT_READ], ['c1']);
        await rejectsWithCode(service.timeline('fuera', {} as never), 'RESOURCE_NOT_FOUND');
      });
    });
  }
});

describe('findOne — otherCredits es opt-in (F14 · F2)', () => {
  it('sin pedirlo (PDF y otros llamadores internos) no consulta ni devuelve otherCredits', async () => {
    const { service, sql } = makeService([Permission.DATA_SCOPE_BRANCH], ['c1']);
    const r = await service.findOne('c1', false);
    assert.equal('otherCredits' in r, false);
  });

  it('pedido por la ficha lo trae (null si el actor ve todos los créditos)', async () => {
    const { service } = makeService([Permission.DATA_SCOPE_BRANCH], ['c1']);
    const r = await service.findOne('c1', false, true);
    assert.equal('otherCredits' in r, true);
  });
});
