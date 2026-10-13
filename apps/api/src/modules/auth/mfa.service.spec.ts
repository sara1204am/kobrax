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

/** `roles` = los roles de sus membresías activas (lo que devuelve `auth_memberships`). */
function makeMfa(user: Record<string, unknown> | null, roles: string[] = ['COLLECTOR']) {
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
    $queryRaw: async () => roles.map((role_name) => ({ role_name })),
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

describe('MfaService.disable — roles críticos (D2)', () => {
  // La política no depende del botón: el servidor lo impone aun con la contraseña correcta.
  for (const role of ['ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
    it(`🔴 ${role}: no puede desactivar el MFA ni con la contraseña correcta`, async () => {
      const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
      const { service, calls } = makeMfa({ id: 'u1', mfaEnabled: true, passwordHash }, [role]);
      await rejectsWithCode(service.disable('u1', { password: 'Right1!' }), AUTH_ERR.MFA_REQUIRED_BY_POLICY);
      assert.equal(calls.transaction, 0);
    });
  }

  it('🔴 tampoco con un código MFA vigente (no hay vía alternativa)', async () => {
    const { service, calls } = makeMfa({ id: 'u1', mfaEnabled: true, mfaSecret: generateSecret() }, ['ACCOUNT_ADMIN']);
    await rejectsWithCode(service.disable('u1', { code: 'aaaaa-bbbbb' }), AUTH_ERR.MFA_REQUIRED_BY_POLICY);
    assert.equal(calls.transaction, 0);
  });

  it('basta UNA membresía crítica en cualquier empresa: el segundo factor es de la persona', async () => {
    const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
    const { service } = makeMfa({ id: 'u1', mfaEnabled: true, passwordHash }, ['COLLECTOR', 'ACCOUNT_ADMIN']);
    await rejectsWithCode(service.disable('u1', { password: 'Right1!' }), AUTH_ERR.MFA_REQUIRED_BY_POLICY);
  });

  for (const role of ['MANAGER', 'SUPERVISOR', 'COLLECTOR', 'AUDITOR']) {
    it(`${role}: sigue pudiendo desactivarlo, con reautenticación`, async () => {
      const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
      const { service, calls } = makeMfa({ id: 'u1', mfaEnabled: true, passwordHash }, [role]);
      await service.disable('u1', { password: 'Right1!' });
      assert.equal(calls.transaction, 1);
    });
  }

  it('un crítico SIN MFA activo no es bloqueado: no hay nada que apagar (idempotente)', async () => {
    const { service, calls } = makeMfa({ id: 'u1', mfaEnabled: false }, ['ACCOUNT_ADMIN']);
    await service.disable('u1', { password: 'x' });
    assert.equal(calls.transaction, 0);
  });

  it('isCritical: solo ACCOUNT_ADMIN y SUPER_ADMIN', async () => {
    assert.equal(await makeMfa(null, ['ACCOUNT_ADMIN']).service.isCritical('u'), true);
    assert.equal(await makeMfa(null, ['SUPER_ADMIN']).service.isCritical('u'), true);
    assert.equal(await makeMfa(null, ['MANAGER']).service.isCritical('u'), false);
    assert.equal(await makeMfa(null, []).service.isCritical('u'), false);
  });
});

describe('MfaService.enroll — no pisa un segundo factor activo (D2)', () => {
  it('con el MFA activo rechaza (AUTH_012): reenrolar dejaría a la persona afuera', async () => {
    const { service } = makeMfa({ id: 'u1', email: 'a@b.c', mfaEnabled: true, mfaSecret: 'S' });
    await rejectsWithCode(service.enroll('u1'), AUTH_ERR.MFA_ALREADY_ENABLED);
  });

  it('sin MFA activo enrola normalmente', async () => {
    const { service } = makeMfa({ id: 'u1', email: 'a@b.c', mfaEnabled: false });
    const r = await service.enroll('u1');
    assert.match(r.otpauthUrl, /^otpauth:\/\//);
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
