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

function makeAuth(opts: {
  user: Record<string, unknown>;
  memberships?: ReturnType<typeof memb>[];
  /** Simula Redis caído en la revocación de la sesión anterior. */
  revokeFails?: boolean;
  /** La persona tiene un rol crítico (lo que dice `MfaService.isCritical`). */
  critical?: boolean;
}) {
  const calls = {
    userUpdate: [] as { where: { id: string }; data: Record<string, unknown> }[],
    forRole: [] as string[],
    revokedSessions: [] as string[],
  };
  const prisma = {
    user: {
      findUnique: async () => opts.user,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.userUpdate.push(args);
        return {};
      },
    },
    role: { findUnique: async () => ({ name: 'MANAGER' }) },
    $queryRaw: async () => opts.memberships ?? [],
    // `issueTokens` escribe la sesión y el refresh dentro del tenant destino.
    withTenant: async <T>(_accountId: string, fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        userSession: { create: async () => ({ id: 'sess-nueva' }) },
        refreshToken: { create: async () => ({}) },
      }),
  };
  const permissions = {
    forRole: async (roleId: string) => {
      calls.forRole.push(roleId);
      return ['collection:read'];
    },
  };
  const sessions = {
    denylist: async () => {},
    revokeAll: async () => 0,
    revokeOne: async (_userId: string, sessionId: string) => {
      if (opts.revokeFails) throw new Error('redis caído');
      calls.revokedSessions.push(sessionId);
    },
  };
  const mfa = { isCritical: async () => opts.critical ?? false };
  const audited: Record<string, unknown>[] = [];
  const audit = {
    record: async (entry: Record<string, unknown>) => {
      audited.push(entry);
    },
  };
  const service = new AuthService(
    prisma as never,
    token,
    permissions as never,
    sessions as never,
    mfa as never,
    audit as never,
  );
  return { service, calls, audited };
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
  // D2 (2026-10-10) reemplaza la decisión del 31/07 («se puede postergar indefinidamente»): para un rol crítico el MFA es
  // obligatorio. La postergación solo existe dentro de una gracia explícita (`MFA_CRITICAL_GRACE_UNTIL`).
  const savedGrace = process.env.MFA_CRITICAL_GRACE_UNTIL;
  const setGrace = (v: string | undefined) => {
    if (v === undefined) delete process.env.MFA_CRITICAL_GRACE_UNTIL;
    else process.env.MFA_CRITICAL_GRACE_UNTIL = v;
  };
  const restore = () => setGrace(savedGrace);

  it('🔴 rol crítico sin gracia configurada: no se puede postergar (AUTH_011)', async () => {
    setGrace(undefined);
    try {
      const { service } = makeAuth({ user: { id: 'u1', status: 'ACTIVE', mfaEnabled: false }, critical: true, memberships: [memb('ACCOUNT_ADMIN', 'a1')] });
      const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa_enroll' });
      await rejectsWithCode(service.mfaSetupSkip(pre, META), AUTH_ERR.MFA_REQUIRED_BY_POLICY);
    } finally {
      restore();
    }
  });

  it('🔴 con la gracia vencida tampoco', async () => {
    setGrace('2020-01-01T00:00:00Z');
    try {
      const { service } = makeAuth({ user: { id: 'u1', status: 'ACTIVE', mfaEnabled: false }, critical: true, memberships: [memb('ACCOUNT_ADMIN', 'a1')] });
      const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa_enroll' });
      await rejectsWithCode(service.mfaSetupSkip(pre, META), AUTH_ERR.MFA_REQUIRED_BY_POLICY);
    } finally {
      restore();
    }
  });

  it('dentro de la gracia explícita el crítico todavía puede postergar (transición)', async () => {
    setGrace(new Date(Date.now() + 7 * 86_400_000).toISOString());
    try {
      const { service } = makeAuth({ user: { id: 'u1', status: 'ACTIVE', mfaEnabled: false }, critical: true, memberships: [memb('ACCOUNT_ADMIN', 'a1'), memb('ACCOUNT_ADMIN', 'a2')] });
      const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa_enroll' });
      assert.equal((await service.mfaSetupSkip(pre, META)).step, 'select_account');
    } finally {
      restore();
    }
  });

  it('quien no es crítico no se ve afectado', async () => {
    setGrace(undefined);
    try {
      const { service } = makeAuth({ user: { id: 'u1', status: 'ACTIVE', mfaEnabled: false }, critical: false, memberships: [memb('MANAGER', 'a1'), memb('MANAGER', 'a2')] });
      const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa_enroll' });
      assert.equal((await service.mfaSetupSkip(pre, META)).step, 'select_account');
    } finally {
      restore();
    }
  });

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

