import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashSync } from 'bcryptjs';
import { Reflector } from '@nestjs/core';
import { PLATFORM_PERMISSIONS, Permission, ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { PlatformAuthService } from './platform-auth.service';
import { SupportSessionsService } from './support-sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { totpNow } from '../auth/totp';

/** F14 · F5 (H-11): la plataforma. Interruptores externos, MFA obligatorio, sesiones de soporte con consentimiento. */
const codeOf = (e: unknown): string | undefined => (e as { getResponse?: () => { code?: string } }).getResponse?.().code;

afterEach(() => {
  delete process.env.PLATFORM_ACCESS_ENABLED;
  delete process.env.SUPPORT_WRITE_ENABLED;
});

// ── Login de plataforma ───────────────────────────────────────────────────────────────────────────────────────────────────────
function makeAuth(user: Record<string, unknown> | null) {
  const state = { user, signed: [] as Record<string, unknown>[] };
  const prisma = {
    platformUser: {
      findUnique: async () => state.user,
      update: async (a: { data: Record<string, unknown> }) => {
        state.user = { ...state.user, ...a.data };
        return state.user;
      },
    },
  };
  const crypto = { encrypt: (v: string) => `enc(${v})`, decrypt: (v: string) => v.slice(4, -1) };
  const token = { signAccess: (c: Record<string, unknown>) => (state.signed.push(c), 'jwt') };
  return { service: new PlatformAuthService(prisma as never, crypto as never, token as never), state };
}
const baseUser = () => ({ id: 'p1', email: 'root@kobrax.test', passwordHash: hashSync('Clave-segura-1', 4), mfaSecret: null, mfaEnabled: false, isActive: true });

describe('PlatformAuthService · login de plataforma (F14 · F5)', () => {
  it('🔴 con el interruptor externo apagado (por omisión) NO hay acceso aunque la contraseña sea correcta', async () => {
    const { service } = makeAuth(baseUser());
    await assert.rejects(service.login('root@kobrax.test', 'Clave-segura-1'), (e) => codeOf(e) === 'PLATFORM_DISABLED');
    await assert.rejects(service.confirmMfa('root@kobrax.test', 'Clave-segura-1', '123456'), (e) => codeOf(e) === 'PLATFORM_DISABLED');
  });

  it('🔴 contraseña mala y correo inexistente dan la MISMA respuesta (no se filtra cuál existe)', async () => {
    process.env.PLATFORM_ACCESS_ENABLED = 'true';
    const bad = makeAuth(baseUser());
    await assert.rejects(bad.service.login('root@kobrax.test', 'otra'), (e) => codeOf(e) === 'PLATFORM_AUTH_INVALID');
    const none = makeAuth(null);
    await assert.rejects(none.service.login('nadie@kobrax.test', 'Clave-segura-1'), (e) => codeOf(e) === 'PLATFORM_AUTH_INVALID');
  });

  it('🔴 sin MFA enrolado no hay token: la primera vez entrega el secreto para enrolar; con el código lo activa y entrega un token SOLO de plataforma', async () => {
    process.env.PLATFORM_ACCESS_ENABLED = 'true';
    const { service, state } = makeAuth(baseUser());
    const first = await service.login('root@kobrax.test', 'Clave-segura-1');
    assert.equal(first.step, 'mfa_setup');
    assert.equal(state.signed.length, 0, 'sin MFA no se firma ningún token');
    const secret = (first as { secret: string }).secret;
    await assert.rejects(service.confirmMfa('root@kobrax.test', 'Clave-segura-1', '000000'), (e) => codeOf(e) === 'PLATFORM_AUTH_INVALID');
    const done = await service.confirmMfa('root@kobrax.test', 'Clave-segura-1', totpNow(secret));
    assert.equal(done.accessToken, 'jwt');
    const claims = state.signed[0]!;
    assert.equal(claims.actorType, 'PLATFORM');
    assert.equal(claims.accountId, '', 'el token de plataforma no tiene empresa');
    assert.deepEqual(claims.permissions, [...PLATFORM_PERMISSIONS]);
    assert.ok(!(claims.permissions as string[]).some((p) => !p.startsWith('platform:')), 'ni un solo permiso de empresa');
    assert.equal(state.user?.mfaEnabled, true);
  });

  it('con el MFA enrolado el código es obligatorio', async () => {
    process.env.PLATFORM_ACCESS_ENABLED = 'true';
    const secret = 'JBSWY3DPEHPK3PXP';
    const { service } = makeAuth({ ...baseUser(), mfaSecret: `enc(${secret})`, mfaEnabled: true });
    await assert.rejects(service.login('root@kobrax.test', 'Clave-segura-1'), (e) => codeOf(e) === 'PLATFORM_AUTH_INVALID');
    await assert.rejects(service.login('root@kobrax.test', 'Clave-segura-1', '000000'), (e) => codeOf(e) === 'PLATFORM_AUTH_INVALID');
    const ok = await service.login('root@kobrax.test', 'Clave-segura-1', totpNow(secret));
    assert.equal(ok.step, 'done');
  });
});

// ── Sesiones de soporte ───────────────────────────────────────────────────────────────────────────────────────────────────────
function makeSessions(initial: Record<string, unknown> | null = null) {
  const audits: Record<string, unknown>[] = [];
  const signed: Record<string, unknown>[] = [];
  let row = initial;
  const tx = {
    account: { findFirst: async () => ({ id: 'acc-A' }) },
    supportSession: {
      create: async (a: { data: Record<string, unknown> }) => (row = { id: 'ss1', revokedAt: null, consentBy: null, consentAt: null, ...a.data }),
      findFirst: async () => row,
    },
    auditLog: { create: async (a: { data: Record<string, unknown> }) => void audits.push(a.data) },
  };
  const prisma = { withSystemTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx), withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const token = { signAccess: (c: Record<string, unknown>) => (signed.push(c), 'jwt') };
  const service = new SupportSessionsService(prisma as never, { accountId: 'acc-A', userId: 'u1', get: () => ({}) } as never, { record: async () => undefined } as never, token as never);
  return { service, audits, signed };
}
const READ = [Permission.CLIENT_READ, Permission.CREDIT_READ];

describe('SupportSessionsService · sesiones de soporte (F14 · F5)', () => {
  it('🔴 dura como máximo 240 minutos y pide al menos un permiso permitido', async () => {
    const { service } = makeSessions();
    await assert.rejects(service.open('p1', { accountId: 'acc-A', reason: 'ticket 123 cliente no ve su cartera', ttlMinutes: 241, permissions: READ }), (e) => codeOf(e) === 'SUPPORT_002');
    await assert.rejects(service.open('p1', { accountId: 'acc-A', reason: 'ticket 123 cliente no ve su cartera', ttlMinutes: 30, permissions: ['credit:write_off', 'platform:roles:write'] }), (e) => codeOf(e) === 'SUPPORT_003');
  });

  it('🔴 lo pedido se recorta al máximo de soporte; sin escritura sensible no necesita consentimiento y queda auditado como PLATAFORMA', async () => {
    const { service, audits } = makeSessions();
    const s = await service.open('p1', { accountId: 'acc-A', reason: 'ticket 123 cliente no ve su cartera', ticket: 'T-123', ttlMinutes: 60, permissions: [...READ, 'credit:write_off'] });
    assert.deepEqual(s.permissions.sort(), [...READ].sort(), 'el castigo de créditos no es de soporte');
    assert.equal(s.consentRequired, false);
    assert.equal(s.consentStatus, 'NOT_REQUIRED');
    assert.equal(audits[0]?.actorType, 'PLATFORM');
    assert.equal(audits[0]?.userId, null);
    assert.equal(audits[0]?.action, 'SUPPORT_SESSION_OPEN');
  });

  it('🔴 pedir escritura sensible deja la sesión PENDIENTE de consentimiento', async () => {
    const { service } = makeSessions();
    const s = await service.open('p1', { accountId: 'acc-A', reason: 'corregir el rol de un miembro', ttlMinutes: 30, permissions: [...READ, Permission.USER_WRITE] });
    assert.equal(s.consentRequired, true);
    assert.equal(s.consentStatus, 'PENDING');
    assert.equal(s.status, 'AWAITING_CONSENT');
  });

  const future = () => new Date(Date.now() + 3_600_000);
  const sensitive = (over: Record<string, unknown> = {}) => ({ id: 'ss1', accountId: 'acc-A', platformUserId: 'p1', permissions: [...READ, Permission.USER_WRITE], sensitive: true, consentStatus: 'GRANTED', expiresAt: future(), revokedAt: null, ...over });

  it('🔴 el token de soporte lleva la escritura sensible SOLO con consentimiento Y con SUPPORT_WRITE_ENABLED', async () => {
    const perms = async (row: Record<string, unknown>) => {
      const { service, signed } = makeSessions(row);
      await service.issueToken('p1', 'acc-A', 'ss1');
      return signed[0]!.permissions as string[];
    };
    process.env.SUPPORT_WRITE_ENABLED = 'true';
    assert.ok((await perms(sensitive())).includes(Permission.USER_WRITE), 'consentida y con el interruptor encendido');
    assert.ok(!(await perms(sensitive({ consentStatus: 'PENDING' }))).includes(Permission.USER_WRITE), 'sin consentimiento');
    assert.ok(!(await perms(sensitive({ consentStatus: 'DENIED' }))).includes(Permission.USER_WRITE), 'rechazada');
    delete process.env.SUPPORT_WRITE_ENABLED;
    assert.ok(!(await perms(sensitive())).includes(Permission.USER_WRITE), 'con el interruptor de escritura apagado');
    assert.ok((await perms(sensitive())).includes(Permission.CLIENT_READ), 'la lectura sí');
  });

  it('el token de soporte es de plataforma, de ESA cuenta y ligado a la sesión; vencida o revocada no da token', async () => {
    const { service, signed } = makeSessions(sensitive({ sensitive: false, consentStatus: 'NOT_REQUIRED', permissions: READ }));
    await service.issueToken('p1', 'acc-A', 'ss1');
    assert.equal(signed[0]!.actorType, 'PLATFORM');
    assert.equal(signed[0]!.accountId, 'acc-A');
    assert.equal(signed[0]!.supportSessionId, 'ss1');
    await assert.rejects(makeSessions(sensitive({ expiresAt: new Date(Date.now() - 1000) })).service.issueToken('p1', 'acc-A', 'ss1'), (e) => codeOf(e) === 'SUPPORT_004');
    await assert.rejects(makeSessions(sensitive({ revokedAt: new Date() })).service.issueToken('p1', 'acc-A', 'ss1'), (e) => codeOf(e) === 'SUPPORT_004');
    await assert.rejects(makeSessions(null).service.issueToken('p1', 'acc-A', 'ss1'), (e) => codeOf(e) === 'SUPPORT_001');
  });
});

// ── JwtAuthGuard · rama de plataforma ──────────────────────────────────────────────────────────────────────────────────────────
function guardWith(claims: Record<string, unknown>, opts: { method?: string; sessionActive?: boolean } = {}) {
  const token = { verifyAccess: () => claims };
  const prisma = { withSystemTenant: async (_a: string, fn: (t: unknown) => Promise<unknown>) => fn({ supportSession: { findFirst: async () => (opts.sessionActive === false ? null : { consentStatus: 'NOT_REQUIRED', sensitive: false }) } }) };
  const guard = new JwtAuthGuard(token as never, { isRevoked: async () => false } as never, { check: async () => 'ok' } as never, { authzVersionCheck: true } as never, new Reflector(), prisma as never);
  const req = { headers: { authorization: 'Bearer x' }, method: opts.method ?? 'GET' } as Record<string, unknown>;
  const ctx = { getHandler: () => function handler() {}, getClass: () => class C {}, switchToHttp: () => ({ getRequest: () => req }) };
  return { run: () => guard.canActivate(ctx as never), req };
}
const supportClaims = { sub: 'p1', accountId: 'acc-A', roleId: 'platform-support', permissions: READ, sessionId: 'support:ss1', actorType: 'PLATFORM', supportSessionId: 'ss1' };

describe('JwtAuthGuard · actor de plataforma (F14 · F5)', () => {
  it('🔴 con PLATFORM_ACCESS_ENABLED apagado (por omisión) ningún token de plataforma pasa', async () => {
    await assert.rejects(guardWith(supportClaims).run(), (e) => codeOf(e) === 'PLATFORM_DISABLED');
  });

  it('🔴 una sesión de soporte vigente lee; la ESCRITURA exige además SUPPORT_WRITE_ENABLED', async () => {
    process.env.PLATFORM_ACCESS_ENABLED = 'true';
    const read = guardWith(supportClaims);
    assert.equal(await read.run(), true);
    assert.equal((read.req.user as { actorType?: string }).actorType, 'PLATFORM');
    await assert.rejects(guardWith(supportClaims, { method: 'POST' }).run(), (e) => codeOf(e) === 'SUPPORT_WRITE_DISABLED');
    process.env.SUPPORT_WRITE_ENABLED = 'true';
    assert.equal(await guardWith(supportClaims, { method: 'POST' }).run(), true);
  });

  it('🔴 una sesión de soporte vencida o revocada se rechaza en la PRÓXIMA petición', async () => {
    process.env.PLATFORM_ACCESS_ENABLED = 'true';
    await assert.rejects(guardWith(supportClaims, { sessionActive: false }).run(), (e) => codeOf(e) === 'AUTH_003');
  });
});

describe('Invariante: nada de plataforma llega a un rol de empresa (F14 · F5)', () => {
  it('🔴 ningún permiso `platform:*` está en el enum de empresa ni en el mapa de ningún rol (los administradores reciben TODO el enum)', () => {
    assert.ok(Object.values(Permission).every((p) => !p.startsWith('platform:')));
    for (const role of Object.values(RoleType)) {
      assert.ok(ROLE_PERMISSIONS[role].every((p) => !p.startsWith('platform:')), role);
    }
  });

  it('la lista de permisos de plataforma es cerrada y todos llevan el prefijo `platform:`', () => {
    assert.deepEqual([...PLATFORM_PERMISSIONS].sort(), ['platform:accounts:read', 'platform:audit:read', 'platform:roles:rollout', 'platform:roles:write', 'platform:support:open']);
  });
});
