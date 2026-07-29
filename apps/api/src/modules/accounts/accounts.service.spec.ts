import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from './accounts.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function account(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-A',
    businessName: 'Cobranzas Pérez',
    taxId: '123456',
    accountType: 'INDEPENDENT',
    status: 'ACTIVE',
    planCode: 'STARTER',
    countryCode: 'BO',
    currencyCode: 'BOB',
    timezone: 'America/La_Paz',
    maxUsers: 5,
    deletedAt: null,
    ...over,
  };
}

function makeService(opts: { found?: Record<string, unknown> | null; members?: number } = {}) {
  const calls = {
    findWhere: undefined as Record<string, unknown> | undefined,
    updated: undefined as Record<string, unknown> | undefined,
    audit: [] as string[],
  };
  const tx = {
    account: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.findWhere = args.where;
        return opts.found === undefined ? account() : opts.found;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.updated = args.data;
        return account(args.data);
      },
    },
    userAccount: { count: async () => opts.members ?? 3 },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'u1' };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const service = new AccountsService(prisma as never, tenant as never, audit as never);
  return { service, calls };
}

describe('AccountsService.findMine', () => {
  it('acota por id además de la RLS, y trae los miembros activos', async () => {
    const { service, calls } = makeService({ members: 3 });
    const res = await service.findMine();
    assert.equal(calls.findWhere!.id, 'acc-A');
    assert.equal(calls.findWhere!.deletedAt, null);
    assert.equal(res.memberCount, 3);
    assert.equal(res.maxUsers, 5);
  });

  it('404 si el tenant no existe', async () => {
    const { service } = makeService({ found: null });
    await rejectsWithCode(service.findMine(), 'ACCOUNT_NOT_FOUND');
  });
});

describe('AccountsService.update', () => {
  it('escribe sólo los 5 campos configurables y audita', async () => {
    const { service, calls } = makeService();
    await service.update({ businessName: 'Nuevo Nombre', currencyCode: 'PEN' });
    assert.deepEqual(Object.keys(calls.updated!).sort(), [
      'businessName',
      'countryCode',
      'currencyCode',
      'taxId',
      'timezone',
    ]);
    assert.equal(calls.updated!.businessName, 'Nuevo Nombre');
    assert.deepEqual(calls.audit, ['UPDATE']);
  });

  it('nunca escribe plan, límite de usuarios, tipo ni estado', async () => {
    const { service, calls } = makeService();
    await service.update({ businessName: 'X' });
    for (const prohibido of ['planCode', 'maxUsers', 'accountType', 'status']) {
      assert.equal(prohibido in calls.updated!, false, `${prohibido} no se puede escribir desde el producto`);
    }
  });
});
