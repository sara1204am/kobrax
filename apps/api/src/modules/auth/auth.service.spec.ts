import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { KOBRAX } from '@kobrax/shared';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AUTH_ERR } from './auth.errors';
import { rejectsWithCode } from './auth-test-utils';
import type { AppConfigService } from '../../config/app-config.service';

const config = {
  jwtSecret: 'test-access-secret-0123456789',
  jwtRefreshSecret: 'test-refresh-secret-0123456789',
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
} as unknown as AppConfigService;

const token = new TokenService(new JwtService({}), config);

/** Fila de membresía como la devuelve `auth_memberships` (SECURITY DEFINER). */
function memb(roleName: string, accountId = 'a1', status = 'ACTIVE') {
  return {
    user_account_id: `ua-${accountId}`,
    account_id: accountId,
    role_id: `role-${roleName}`,
    branch_id: null,
    is_default: true,
    is_owner: roleName === 'ACCOUNT_ADMIN',
    account_name: `Acc ${accountId}`,
    account_status: status,
    role_name: roleName,
  };
}

function makeAuth(opts: { user: Record<string, unknown>; memberships?: ReturnType<typeof memb>[] }) {
  const calls = { userUpdate: [] as { where: { id: string }; data: Record<string, unknown> }[] };
  const prisma = {
    user: {
      findUnique: async () => opts.user,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.userUpdate.push(args);
        return {};
      },
    },
    $queryRaw: async () => opts.memberships ?? [],
  };
  const permissions = { forRole: async () => ['case:read'] };
  const sessions = { denylist: async () => {}, revokeAll: async () => 0 };
  const mfa = {};
  const service = new AuthService(prisma as never, token, permissions as never, sessions as never, mfa as never);
  return { service, calls };
}

const META = { ip: '1.2.3.4', deviceType: 'mobile' };

describe('AuthService.login — MFA obligatorio (enforcement F2b)', () => {
  it('rol crítico sin MFA → step mfa_setup con pre-auth purpose mfa_enroll', async () => {
    const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
    const { service } = makeAuth({
      user: { id: 'u1', email: 'owner@kobrax.demo', status: 'ACTIVE', passwordHash, mfaEnabled: false, failedLoginAttempts: 0 },
      memberships: [memb('ACCOUNT_ADMIN')],
    });
    const res = await service.login('owner@kobrax.demo', 'Right1!', META);
    assert.equal(res.step, 'mfa_setup');
    const pre = token.verifyPreAuth(res.preAuthToken!, 'mfa_enroll');
    assert.equal(pre.sub, 'u1');
  });

  it('usuario con MFA activo → step mfa antes de tocar membresías', async () => {
    const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
    const { service } = makeAuth({
      user: { id: 'u2', email: 'mfa@kobrax.demo', status: 'ACTIVE', passwordHash, mfaEnabled: true, mfaSecret: 'enc', failedLoginAttempts: 0 },
    });
    const res = await service.login('mfa@kobrax.demo', 'Right1!', META);
    assert.equal(res.step, 'mfa');
    assert.equal(token.verifyPreAuth(res.preAuthToken!, 'mfa').sub, 'u2');
  });

  it('rol NO crítico con ≥2 empresas → select_account (sin forzar MFA)', async () => {
    const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
    const { service } = makeAuth({
      user: { id: 'u3', email: 'sup@kobrax.demo', status: 'ACTIVE', passwordHash, mfaEnabled: false, failedLoginAttempts: 0 },
      memberships: [memb('SUPERVISOR', 'a1'), memb('COLLECTOR', 'a2')],
    });
    const res = await service.login('sup@kobrax.demo', 'Right1!', META);
    assert.equal(res.step, 'select_account');
    assert.equal(res.accounts?.length, 2);
  });
});

describe('AuthService.mfaSetupSkip — postergar el MFA obligatorio', () => {
  // Decisión de producto (31/07): se puede postergar indefinidamente. El recordatorio es
  // blando (`me.mfaEnabled === false` → aviso en el Home), no hay segundo muro.
  it('completa el login sin activar MFA', async () => {
    const { service } = makeAuth({
      user: { id: 'u1', status: 'ACTIVE', mfaEnabled: false },
      // Dos empresas → el flujo corta en `select_account` y no toca la emisión de tokens.
      memberships: [memb('ACCOUNT_ADMIN', 'a1'), memb('ACCOUNT_ADMIN', 'a2')],
    });
    const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa_enroll' });
    const res = await service.mfaSetupSkip(pre, META);
    assert.equal(res.step, 'select_account');
  });

  it('deja marcado que el segundo factor NO se verificó', async () => {
    const { service } = makeAuth({
      user: { id: 'u1', status: 'ACTIVE', mfaEnabled: false },
      memberships: [memb('ACCOUNT_ADMIN', 'a1'), memb('ACCOUNT_ADMIN', 'a2')],
    });
    const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa_enroll' });
    const res = await service.mfaSetupSkip(pre, META);
    assert.equal(token.verifyPreAuth(res.preAuthToken!, 'select_account').mfaVerified, false);
  });

  it('no acepta un pre-auth token de otro paso', async () => {
    const { service } = makeAuth({ user: { id: 'u1', status: 'ACTIVE', mfaEnabled: false } });
    const wrong = token.signPreAuth({ sub: 'u1', purpose: 'mfa' });
    await rejectsWithCode(service.mfaSetupSkip(wrong, META), AUTH_ERR.INVALID_TOKEN);
  });
});

describe('AuthService.login — credenciales y lockout', () => {
  it('contraseña incorrecta en el 5º intento → bloquea la cuenta y lanza AUTH_001', async () => {
    const passwordHash = await hash('Right1!', KOBRAX.BCRYPT_WORK_FACTOR);
    const { service, calls } = makeAuth({
      user: {
        id: 'u4',
        email: 'lock@kobrax.demo',
        status: 'ACTIVE',
        passwordHash,
        mfaEnabled: false,
        failedLoginAttempts: KOBRAX.MAX_FAILED_LOGINS - 1, // este intento llega al límite
      },
    });
    await rejectsWithCode(service.login('lock@kobrax.demo', 'Wrong1!', META), AUTH_ERR.INVALID_CREDENTIALS);
    assert.equal(calls.userUpdate.length, 1);
    const data = calls.userUpdate[0]!.data;
    assert.equal(data.failedLoginAttempts, KOBRAX.MAX_FAILED_LOGINS);
    assert.ok(data.lockedUntil instanceof Date, 'debe fijar lockedUntil al alcanzar el límite');
  });

  it('cuenta ya bloqueada → AUTH_002 sin comparar contraseña', async () => {
    const { service, calls } = makeAuth({
      user: {
        id: 'u5',
        email: 'locked@kobrax.demo',
        status: 'ACTIVE',
        passwordHash: 'irrelevante',
        lockedUntil: new Date(Date.now() + 10 * 60_000),
        failedLoginAttempts: KOBRAX.MAX_FAILED_LOGINS,
      },
    });
    await rejectsWithCode(service.login('locked@kobrax.demo', 'loQueSea', META), AUTH_ERR.ACCOUNT_LOCKED);
    assert.equal(calls.userUpdate.length, 0); // no resetea ni registra nada
  });
});
