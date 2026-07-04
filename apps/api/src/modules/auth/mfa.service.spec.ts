import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'bcryptjs';
import { KOBRAX } from '@kobrax/shared';
import { MfaService } from './mfa.service';
import { generateSecret } from './totp';
import { AUTH_ERR } from './auth.errors';
import { rejectsWithCode } from './auth-test-utils';

/** crypto identidad: el secreto se guarda/lee sin cifrar (no testeamos AES aquí). */
const crypto = { encrypt: (s: string) => s, decrypt: (s: string) => s };

function makeMfa(user: Record<string, unknown> | null) {
  const calls = { transaction: 0 };
  let backupConsumed = false;
  const prisma = {
    user: {
      findUnique: async () => user,
      update: async () => ({}),
    },
    mfaBackupCode: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 8 }),
      findFirst: async () => (backupConsumed ? null : { id: 'b1' }),
      updateMany: async () => {
        if (backupConsumed) return { count: 0 };
        backupConsumed = true;
        return { count: 1 };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => {
      calls.transaction += 1;
      return Promise.all(ops);
    },
  };
  const service = new MfaService(prisma as never, crypto as never);
  return { service, calls };
}

describe('MfaService.disable (re-autenticación obligatoria)', () => {
  it('es idempotente si MFA ya estaba deshabilitado', async () => {
    const { service, calls } = makeMfa({ id: 'u1', mfaEnabled: false });
    await service.disable('u1', { password: 'loQueSea' });
    assert.equal(calls.transaction, 0); // no borra nada
  });

  it('rechaza con AUTH_006 si la re-autenticación falla (password incorrecta)', async () => {
    const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
    const { service } = makeMfa({ id: 'u1', mfaEnabled: true, passwordHash });
    await rejectsWithCode(service.disable('u1', { password: 'Wrong1!' }), AUTH_ERR.MFA_INVALID);
  });

  it('deshabilita MFA cuando la contraseña actual es correcta', async () => {
    const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
    const { service, calls } = makeMfa({ id: 'u1', mfaEnabled: true, passwordHash });
    await service.disable('u1', { password: 'Right1!' });
    assert.equal(calls.transaction, 1); // borra secreto + backup codes
  });
});

describe('MfaService.regenerateBackupCodes', () => {
  it('exige MFA activo (AUTH_006 si no)', async () => {
    const { service } = makeMfa({ id: 'u1', mfaEnabled: false });
    await rejectsWithCode(service.regenerateBackupCodes('u1'), AUTH_ERR.MFA_INVALID);
  });

  it('emite 8 códigos nuevos e invalida los anteriores', async () => {
    const { service, calls } = makeMfa({ id: 'u1', mfaEnabled: true });
    const codes = await service.regenerateBackupCodes('u1');
    assert.equal(codes.length, 8);
    assert.ok(codes.every((c) => /^[a-f0-9]{5}-[a-f0-9]{5}$/.test(c)));
    assert.equal(calls.transaction, 1);
  });
});

describe('MfaService.challenge — backup code de un solo uso', () => {
  it('acepta el backup code una vez y lo rechaza al reutilizarlo', async () => {
    const secret = generateSecret();
    const { service } = makeMfa({ id: 'u1', mfaEnabled: true, mfaSecret: secret });
    const backup = 'aaaaa-bbbbb'; // no es un TOTP de 6 dígitos → fuerza la rama de backup
    assert.equal(await service.challenge('u1', backup), true); // primer uso
    assert.equal(await service.challenge('u1', backup), false); // reuso bloqueado
  });
});
