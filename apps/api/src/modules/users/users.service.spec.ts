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
  /** Miembros activos que ya ocupan asiento (para el techo de `maxUsers`). */
  seats?: number;
  maxUsers?: number;
  /** Simula el choque del @unique de `users.email`. */
  emailTaken?: boolean;
}

function makeService(opts: Opts = {}) {
  const calls = {
    listArgs: undefined as Record<string, unknown> | undefined,
    updated: undefined as Record<string, unknown> | undefined,
    countWhere: undefined as Record<string, unknown> | undefined,
    rolesWhere: undefined as Record<string, unknown> | undefined,
    audit: [] as string[],
    userCreated: undefined as Record<string, unknown> | undefined,
    tokenCreated: [] as { data: { tokenHash: string; expiresAt: Date } }[],
    tokenInvalidated: 0,
    deleted: [] as string[],
    mail: [] as { to: string; text: string }[],
  };
  const tx = {
    account: {
      findFirst: async () => ({
        id: 'acc-A',
        businessName: 'Cobranzas Rosa',
        maxUsers: opts.maxUsers ?? 5,
      }),
    },
    passwordResetToken: {
      create: async (args: { data: { tokenHash: string; expiresAt: Date } }) =>
        void calls.tokenCreated.push(args),
      updateMany: async () => void calls.tokenInvalidated++,
      deleteMany: async () => void calls.deleted.push('token'),
    },
    userAccount: {
      findMany: async (args: Record<string, unknown>) => {
        calls.listArgs = args;
        return [member()];
      },
      findFirst: async () => (opts.found === undefined ? member() : opts.found),
      count: async (args: { where?: Record<string, unknown> }) => {
        calls.countWhere = args.where;
        // `invite` cuenta asientos ocupados; `updateMember` cuenta otros admins.
        return args.where?.userId === undefined && opts.seats !== undefined
          ? opts.seats
          : (opts.otherAdmins ?? 1);
      },
      create: async (args: { data: Record<string, unknown> }) =>
        member({ ...args.data, role: ROLES[(args.data.roleId as string) ?? ROLE_COLLECTOR] }),
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.updated = args.data;
        return member({ ...args.data, role: ROLES[(args.data.roleId as string) ?? ROLE_COLLECTOR] });
      },
      delete: async () => void calls.deleted.push('userAccount'),
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
      findUnique: async () => ({
        id: SELF,
        email: 'yo@kobrax.demo',
        profile: { firstName: 'Ana', lastName: 'Gómez' },
      }),
      create: async (args: { data: Record<string, unknown> }) => {
        if (opts.emailTaken) throw Object.assign(new Error('unique'), { code: 'P2002' });
        calls.userCreated = args.data;
        return { id: OTHER, email: args.data.email };
      },
      delete: async () => void calls.deleted.push('user'),
    },
    profile: {
      findUnique: async () => ({ id: 'p1', userId: SELF, firstName: 'Ana', lastName: 'Gómez' }),
      update: async () => ({ id: 'p1', userId: SELF }),
      deleteMany: async () => void calls.deleted.push('profile'),
    },
  };
  const prisma = {
    withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    role: { findUnique: async (args: { where: { id: string } }) => ROLES[args.where.id] ?? null },
    user: tx.user,
  };
  const tenant = { accountId: 'acc-A', userId: SELF };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const mail = { send: async (to: string, _s: string, text: string) => void calls.mail.push({ to, text }) };
  const service = new UsersService(
    prisma as never,
    tenant as never,
    audit as never,
    mail as never,
  );
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

  // Un admin invitado que nunca aceptó es un `userAccount` activo con un `User` PENDING.
  // Contarlo como respaldo dejaba pasar justo lo que esta guarda existe para frenar:
  // quedarse sin ningún administrador capaz de iniciar sesión.
  it('no cuenta como respaldo a un admin invitado que todavía no aceptó', async () => {
    const { service, calls } = makeService({
      found: member({ roleId: ROLE_ADMIN, role: ROLES[ROLE_ADMIN] }),
      otherAdmins: 1,
    });
    await service.updateMember(OTHER, { isActive: false });
    assert.deepEqual(calls.countWhere!.user, { status: 'ACTIVE' });
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

const INVITE = {
  firstName: 'Rosa',
  lastName: 'Quispe',
  email: 'Rosa@Kobrax.Demo',
  roleId: ROLE_COLLECTOR,
};

describe('UsersService.invite — alta por invitación (S2)', () => {
  it('crea al invitado PENDING, su membresía y el token, y manda el correo', async () => {
    const { service, calls } = makeService({ seats: 2 });
    await service.invite(INVITE);

    assert.equal(calls.userCreated!.status, 'PENDING'); // no puede entrar hasta aceptar
    assert.equal(calls.userCreated!.email, 'rosa@kobrax.demo'); // normalizado
    assert.equal(calls.tokenCreated.length, 1);
    assert.match(calls.tokenCreated[0]!.data.tokenHash, /^[a-f0-9]{64}$/); // nunca el código en claro
    assert.deepEqual(calls.audit, ['CREATE']);
    assert.equal(calls.mail[0]!.to, 'rosa@kobrax.demo');
    assert.match(calls.mail[0]!.text, /kobrax:\/\/invitacion\?c=/);
  });

  it('devuelve el código en claro una sola vez, para dictarlo o mandarlo por WhatsApp (S2-D9)', async () => {
    const { service, calls } = makeService({ seats: 0 });
    const created = await service.invite(INVITE);
    assert.match(created.invitationCode, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    // Y es el mismo que viajó en el correo.
    assert.ok(calls.mail[0]!.text.includes(created.invitationCode));
  });

  it('el token vive 7 días: el invitado puede estar en campo sin ver el correo', async () => {
    const { service, calls } = makeService({ seats: 0 });
    const before = Date.now();
    await service.invite(INVITE);
    const ttl = calls.tokenCreated[0]!.data.expiresAt.getTime() - before;
    assert.ok(ttl > 6.9 * 86_400_000 && ttl <= 7 * 86_400_000 + 1000, `TTL fuera de rango: ${ttl}`);
  });

  it('rechaza al llegar al techo del plan, y cuenta DENTRO de la transacción', async () => {
    const { service, calls } = makeService({ seats: 5, maxUsers: 5 });
    await rejectsWithCode(service.invite(INVITE), 'USER_SEAT_LIMIT');
    assert.equal(calls.userCreated, undefined);
    assert.equal(calls.mail.length, 0);
  });

  it('rechaza un rol que el móvil no administra', async () => {
    const { service } = makeService({ seats: 0 });
    await rejectsWithCode(service.invite({ ...INVITE, roleId: ROLE_MANAGER }), 'USER_ROLE_NOT_ALLOWED');
  });

  it('correo ya registrado → 409 (lo caza el @unique, no un chequeo previo)', async () => {
    const { service } = makeService({ seats: 0, emailTaken: true });
    await rejectsWithCode(service.invite(INVITE), 'AUTH_EMAIL_TAKEN');
  });
});

describe('UsersService.resendInvitation', () => {
  it('invalida el código anterior y crea uno nuevo', async () => {
    const { service, calls } = makeService({
      found: member({ user: { ...member().user, status: 'PENDING' } }),
    });
    await service.resendInvitation(OTHER);
    assert.equal(calls.tokenInvalidated, 1); // uno vigente a la vez
    assert.equal(calls.tokenCreated.length, 1);
    assert.equal(calls.mail.length, 1);
  });

  it('no aplica a quien ya aceptó', async () => {
    const { service } = makeService(); // el miembro por defecto está ACTIVE
    await rejectsWithCode(service.resendInvitation(OTHER), 'USER_NOT_PENDING');
  });
});

describe('UsersService.remove — cancelar la invitación (S2-D5)', () => {
  it('borra al pendiente entero: libera el asiento y el correo', async () => {
    const { service, calls } = makeService({
      found: member({ user: { ...member().user, status: 'PENDING' } }),
    });
    await service.remove(OTHER);
    assert.deepEqual(calls.deleted, ['token', 'userAccount', 'profile', 'user']);
    assert.deepEqual(calls.audit, ['DELETE']);
  });

  it('a un miembro que ya entró no se lo elimina, se lo desactiva', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.remove(OTHER), 'USER_NOT_PENDING');
  });

  it('no deja borrarse a uno mismo', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.remove(SELF), 'USER_CANNOT_EDIT_SELF');
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
