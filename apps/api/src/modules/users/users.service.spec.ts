import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UsersService } from './users.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

const SELF = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ROLE_ADMIN = 'role-admin';
const ROLE_COLLECTOR = 'role-collector';
const ROLE_MANAGER = 'role-manager';

const ROLES: Record<string, { id: string; name: string; level: number }> = {
  [ROLE_ADMIN]: { id: ROLE_ADMIN, name: 'ACCOUNT_ADMIN', level: 90 },
  [ROLE_COLLECTOR]: { id: ROLE_COLLECTOR, name: 'COLLECTOR', level: 30 },
  [ROLE_MANAGER]: { id: ROLE_MANAGER, name: 'MANAGER', level: 70 },
};

function member(over: Record<string, unknown> = {}) {
  return {
    id: 'ua1',
    userId: OTHER,
    roleId: ROLE_COLLECTOR,
    isOwner: false,
    isActive: true,
    joinedAt: new Date('2026-01-01'),
    role: ROLES[ROLE_COLLECTOR],
    user: {
      id: OTHER,
      email: 'cobrador@kobrax.demo',
      status: 'ACTIVE',
      lastLoginAt: null,
      profile: { firstName: 'Juan', lastName: 'Pérez', phone: '77712345', photoUrl: null },
    },
    ...over,
  };
}

interface Opts {
  /** Miembro que resuelve el scope de `updateMember` (`null` → 404). */
  found?: Record<string, unknown> | null;
  /** Otros ACCOUNT_ADMIN activos que quedan en el tenant. */
  otherAdmins?: number;
  roles?: { id: string; name: string; level: number }[];
}

function makeService(opts: Opts = {}) {
  const calls = {
    listArgs: undefined as Record<string, unknown> | undefined,
    updated: undefined as Record<string, unknown> | undefined,
    countWhere: undefined as Record<string, unknown> | undefined,
    rolesWhere: undefined as Record<string, unknown> | undefined,
    audit: [] as string[],
  };
  const tx = {
    userAccount: {
      findMany: async (args: Record<string, unknown>) => {
        calls.listArgs = args;
        return [member()];
      },
      findFirst: async () => (opts.found === undefined ? member() : opts.found),
      count: async (args: { where?: Record<string, unknown> }) => {
        calls.countWhere = args.where;
        return opts.otherAdmins ?? 1;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.updated = args.data;
        return member({ ...args.data, role: ROLES[(args.data.roleId as string) ?? ROLE_COLLECTOR] });
      },
    },
    role: {
      findUnique: async (args: { where: { id: string } }) => ROLES[args.where.id] ?? null,
      findMany: async (args: { where?: Record<string, unknown> }) => {
        calls.rolesWhere = args.where;
        return opts.roles ?? [ROLES[ROLE_ADMIN], ROLES[ROLE_COLLECTOR]];
      },
    },
    // 🔴 La trampa del slice: `users` es una tabla GLOBAL sin RLS. Listar miembros
    // desde acá devolvería los usuarios de todos los tenants.
    user: {
      findMany: async () => {
        throw new Error('users es global: la lista de miembros DEBE partir de user_accounts');
      },
      findUnique: async () => ({ id: SELF, email: 'yo@kobrax.demo', profile: { firstName: 'Ana' } }),
    },
    profile: {
      findUnique: async () => ({ id: 'p1', userId: SELF, firstName: 'Ana', lastName: 'Gómez' }),
      update: async () => ({ id: 'p1', userId: SELF }),
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: SELF };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const service = new UsersService(prisma as never, tenant as never, audit as never);
  return { service, calls };
}

describe('UsersService.list — aislamiento por tenant', () => {
  it('parte de user_accounts (con RLS), nunca de la tabla global users', async () => {
    const { service, calls } = makeService();
    const rows = await service.list();
    // Si el service tocara `tx.user.findMany`, el fake lanza y este test falla.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, OTHER);
    // El nombre del rol viaja crudo; la etiqueta la pone el cliente con ROLE_LABEL.
    assert.equal(rows[0]!.roleName, 'COLLECTOR');
  });

  it('no filtra por accountId a mano: el scope lo pone la RLS', async () => {
    const { service, calls } = makeService();
    await service.list();
    assert.equal(calls.listArgs!.where, undefined);
  });

  it('devuelve también a los desactivados (para poder reactivarlos)', async () => {
    const { service, calls } = makeService();
    await service.list();
    assert.equal((calls.listArgs!.where as Record<string, unknown> | undefined)?.isActive, undefined);
  });
});

describe('UsersService.updateMember — guardas', () => {
  it('rechaza editarse a uno mismo', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.updateMember(SELF, { isActive: false }), 'USER_CANNOT_EDIT_SELF');
  });

  it('rechaza dejar la cuenta sin ningún administrador activo', async () => {
    const { service } = makeService({
      found: member({ roleId: ROLE_ADMIN, role: ROLES[ROLE_ADMIN] }),
      otherAdmins: 0,
    });
    await rejectsWithCode(service.updateMember(OTHER, { isActive: false }), 'USER_LAST_ADMIN');
  });

  it('deja desactivar a un admin si queda otro activo', async () => {
    const { service, calls } = makeService({
      found: member({ roleId: ROLE_ADMIN, role: ROLES[ROLE_ADMIN] }),
      otherAdmins: 1,
    });
    await service.updateMember(OTHER, { isActive: false });
    assert.equal(calls.updated!.isActive, false);
    assert.deepEqual(calls.audit, ['UPDATE']);
    // El conteo excluye al propio usuario que se está editando.
    assert.deepEqual(calls.countWhere!.userId, { not: OTHER });
  });

  it('rechaza un rol que el móvil no administra (MANAGER es de la web)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.updateMember(OTHER, { roleId: ROLE_MANAGER }), 'USER_ROLE_NOT_ALLOWED');
  });

  it('acepta un rol de MOBILE_ROLES y audita', async () => {
    const { service, calls } = makeService();
    const res = await service.updateMember(OTHER, { roleId: ROLE_ADMIN });
    assert.equal(calls.updated!.roleId, ROLE_ADMIN);
    assert.equal(res.roleName, 'ACCOUNT_ADMIN');
    assert.deepEqual(calls.audit, ['UPDATE']);
  });

  it('404 si el miembro no está en este tenant', async () => {
    const { service } = makeService({ found: null });
    await rejectsWithCode(service.updateMember(OTHER, { isActive: false }), 'USER_NOT_FOUND');
  });
});

describe('UsersService.listRoles', () => {
  it('sólo ofrece los 3 roles del móvil, de mayor a menor nivel', async () => {
    const { service, calls } = makeService();
    const roles = await service.listRoles();
    assert.deepEqual(calls.rolesWhere!.name, {
      in: ['ACCOUNT_ADMIN', 'SUPERVISOR', 'COLLECTOR'],
    });
    assert.equal(roles[0]!.name, 'ACCOUNT_ADMIN');
  });
});
