import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from './accounts.service';
import { rejectsWithCode } from '../auth/auth-test-utils';
import { AUTH_ERR } from '../auth/auth.errors';

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

/** Fakes del registro público (S4): además del `tx` necesita `role` fuera del contexto. */
function makeSignupService(opts: { role?: { id: string } | null; failWith?: unknown } = {}) {
  const calls = {
    tenantContext: undefined as string | undefined,
    account: undefined as Record<string, unknown> | undefined,
    user: undefined as Record<string, unknown> | undefined,
    membership: undefined as Record<string, unknown> | undefined,
    audit: undefined as Record<string, unknown> | undefined,
  };
  const tx = {
    account: {
      create: async (a: { data: Record<string, unknown> }) => {
        if (opts.failWith) throw opts.failWith;
        calls.account = a.data;
        return a.data;
      },
    },
    user: {
      create: async (a: { data: Record<string, unknown> }) => {
        calls.user = a.data;
        return { id: 'u-new', ...a.data };
      },
    },
    userAccount: {
      create: async (a: { data: Record<string, unknown> }) => void (calls.membership = a.data),
    },
    auditLog: {
      create: async (a: { data: Record<string, unknown> }) => void (calls.audit = a.data),
    },
  };
  const prisma = {
    role: { findUnique: async () => (opts.role === undefined ? { id: 'role-admin' } : opts.role) },
    withTenant: async (accountId: string, fn: (t: typeof tx) => Promise<unknown>) => {
      calls.tenantContext = accountId;
      return fn(tx);
    },
  };
  const service = new AccountsService(prisma as never, {} as never, {} as never);
  return { service, calls };
}

const SIGNUP = {
  businessName: 'Cobranzas Pérez',
  firstName: 'Sara',
  lastName: 'Pérez',
  email: 'Sara@Ejemplo.com',
  password: 'Kobrax123!',
};

describe('AccountsService.create (registro público · S4)', () => {
  it('crea cuenta, usuario, perfil, membresía de dueño y audit', async () => {
    const { service, calls } = makeSignupService();
    const res = await service.create(SIGNUP, { ip: '1.2.3.4', userAgent: 'expo' });

    assert.equal(calls.account!.businessName, 'Cobranzas Pérez');
    assert.equal(calls.account!.accountType, 'INDEPENDENT');
    assert.equal(calls.account!.status, 'TRIAL');
    assert.equal(calls.account!.maxUsers, 5);
    assert.deepEqual((calls.user!.profile as { create: unknown }).create, {
      firstName: 'Sara',
      lastName: 'Pérez',
    });
    assert.equal(calls.membership!.isOwner, true);
    assert.equal(calls.membership!.roleId, 'role-admin');
    assert.equal(calls.audit!.action, 'CREATE');
    assert.equal(calls.audit!.userId, 'u-new');
    assert.equal(calls.audit!.ip, '1.2.3.4');
    assert.equal(res.accountId, calls.account!.id);
  });

  it('el email se normaliza a minúsculas', async () => {
    const { service, calls } = makeSignupService();
    const res = await service.create(SIGNUP, {});
    assert.equal(calls.user!.email, 'sara@ejemplo.com');
    assert.equal(res.email, 'sara@ejemplo.com');
  });

  // S4-D2: la policy `tenant_self` exige `id = app_current_account()`. Si el contexto
  // no es el id de la cuenta nueva, PostgreSQL rechaza el INSERT y el registro muere.
  it('abre el contexto RLS con el mismo id que le pone a la cuenta', async () => {
    const { service, calls } = makeSignupService();
    await service.create(SIGNUP, {});
    assert.equal(calls.tenantContext, calls.account!.id);
    assert.equal(calls.membership!.accountId, calls.tenantContext);
    assert.equal(calls.audit!.accountId, calls.tenantContext);
  });

  // S4-D6: los defaults del schema (PENDING / true) romperían el login del recién registrado.
  it('el usuario nace ACTIVE y sin cambio de contraseña forzado', async () => {
    const { service, calls } = makeSignupService();
    await service.create(SIGNUP, {});
    assert.equal(calls.user!.status, 'ACTIVE');
    assert.equal(calls.user!.requiresPasswordChange, false);
  });

  it('la contraseña se guarda hasheada, nunca en claro', async () => {
    const { service, calls } = makeSignupService();
    await service.create(SIGNUP, {});
    assert.notEqual(calls.user!.passwordHash, SIGNUP.password);
    assert.match(calls.user!.passwordHash as string, /^\$2[aby]\$/);
  });

  it('email ya registrado → 409 (lo detecta el unique de la base, no un chequeo previo)', async () => {
    const { service } = makeSignupService({ failWith: { code: 'P2002' } });
    await rejectsWithCode(service.create(SIGNUP, {}), 'AUTH_EMAIL_TAKEN');
  });

  it('contraseña débil → 400, y no toca la base', async () => {
    const { service, calls } = makeSignupService();
    await rejectsWithCode(service.create({ ...SIGNUP, password: 'kobrax' }, {}), AUTH_ERR.WEAK_PASSWORD);
    assert.equal(calls.account, undefined);
  });

  it('sin el rol ACCOUNT_ADMIN seedeado no inventa una cuenta a medias', async () => {
    const { service, calls } = makeSignupService({ role: null });
    await rejectsWithCode(service.create(SIGNUP, {}), 'ROLE_CATALOG_MISSING');
    assert.equal(calls.account, undefined);
  });
});

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
