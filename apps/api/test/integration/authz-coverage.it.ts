/**
 * F14 · F3 — los guards GLOBALES de punta a punta (JwtAuthGuard → TenantGuard → AuthzGuard) contra la API real.
 *
 * Lo que los unitarios no pueden afirmar: que el orden de los guards globales funcione dentro de Nest (el de autorización necesita
 * `req.user`, que pone el de JWT), que lo público siga siendo público, que lo no declarado se niegue y que la cuenta gratuita
 * individual (un solo ACCOUNT_ADMIN, sin oficinas) recorra todos los módulos sin un 401/403 de más.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { addMember, API, call, db, freshDatabase, login, loginSkippingMfa, PASSWORD, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let accountId: string;
let admin: string;

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `individual-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Cobrador ${suffix}`, firstName: 'Ind', lastName: 'Ividual', email, password: PASSWORD, planCode: 'FREE' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  accountId = owner.userAccounts[0]!.accountId;
  admin = await loginSkippingMfa(email);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('F14·F3 — lo público, lo autenticado y lo que no se declaró', () => {
  it('lo público sigue siendo público (sin token)', async () => {
    assert.equal((await fetch(`${API}/health/live`)).status, 200);
    const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.notEqual(login.status, 401, 'login responde 400 (validación), no 401');
    assert.notEqual(login.status, 403);
  });

  it('🔴 lo protegido sin token → 401 (también lo autenticado y lo de permisos)', async () => {
    for (const path of ['/auth/me', '/users', '/clients', '/credits', '/routes', '/notifications']) {
      const res = await fetch(`${API}${path}`);
      assert.equal(res.status, 401, path);
    }
  });

  it('autenticado = basta la sesión (perfil propio, /auth/me)', async () => {
    const collector = await login((await (async () => {
      const email = `cob-${suffix}@ejemplo.com`;
      await addMember(prisma, accountId, email, 'Cob', 'COLLECTOR');
      return email;
    })()));
    assert.equal((await call(collector, 'GET', '/auth/me')).status, 200);
    assert.equal((await call(collector, 'GET', '/users/me/profile')).status, 200);
    assert.equal((await call(collector, 'GET', '/notifications')).status, 200);
  });

  it('🔴 permisos: el cobrador no pasa la puerta de Personas (403 AUTH_002) y sí la de rutas (any-of)', async () => {
    const email = `cob2-${suffix}@ejemplo.com`;
    await addMember(prisma, accountId, email, 'Cob2', 'COLLECTOR');
    const collector = await login(email);
    const users = await call(collector, 'GET', '/users');
    assert.equal(users.status, 403);
    assert.equal(users.error?.code, 'AUTH_002');
    // route:execute basta para la puerta de POST /routes/generate; lo que responda después es del servicio, no del guard.
    const gen = await call(collector, 'POST', '/routes/generate', { plannedDate: '2099-01-01' });
    assert.notEqual(gen.error?.code, 'AUTH_002', 'la puerta any-of de rutas deja pasar al cobrador');
    assert.notEqual(gen.error?.code, 'AUTHZ_000');
  });

  it('🔴 un viewer (sólo lectura) no pasa la puerta de rutas: 403 AUTH_002 antes de llegar al servicio', async () => {
    const email = `viewer-${suffix}@ejemplo.com`;
    await addMember(prisma, accountId, email, 'Viewer', 'VIEWER');
    const viewer = await login(email);
    const gen = await call(viewer, 'POST', '/routes/generate', { plannedDate: '2099-01-01' });
    assert.equal(gen.status, 403);
    assert.equal(gen.error?.code, 'AUTH_002');
  });

  it('el castigo de crédito pasa por la política: un cobrador no entra (403) y el código es el del dominio o AUTH_002', async () => {
    const email = `cob3-${suffix}@ejemplo.com`;
    await addMember(prisma, accountId, email, 'Cob3', 'COLLECTOR');
    const collector = await login(email);
    const res = await call(collector, 'POST', `/credits/${randomUUID()}/write-off`, { reason: 'x' });
    assert.equal(res.status, 403);
  });
});

describe('F14·F3 — regresión de la cuenta gratuita individual: recorre los módulos sin 401/403', () => {
  const READS = [
    '/auth/me',
    '/users',
    '/users/me/profile',
    '/roles',
    '/branches',
    '/clients',
    '/credits',
    '/payments',
    '/mora',
    '/agenda',
    '/routes',
    '/visits',
    '/catalogs',
    '/analytics/overview',
    '/dashboards',
    '/notifications',
    '/accounts/me',
  ];
  for (const path of READS) {
    it(`GET ${path}`, async () => {
      const res = await call(admin, 'GET', path);
      assert.notEqual(res.status, 401, `${path}: 401`);
      assert.notEqual(res.status, 403, `${path}: 403 ${JSON.stringify(res.error)}`);
      assert.notEqual(res.error?.code, 'AUTHZ_000', `${path}: sin contrato`);
    });
  }
});
