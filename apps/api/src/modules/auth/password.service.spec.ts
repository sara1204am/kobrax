import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'bcryptjs';
import { KOBRAX } from '@kobrax/shared';
import { PasswordService } from './password.service';
import { AUTH_ERR } from './auth.errors';
import { rejectsWithCode } from './auth-test-utils';

/** Fake mínimo de PrismaService + SessionService para PasswordService. */
function makeDeps(opts: {
  users?: Record<string, unknown>;
  resetRecord?: { id: string; userId: string } | null;
} = {}) {
  const calls = {
    resetCreate: [] as unknown[],
    userUpdate: [] as { where: { id: string }; data: Record<string, unknown> }[],
    resetUpdateMany: [] as unknown[],
    revokeAll: [] as { userId: string; except?: string }[],
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
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const sessions = {
    revokeAll: async (userId: string, except?: string) => {
      calls.revokeAll.push({ userId, except });
      return 0;
    },
  };
  const config = { isProduction: false };
  const service = new PasswordService(prisma as never, sessions as never, config as never);
  return { service, calls };
}

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

describe('PasswordService.resetPassword', () => {
  it('rechaza una contraseña que no cumple la política (AUTH_008)', async () => {
    const { service } = makeDeps({ resetRecord: { id: 't1', userId: 'u1' } });
    await rejectsWithCode(service.resetPassword('tok', 'weak'), AUTH_ERR.WEAK_PASSWORD);
  });

  it('rechaza un token inválido/expirado/usado (AUTH_005)', async () => {
    const { service } = makeDeps({ resetRecord: null });
    await rejectsWithCode(service.resetPassword('tok', 'Kobrax123!'), AUTH_ERR.RESET_TOKEN_INVALID);
  });

  it('en éxito: limpia requiresPasswordChange, invalida tokens y revoca todas las sesiones', async () => {
    const { service, calls } = makeDeps({ resetRecord: { id: 't1', userId: 'u1' } });
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