describe('AuthService — cambio de empresa con la sesión ya iniciada (W1)', () => {
  const user = { id: 'u9', status: 'ACTIVE', mfaEnabled: false };

  it('un usuario suspendido NO puede saltar a otra empresa', async () => {
    // Nadie revoca las sesiones vivas al suspender a alguien: sin esta guarda, dentro de los
    // 15 min de su access token se emitía una sesión nueva de 7 días en el otro tenant.
    const { service } = makeAuth({
      user: { id: 'u9', status: 'SUSPENDED' },
      memberships: [memb('SUPERVISOR', 'a1'), memb('COLLECTOR', 'a2')],
    });
    await rejectsWithCode(
      service.switchAccount('u9', 'sess-vieja', 'a2', META),
      AUTH_ERR.INVALID_TOKEN,
    );
  });

  it('una cuenta bloqueada por intentos fallidos tampoco', async () => {
    const { service } = makeAuth({
      user: { id: 'u9', status: 'ACTIVE', lockedUntil: new Date(Date.now() + 10 * 60_000) },
      memberships: [memb('SUPERVISOR', 'a1'), memb('COLLECTOR', 'a2')],
    });
    await rejectsWithCode(
      service.switchAccount('u9', 'sess-vieja', 'a2', META),
      AUTH_ERR.ACCOUNT_LOCKED,
    );
  });

  it('lista sólo las empresas donde el usuario puede operar', async () => {
    const { service } = makeAuth({
      user,
      memberships: [memb('SUPERVISOR', 'a1'), memb('ACCOUNT_ADMIN', 'a2')],
    });
    const accounts = await service.listAccounts('u9');
    assert.deepEqual(
      accounts.map((a) => [a.id, a.role]),
      [
        ['a1', 'SUPERVISOR'],
        ['a2', 'ACCOUNT_ADMIN'],
      ],
    );
  });

  it('un tenant suspendido no aparece en la lista', async () => {
    const { service } = makeAuth({
      user,
      memberships: [memb('SUPERVISOR', 'a1'), memb('ACCOUNT_ADMIN', 'a2', 'SUSPENDED')],
    });
    assert.deepEqual((await service.listAccounts('u9')).map((a) => a.id), ['a1']);
  });

  it('una empresa donde no hay membresía → AUTH_007', async () => {
    const { service } = makeAuth({ user, memberships: [memb('SUPERVISOR', 'a1')] });
    await rejectsWithCode(
      service.switchAccount('u9', 'sess-vieja', 'ajena', META),
      AUTH_ERR.ACCOUNT_NOT_ALLOWED,
    );
  });

  it('nombrar un tenant suspendido no lo destraba (CU-01 también vale en caliente)', async () => {
    const { service } = makeAuth({
      user,
      memberships: [memb('SUPERVISOR', 'a1'), memb('ACCOUNT_ADMIN', 'a2', 'SUSPENDED')],
    });
    await rejectsWithCode(
      service.switchAccount('u9', 'sess-vieja', 'a2', META),
      AUTH_ERR.ACCOUNT_NOT_ALLOWED,
    );
  });

  it('deja el salto en el audit trail: quién, adónde y con qué rol', async () => {
    const { service, audited } = makeAuth({
      user,
      memberships: [memb('SUPERVISOR', 'a1'), memb('COLLECTOR', 'a2')],
    });
    await service.switchAccount('u9', 'sess-vieja', 'a2', META);

    // El «desde dónde» lo pone el contexto de tenant, que sigue siendo el de origen.
    assert.deepEqual(audited, [
      {
        entity: 'account',
        entityId: 'a2',
        action: 'SWITCH_ACCOUNT',
        after: { toAccountId: 'a2', role: 'COLLECTOR' },
      },
    ]);
  });

  it('si la revocación falla, igual entrega el par nuevo', async () => {
    // El par ya está commiteado y `revokeRows` invalida la sesión vieja en Postgres ANTES de
    // tocar Redis: dejar subir la excepción devolvía un 500 al navegador, que se quedaba con
    // unas cookies ya muertas y terminaba en /login a los 15 minutos.
    const { service } = makeAuth({
      user,
      memberships: [memb('SUPERVISOR', 'a1'), memb('COLLECTOR', 'a2')],
      revokeFails: true,
    });
    const tokens = await service.switchAccount('u9', 'sess-vieja', 'a2', META);
    assert.equal(token.verifyAccess(tokens.accessToken).accountId, 'a2');
  });

  it('emite tokens de la empresa destino y revoca la sesión anterior', async () => {
    const { service, calls } = makeAuth({
      user,
      memberships: [memb('SUPERVISOR', 'a1'), memb('COLLECTOR', 'a2')],
    });
    const tokens = await service.switchAccount('u9', 'sess-vieja', 'a2', META);

    const claims = token.verifyAccess(tokens.accessToken);
    assert.equal(claims.accountId, 'a2', 'el token tiene que quedar apuntando a la empresa nueva');
    // Los permisos se re-derivan del rol de DESTINO; arrastrar los del token viejo sería
    // llevarse los permisos de una empresa a otra.
    assert.deepEqual(calls.forRole, ['role-COLLECTOR']);
    // Sin esto queda vivo un refresh token que sigue devolviendo tokens de la empresa vieja.
    assert.deepEqual(calls.revokedSessions, ['sess-vieja']);
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

describe('AuthService.me — sesión del token (W-LOG-54)', () => {
  it('devuelve el sessionId para que las pestañas comparen con qué sesión cargaron', async () => {
    const { service } = makeAuth({
      user: { id: 'u1', email: 'm@kobrax.demo', profile: null, mfaEnabled: false, requiresPasswordChange: false },
    });
    const me = await service.me({ userId: 'u1', accountId: 'a1', roleId: 'r1', permissions: [], sessionId: 'sess-1' });
    assert.equal(me.sessionId, 'sess-1');
    assert.equal(me.accountId, 'a1');
  });
});
