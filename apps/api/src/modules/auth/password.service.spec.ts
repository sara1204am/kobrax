import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'bcryptjs';
import { KOBRAX } from '@kobrax/shared';
import { PasswordService } from './password.service';
import { AUTH_ERR } from './auth.errors';
import { rejectsWithCode } from './auth-test-utils';

/** Fake mínimo de PrismaService + SessionService + MailService para PasswordService. */
function makeDeps(opts: {
  users?: Record<string, unknown>;
  resetRecord?: { id: string; userId: string; user?: Record<string, unknown> } | null;
  /** Filas que devuelve `auth_memberships()` (la cuenta a la que pertenece el invitado). */
  memberships?: { account_id: string; account_name: string }[];
} = {}) {
  const calls = {
    resetCreate: [] as unknown[],
    userUpdate: [] as { where: { id: string }; data: Record<string, unknown> }[],
    resetUpdateMany: [] as unknown[],
    revokeAll: [] as { userId: string; except?: string }[],
    mail: [] as { to: string; subject: string; text: string }[],
    audit: [] as Record<string, unknown>[],
  };
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        (opts.users ?? {})[where.email ?? where.id ?? ''] ?? null,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.userUpdate.push(args);
        return { id: args.where.id };
      },
    },
    passwordResetToken: {
      create: async (args: unknown) => {
        calls.resetCreate.push(args);
        return args;
      },
      findFirst: async () => opts.resetRecord ?? null,
      updateMany: async (args: unknown) => {
        calls.resetUpdateMany.push(args);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => void calls.audit.push(args.data),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    $queryRaw: async () => opts.memberships ?? [],
    withTenant: async (_a: string, fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  const sessions = {
    revokeAll: async (userId: string, except?: string) => {
      calls.revokeAll.push({ userId, except });
      return 0;
    },
  };
  const config = { isProduction: false };
  const mail = {
    send: async (to: string, subject: string, text: string) => void calls.mail.push({ to, subject, text }),
  };
  const service = new PasswordService(
    prisma as never,
    sessions as never,
    config as never,
    mail as never,
  );
  return { service, calls };
}

const INVITED = {
  id: 't1',
  userId: 'u9',
  user: { id: 'u9', email: 'nuevo@kobrax.demo', status: 'PENDING', profile: { firstName: 'Rosa' } },
};

describe('PasswordService.forgotPassword (anti-enumeration)', () => {
  it('no crea token si el usuario no existe', async () => {
    const { service, calls } = makeDeps({ users: {} });
    await service.forgotPassword('ghost@kobrax.demo');
    assert.equal(calls.resetCreate.length, 0);
  });

  it('no crea token si el usuario no está ACTIVE', async () => {
    const { service, calls } = makeDeps({
      users: { 'suspended@kobrax.demo': { id: 'u1', email: 'suspended@kobrax.demo', status: 'SUSPENDED' } },
    });
    await service.forgotPassword('suspended@kobrax.demo');
    assert.equal(calls.resetCreate.length, 0);
  });

  it('crea un token con hash y expiración ~30min para un usuario activo', async () => {
    const { service, calls } = makeDeps({
      users: { 'ana@kobrax.demo': { id: 'u1', email: 'ana@kobrax.demo', status: 'ACTIVE' } },
    });
    const before = Date.now();
    await service.forgotPassword('ana@kobrax.demo');
    assert.equal(calls.resetCreate.length, 1);
    const data = (calls.resetCreate[0] as { data: { tokenHash: string; expiresAt: Date; userId: string } }).data;
    assert.equal(data.userId, 'u1');
    assert.match(data.tokenHash, /^[a-f0-9]{64}$/); // SHA-256 hex, nunca el token en claro
    const ttl = data.expiresAt.getTime() - before;
    assert.ok(ttl > 29 * 60_000 && ttl <= 30 * 60_000 + 1000, `TTL fuera de rango: ${ttl}ms`);
  });
});

describe('PasswordService.forgotPassword — el correo que nunca se enviaba', () => {
  it('manda el mail con el token (el TODO(F8) que estuvo roto desde siempre)', async () => {
    const { service, calls } = makeDeps({
      users: { 'ana@kobrax.demo': { id: 'u1', email: 'ana@kobrax.demo', status: 'ACTIVE' } },
    });
    await service.forgotPassword('ana@kobrax.demo');
    assert.equal(calls.mail.length, 1);
    assert.equal(calls.mail[0]!.to, 'ana@kobrax.demo');
    assert.match(calls.mail[0]!.text, /kobrax:\/\/reset\?token=/);
  });

  it('no manda nada si el usuario no existe (anti-enumeration)', async () => {
    const { service, calls } = makeDeps({ users: {} });
    await service.forgotPassword('ghost@kobrax.demo');
    assert.equal(calls.mail.length, 0);
  });
});

describe('PasswordService — invitación (S2)', () => {
  it('normaliza el código: guiones, minúsculas y O/I confundidas dan el mismo hash', async () => {
    const { service } = makeDeps({
      resetRecord: INVITED,
      memberships: [{ account_id: 'acc-A', account_name: 'Cobranzas Rosa' }],
    });
    // El fake devuelve el mismo registro para cualquier hash: lo que se verifica es que
    // ninguna de las formas explote y que las tres lleguen al mismo lugar.
    for (const raw of ['K7F29-QX3TM', 'k7f29qx3tm', 'K7F29 QX3TM']) {
      const inv = await service.getInvitation(raw);
      assert.equal(inv.email, 'nuevo@kobrax.demo');
    }
  });

  it('devuelve el negocio para pintar la pantalla', async () => {
    const { service } = makeDeps({
      resetRecord: INVITED,
      memberships: [{ account_id: 'acc-A', account_name: 'Cobranzas Rosa' }],
    });
    const inv = await service.getInvitation('K7F29-QX3TM');
    assert.equal(inv.businessName, 'Cobranzas Rosa');
    assert.equal(inv.firstName, 'Rosa');
  });

  it('rechaza un código que no existe, venció o ya se usó (AUTH_010)', async () => {
    const { service } = makeDeps({ resetRecord: null });
    await rejectsWithCode(service.getInvitation('K7F29-QX3TM'), AUTH_ERR.INVITATION_INVALID);
  });

  it('rechaza el código de alguien que ya aceptó', async () => {
    const { service } = makeDeps({
      resetRecord: { ...INVITED, user: { ...INVITED.user, status: 'ACTIVE' } },
    });
    await rejectsWithCode(service.getInvitation('K7F29-QX3TM'), AUTH_ERR.INVITATION_INVALID);
  });

  it('aceptar activa al usuario, limpia el cambio de contraseña forzado y consume el token', async () => {
    const { service, calls } = makeDeps({
      resetRecord: INVITED,
      memberships: [{ account_id: 'acc-A', account_name: 'Cobranzas Rosa' }],
    });
    await service.acceptInvitation('K7F29-QX3TM', 'Kobrax123!', { ip: '10.0.0.1' });

    const data = calls.userUpdate[0]!.data;
    assert.equal(data.status, 'ACTIVE');
    assert.equal(data.requiresPasswordChange, false);
    assert.equal(typeof data.passwordHash, 'string');
    assert.equal(calls.resetUpdateMany.length, 1);
  });

  it('deja fila de audit con la IP (endpoint público: AuditService no-opearía)', async () => {
    const { service, calls } = makeDeps({
      resetRecord: INVITED,
      memberships: [{ account_id: 'acc-A', account_name: 'Cobranzas Rosa' }],
    });
    await service.acceptInvitation('K7F29-QX3TM', 'Kobrax123!', { ip: '10.0.0.1' });
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.audit[0]!.accountId, 'acc-A');
    assert.equal(calls.audit[0]!.ip, '10.0.0.1');
  });

  it('rechaza una contraseña débil antes de tocar nada', async () => {
    const { service, calls } = makeDeps({ resetRecord: INVITED });
    await rejectsWithCode(service.acceptInvitation('K7F29-QX3TM', 'weak', {}), AUTH_ERR.WEAK_PASSWORD);
    assert.equal(calls.userUpdate.length, 0);
  });
});

describe('PasswordService.resetPassword', () => {
  it('rechaza una contraseña que no cumple la política (AUTH_008)', async () => {
    const { service } = makeDeps({ resetRecord: { id: 't1', userId: 'u1' } });
    await rejectsWithCode(service.resetPassword('tok', 'weak'), AUTH_ERR.WEAK_PASSWORD);
  });

  it('rechaza un token inválido/expirado/usado (AUTH_005)', async () => {
    const { service } = makeDeps({ resetRecord: null });
    await rejectsWithCode(service.resetPassword('tok', 'Kobrax123!'), AUTH_ERR.RESET_TOKEN_INVALID);
  });

  // Un código de invitación vive en la misma tabla que un token de reset (S2-D2). Gastarlo
  // por acá dejaba al invitado con contraseña nueva pero todavía PENDING: sin poder entrar
  // (login corta por status) y sin código, obligado a pedir un reenvío.
  it('rechaza un código de invitación usado como token de reset (AUTH_005)', async () => {
    const { service, calls } = makeDeps({
      resetRecord: { id: 't1', userId: 'u1', user: { status: 'PENDING' } },
    });
    await rejectsWithCode(service.resetPassword('tok', 'Kobrax123!'), AUTH_ERR.RESET_TOKEN_INVALID);
    assert.equal(calls.userUpdate.length, 0);
  });

  it('en éxito: limpia requiresPasswordChange, invalida tokens y revoca todas las sesiones', async () => {
    const { service, calls } = makeDeps({
      resetRecord: { id: 't1', userId: 'u1', user: { status: 'ACTIVE' } },
    });
    await service.resetPassword('tok', 'Kobrax123!');

    assert.equal(calls.userUpdate.length, 1);
    const data = calls.userUpdate[0]!.data;
    assert.equal(data.requiresPasswordChange, false);
    assert.equal(typeof data.passwordHash, 'string');
    assert.equal(calls.resetUpdateMany.length, 1); // un solo uso → invalida pendientes
    assert.deepEqual(calls.revokeAll, [{ userId: 'u1', except: undefined }]);
  });
});

describe('PasswordService.changePassword', () => {
  let currentHash = '';
  beforeEach(async () => {
    currentHash = await hash('Current1!', KOBRAX.BCRYPT_WORK_FACTOR);
  });

  it('rechaza si la contraseña actual no coincide (AUTH_001)', async () => {
    const { service } = makeDeps({ users: { u1: { id: 'u1', passwordHash: currentHash } } });
    await rejectsWithCode(service.changePassword('u1', 'WrongPass1!', 'Kobrax123!'), AUTH_ERR.INVALID_CREDENTIALS);
  });

  it('rechaza si la nueva contraseña es débil (AUTH_008)', async () => {
    const { service } = makeDeps({ users: { u1: { id: 'u1', passwordHash: currentHash } } });
    await rejectsWithCode(service.changePassword('u1', 'Current1!', 'weak'), AUTH_ERR.WEAK_PASSWORD);
  });

  it('en éxito: actualiza el hash y revoca todas las sesiones', async () => {
    const { service, calls } = makeDeps({ users: { u1: { id: 'u1', passwordHash: currentHash } } });
    await service.changePassword('u1', 'Current1!', 'Kobrax123!');
    assert.equal(calls.userUpdate.length, 1);
    assert.equal(typeof calls.userUpdate[0]!.data.passwordHash, 'string');
    assert.deepEqual(calls.revokeAll, [{ userId: 'u1', except: undefined }]);
  });
});
