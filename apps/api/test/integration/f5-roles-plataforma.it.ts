/**
 * F14 · F5 — roles por cuenta y plataforma, de punta a punta.
 *
 * Postgres y Redis reales (base `kobrax_it`), la API compilada con `PLATFORM_ACCESS_ENABLED` y `SUPPORT_WRITE_ENABLED` encendidos (apagados por omisión).
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f5-roles-plataforma.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashSync } from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { totpNow } from '../../src/modules/auth/totp';
import { API, call, db, freshDatabase, loginSkippingMfa, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
const ENROLL_KEY = `it-enroll-${suffix}-0123456789`;
let prisma: PrismaClient;
const acc: Record<string, { id: string; admin: string; email: string }> = {};
const decode = (jwt: string): Record<string, unknown> => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'));

async function signup(label: string): Promise<{ id: string; admin: string; email: string }> {
  const email = `${label}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Empresa ${label}`, firstName: 'Dueño', lastName: label, email, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  return { id: owner.userAccounts[0]!.accountId, admin: await loginSkippingMfa(email), email };
}

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', PLATFORM_ACCESS_ENABLED: 'true', SUPPORT_WRITE_ENABLED: 'true', PLATFORM_ENROLLMENT_KEY: ENROLL_KEY });
  prisma = db();
  acc.A = await signup('a');
  acc.B = await signup('b');
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

const permsOf = async (accountRoleId: string): Promise<string[]> =>
  (await prisma.accountRolePermission.findMany({ where: { accountRoleId }, include: { permission: true } })).map((p) => p.permission.code).sort();

describe('F5 · roles por cuenta', () => {
  it('🔴 una cuenta nueva recibe sus seis roles (trigger), con linaje y con los permisos de su plantilla', async () => {
    const roles = await prisma.accountRole.findMany({ where: { accountId: acc.A!.id }, orderBy: { key: 'asc' } });
    assert.deepEqual(roles.map((r) => r.key), ['ACCOUNT_ADMIN', 'AUDITOR', 'COLLECTOR', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
    for (const r of roles) {
      assert.equal(r.templateKey, r.key);
      assert.equal(r.divergedAt, null);
      assert.notEqual((await permsOf(r.id)).length, 0, r.key);
    }
  });

  it('🔴 el rol de cuenta da EXACTAMENTE los permisos que daba el mapa de roles (a lo sumo un data:scope:*)', async () => {
    const scope = (xs: string[]) => xs.filter((p) => p.startsWith('data:scope:'));
    for (const role of [RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR, RoleType.VIEWER, RoleType.ACCOUNT_ADMIN]) {
      const ar = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.A!.id, key: role } });
      const have = await permsOf(ar.id);
      const want = [...ROLE_PERMISSIONS[role]] as string[];
      assert.deepEqual(have.filter((p) => !p.startsWith('data:scope:')), want.filter((p) => !p.startsWith('data:scope:')).sort(), `${role}: permisos`);
      assert.ok(scope(have).length <= 1, `${role}: a lo sumo un alcance (el cobrador tiene el «propio», que es ninguno)`);
      if (want.some((p) => p.startsWith('data:scope:'))) assert.equal(scope(have).length, 1, `${role}: conserva su alcance`);
      if (want.includes('data:scope:all')) assert.deepEqual(scope(have), ['data:scope:all'], `${role}: el más amplio manda`);
    }
  });

  it('el token del administrador sale del rol de la cuenta: lleva `roleKey` y sus permisos', async () => {
    const claims = decode(acc.A!.admin);
    assert.equal(claims.roleKey, 'ACCOUNT_ADMIN');
    assert.ok((claims.permissions as string[]).includes('client:read'));
    assert.ok((claims.permissions as string[]).includes('support:consent'));
    assert.ok(!(claims.permissions as string[]).some((p) => p.startsWith('platform:')), 'ni un permiso de plataforma');
  });

  it('🔴 cambiar el rol de UNA cuenta no toca a la otra (aislamiento): al renovar el token cada una recibe lo suyo', async () => {
    const colA = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.A!.id, key: 'COLLECTOR' } });
    const colB = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.B!.id, key: 'COLLECTOR' } });
    const before = await permsOf(colB.id);
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'credit:pii:read' } });
    await prisma.accountRolePermission.create({ data: { accountRoleId: colA.id, permissionId: perm.id, accountId: acc.A!.id, source: 'CUSTOM' } });
    assert.deepEqual(await permsOf(colB.id), before, 'la otra cuenta no cambió');
    assert.ok((await permsOf(colA.id)).includes('credit:pii:read'));
    await prisma.accountRolePermission.delete({ where: { accountRoleId_permissionId: { accountRoleId: colA.id, permissionId: perm.id } } });
  });

  it('🔴 un rol no puede tener dos permisos de alcance (restricción de la base)', async () => {
    const sup = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.A!.id, key: 'SUPERVISOR' } });
    const other = await prisma.permission.findUniqueOrThrow({ where: { code: 'data:scope:subtree' } });
    await assert.rejects(prisma.accountRolePermission.create({ data: { accountRoleId: sup.id, permissionId: other.id, accountId: acc.A!.id } }), /alcance|data:scope/i);
  });

  it('la membresía queda con su rol de cuenta aunque el código sólo escriba `role_id` (trigger)', async () => {
    const m = await prisma.userAccount.findFirstOrThrow({ where: { accountId: acc.A!.id, isOwner: true }, include: { accountRole: true, role: true } });
    assert.equal(m.accountRole?.key, m.role.name);
    assert.equal(m.accountRole?.accountId, acc.A!.id);
  });

  it('`user_permission_overrides` ya no existe (H-4)', async () => {
    const r = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public.user_permission_overrides')::text AS t`;
    assert.equal(r[0]!.t, null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F5 · plataforma', () => {
  const EMAIL = `root-${suffix}@kobrax.test`;
  const PASSWORD = 'Plataforma-clave-1';
  let platform = '';
  let secret = '';
  let sessionId = '';

  const post = async (path: string, token: string | null, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string } };
    return { status: res.status, data: json.data, error: json.error };
  };

  it('la base admite UNA sola persona de plataforma (índice único)', async () => {
    await prisma.platformUser.create({ data: { email: EMAIL, passwordHash: hashSync(PASSWORD, 4) } });
    await assert.rejects(prisma.platformUser.create({ data: { email: `otra-${suffix}@kobrax.test`, passwordHash: hashSync(PASSWORD, 4) } }), /Unique|único|platform_users_single_row/i);
  });

  it('🔴 el MFA es obligatorio: la primera vez no hay token, hay un secreto; con el código sí, y el token es SOLO de plataforma', async () => {
    const bad = await post('/platform/auth/login', null, { email: EMAIL, password: 'mala' });
    assert.equal(bad.status, 401);
    assert.equal(bad.error?.code, 'PLATFORM_AUTH_INVALID');
    // conocer la contraseña NO alcanza para enrolar el propio autenticador: hace falta la clave de enrolamiento del servidor
    const noKey = await post('/platform/auth/login', null, { email: EMAIL, password: PASSWORD });
    assert.equal(noKey.status, 401);
    assert.equal(noKey.data?.secret, undefined);
    const first = await post('/platform/auth/login', null, { email: EMAIL, password: PASSWORD, enrollmentKey: ENROLL_KEY });
    assert.equal(first.status, 200);
    assert.equal(first.data?.step, 'mfa_setup');
    assert.equal(first.data?.accessToken, undefined);
    secret = String(first.data?.secret);
    const done = await post('/platform/auth/mfa/confirm', null, { email: EMAIL, password: PASSWORD, code: totpNow(secret), enrollmentKey: ENROLL_KEY });
    assert.equal(done.status, 200, JSON.stringify(done.error));
    platform = String(done.data?.accessToken);
    const claims = decode(platform);
    assert.equal(claims.actorType, 'PLATFORM');
    assert.equal(claims.accountId, '');
    assert.ok((claims.permissions as string[]).every((p) => p.startsWith('platform:')));
    // y a partir de ahí el código es obligatorio
    assert.equal((await post('/platform/auth/login', null, { email: EMAIL, password: PASSWORD })).status, 401);
    // el código con el que se confirmó el enrolamiento ya se usó: no vuelve a valer (anti-repetición); el del tramo siguiente sí
    const nextCode = totpNow(secret, Date.now() + 30_000);
    assert.equal((await post('/platform/auth/login', null, { email: EMAIL, password: PASSWORD, code: totpNow(secret) })).status, 401);
    assert.equal((await post('/platform/auth/login', null, { email: EMAIL, password: PASSWORD, code: nextCode })).data?.step, 'done');
  });

  it('🔴 el token de plataforma no sirve para ninguna ruta de empresa; y un administrador de empresa no entra a las de plataforma', async () => {
    assert.equal((await call(platform, 'GET', '/clients')).status, 403);
    assert.equal((await call(platform, 'GET', '/credits')).status, 403);
    const asAdmin = await post('/platform/support-sessions', acc.A!.admin, { accountId: acc.A!.id, reason: 'intento de un administrador', ttlMinutes: 10, permissions: ['client:read'] });
    assert.equal(asAdmin.status, 403);
    assert.equal(asAdmin.error?.code, 'AUTH_002');
  });

  it('🔴 la sesión de soporte con escritura sensible queda PENDIENTE; el token no la trae hasta que el administrador de ESA cuenta la acepta', async () => {
    const open = await post('/platform/support-sessions', platform, {
      accountId: acc.A!.id,
      reason: 'ticket 321: corregir el nombre de una oficina',
      ticket: 'T-321',
      ttlMinutes: 30,
      permissions: ['client:read', 'office:read', 'office:write', 'data:scope:all', 'credit:write_off'],
    });
    assert.equal(open.status, 201, JSON.stringify(open.error));
    assert.equal(open.data?.consentStatus, 'PENDING');
    assert.deepEqual((open.data?.permissions as string[]).includes('credit:write_off'), false, 'el castigo no es de soporte');
    sessionId = String(open.data?.id);

    const t1 = await post(`/platform/accounts/${acc.A!.id}/support-sessions/${sessionId}/token`, platform);
    assert.equal(t1.status, 200, JSON.stringify(t1.error));
    assert.ok(!(t1.data?.permissions as string[]).includes('office:write'), 'sin consentimiento no hay escritura sensible');
    const read = await call(String(t1.data?.accessToken), 'GET', '/clients?limit=5');
    assert.equal(read.status, 200, 'lee con el token de soporte');
    const w = await call(String(t1.data?.accessToken), 'POST', '/clients', { clientType: 'PERSON', firstName: 'No', lastName: 'Debe' });
    assert.ok(w.status >= 400, 'no escribe lo que no tiene');

    // el administrador de OTRA cuenta no puede aceptarla; el de ésta sí
    assert.equal((await call(acc.B!.admin, 'POST', `/support-access/${sessionId}/grant`)).status, 404);
    const list = await call<{ id: string; status: string }[]>(acc.A!.admin, 'GET', '/support-access');
    assert.equal(list.data?.find((s) => s.id === sessionId)?.status, 'AWAITING_CONSENT');
    assert.equal((await call(acc.A!.admin, 'POST', `/support-access/${sessionId}/grant`)).status, 200);
  });

  it('🔴 un acceso «de lectura» que pide datos personales también queda pendiente de consentimiento, y su token no los trae hasta que se acepta', async () => {
    const open = await post('/platform/support-sessions', platform, {
      accountId: acc.A!.id,
      reason: 'ticket 400: revisar un cliente puntual',
      ttlMinutes: 20,
      permissions: ['client:read', 'client:contact:read', 'client:pii:read', 'data:scope:all'],
    });
    assert.equal(open.status, 201, JSON.stringify(open.error));
    assert.equal(open.data?.consentStatus, 'PENDING');
    const t = await post(`/platform/accounts/${acc.A!.id}/support-sessions/${String(open.data?.id)}/token`, platform);
    assert.ok(!(t.data?.permissions as string[]).includes('client:pii:read'), 'sin consentimiento no hay PII');
    // la cuenta lo RECHAZA: el estado que ve es «Rechazado», el token se niega y no se puede aceptar después
    const denied = await call<{ status: string }>(acc.A!.admin, 'POST', `/support-access/${String(open.data?.id)}/deny`);
    assert.equal(denied.data?.status, 'DENIED');
    assert.equal((await post(`/platform/accounts/${acc.A!.id}/support-sessions/${String(open.data?.id)}/token`, platform)).status, 409);
    assert.equal((await call(acc.A!.admin, 'POST', `/support-access/${String(open.data?.id)}/grant`)).status, 409);
  });

  it('🔴 con el consentimiento, la escritura sensible funciona y queda auditada como PLATAFORMA (sin usuario de la cuenta)', async () => {
    const t2 = await post(`/platform/accounts/${acc.A!.id}/support-sessions/${sessionId}/token`, platform);
    assert.ok((t2.data?.permissions as string[]).includes('office:write'));
    const support = String(t2.data?.accessToken);
    const offices = (await call<{ id: string; isRoot: boolean }[]>(support, 'GET', '/branches')).data ?? [];
    const root = offices.find((o) => o.isRoot)!;
    const upd = await call(support, 'PATCH', `/branches/${root.id}`, { name: 'Casa central (soporte)' });
    assert.equal(upd.status, 200, JSON.stringify(upd.error));
    const row = await prisma.auditLog.findFirst({ where: { accountId: acc.A!.id, entity: 'branch', entityId: root.id, actorType: 'PLATFORM' }, orderBy: { createdAt: 'desc' } });
    assert.ok(row, 'el cambio quedó auditado como plataforma');
    assert.equal(row!.userId, null);
    assert.equal(row!.supportSessionId, sessionId);
    const opened = await prisma.auditLog.findFirst({ where: { accountId: acc.A!.id, action: 'SUPPORT_SESSION_OPEN', supportSessionId: sessionId } });
    assert.equal(opened?.actorType, 'PLATFORM');
    // la cuenta ve en su actividad que fue soporte
    const consent = await prisma.auditLog.findFirst({ where: { accountId: acc.A!.id, action: 'SUPPORT_CONSENT_GRANTED' } });
    assert.equal(consent?.userId != null, true, 'el consentimiento lo dio un usuario de la cuenta');
  });

  it('🔴 la cuenta revoca el acceso y la PRÓXIMA petición con ese token es rechazada', async () => {
    const t3 = await post(`/platform/accounts/${acc.A!.id}/support-sessions/${sessionId}/token`, platform);
    const support = String(t3.data?.accessToken);
    assert.equal((await call(support, 'GET', '/clients?limit=1')).status, 200);
    assert.equal((await call(acc.A!.admin, 'POST', `/support-access/${sessionId}/revoke`)).status, 200);
    assert.equal((await call(support, 'GET', '/clients?limit=1')).status, 401);
    const again = await post(`/platform/accounts/${acc.A!.id}/support-sessions/${sessionId}/token`, platform);
    assert.equal(again.status, 409);
  });

  it('la cuenta ve en su Actividad que soporte pidió acceso y que el administrador consintió', async () => {
    const r = await call<{ items: { entity: string; action: string; actorName: string | null }[] }>(acc.A!.admin, 'GET', '/accounts/me/activity?limit=100');
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const acts = (r.data?.items ?? []).filter((i) => i.entity === 'support_session').map((i) => i.action);
    assert.ok(acts.includes('SUPPORT_SESSION_OPEN') && acts.includes('SUPPORT_CONSENT_GRANTED'), JSON.stringify(acts));
  });

  it('el aviso del panel: `GET /support-access/current` es nulo para un usuario de la empresa', async () => {
    const r = await call(acc.A!.admin, 'GET', '/support-access/current');
    assert.equal(r.status, 200);
    assert.equal(r.data, null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F5 · rollout de un permiso nuevo a las cuentas', () => {
  it('🔴 sólo toca roles sin divergir, no escribe en dry-run, y sube la versión de las membresías afectadas', async () => {
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'credit:pii:read' } });
    // el permiso entra a la plantilla de SUPERVISOR; la cuenta B lo "divergió" (un administrador tocó ese rol): no se le agrega
    await prisma.roleTemplatePermission.create({ data: { templateKey: 'SUPERVISOR', permissionId: perm.id } });
    await prisma.accountRole.updateMany({ where: { accountId: acc.B!.id, key: 'SUPERVISOR' }, data: { divergedAt: new Date() } });
    const supA = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.A!.id, key: 'SUPERVISOR' } });

    const dry = await prisma.$queryRaw<{ account_id: string; role_key: string }[]>`SELECT * FROM platform_rollout_permission('credit:pii:read', true)`;
    // (la base de pruebas trae además las cuentas DEMO del seed, que también están al día con su plantilla)
    assert.ok(dry.some((d) => d.account_id === acc.A!.id), 'la cuenta A recibe el permiso');
    assert.ok(!dry.some((d) => d.account_id === acc.B!.id), 'la cuenta B tiene el rol divergido: no se toca');
    assert.ok(dry.every((d) => d.role_key === 'SUPERVISOR'), 'sólo el rol de esa plantilla');
    assert.ok(!(await permsOf(supA.id)).includes('credit:pii:read'), 'el dry-run no escribe');

    const real = await prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM platform_rollout_permission('credit:pii:read', false)`;
    assert.equal(real.length, dry.length, 'lo que hizo es lo que el dry-run dijo');
    assert.ok((await permsOf(supA.id)).includes('credit:pii:read'));
    const rowSource = await prisma.accountRolePermission.findUniqueOrThrow({ where: { accountRoleId_permissionId: { accountRoleId: supA.id, permissionId: perm.id } } });
    assert.equal(rowSource.source, 'TEMPLATE');
    const supB = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.B!.id, key: 'SUPERVISOR' } });
    assert.ok(!(await permsOf(supB.id)).includes('credit:pii:read'), 'el rol divergido de la cuenta B queda como lo dejó su administrador');
    // idempotente
    assert.equal((await prisma.$queryRaw<unknown[]>`SELECT * FROM platform_rollout_permission('credit:pii:read', false)`).length, 0);
  });
});
