/**
 * F14 · F1 — versiones de autorización y alcance de Personas, de punta a punta (R-01, R-02, H-2).
 *
 * API compilada + Postgres y Redis reales (base `kobrax_it`). Lo que los unitarios no pueden afirmar: que el cambio de rol / estado
 * invalide el token VIVO en la siguiente petición (401 AUTHZ_STALE), que el refresh reconstruya los permisos desde la fuente, que
 * la desactivación cierre la sesión y que `GET /users` respete la oficina de quien pregunta.
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

interface Pair {
  accessToken: string;
  refreshToken: string;
}

async function loginPair(email: string): Promise<Pair> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await res.json()) as { data?: Pair & { step: string } };
  assert.equal(body.data?.step, 'done', JSON.stringify(body));
  return { accessToken: body.data!.accessToken, refreshToken: body.data!.refreshToken };
}

async function refresh(refreshToken: string): Promise<{ status: number; pair?: Pair }> {
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: Pair };
  return { status: res.status, pair: body.data };
}

const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { av: number; pv: number; permissions: string[] };

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Cobranzas ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
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

describe('F14·F1 — el token vivo deja de valer cuando cambia la autorización', () => {
  it('el token nuevo trae av y pv, y la API lo acepta', async () => {
    const email = `cob1-${suffix}@ejemplo.com`;
    await addMember(prisma, accountId, email, 'Cob1', 'COLLECTOR');
    const { accessToken } = await loginPair(email);
    const c = claimsOf(accessToken);
    assert.equal(typeof c.av, 'number');
    assert.equal(typeof c.pv, 'number');
    assert.equal((await call(accessToken, 'GET', '/users/me/profile')).status, 200);
  });

  it('🔴 cambio de rol: el access viejo recibe 401 AUTHZ_STALE al instante; el refresh trae los permisos nuevos y funciona', async () => {
    const email = `cob2-${suffix}@ejemplo.com`;
    const userId = await addMember(prisma, accountId, email, 'Cob2', 'COLLECTOR');
    const old = await loginPair(email);
    const supervisor = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPERVISOR' } });

    const patched = await call(admin, 'PATCH', `/users/${userId}`, { roleId: supervisor.id });
    assert.equal(patched.status, 200, JSON.stringify(patched.error));

    const stale = await call(old.accessToken, 'GET', '/users/me/profile');
    assert.equal(stale.status, 401);
    assert.equal(stale.error?.code, 'AUTHZ_STALE');

    const renewed = await refresh(old.refreshToken);
    assert.equal(renewed.status, 200);
    const fresh = claimsOf(renewed.pair!.accessToken);
    assert.ok(fresh.av > claimsOf(old.accessToken).av, 'av sube con el cambio');
    assert.ok(fresh.permissions.includes('data:scope:branch'), 'los permisos salen del rol NUEVO, no del token viejo');
    assert.equal((await call(renewed.pair!.accessToken, 'GET', '/users/me/profile')).status, 200);
  });

  it('🔴 desactivar la membresía: el token viejo muere y el refresh ya no sirve', async () => {
    const email = `cob3-${suffix}@ejemplo.com`;
    const userId = await addMember(prisma, accountId, email, 'Cob3', 'COLLECTOR');
    const old = await loginPair(email);

    const patched = await call(admin, 'PATCH', `/users/${userId}`, { isActive: false });
    assert.equal(patched.status, 200, JSON.stringify(patched.error));

    const res = await call(old.accessToken, 'GET', '/users/me/profile');
    assert.equal(res.status, 401);
    assert.notEqual((await refresh(old.refreshToken)).status, 200);
  });

  it('cerrar las sesiones de un miembro (user:sessions:revoke): su token deja de valer y queda auditado', async () => {
    const email = `cob4-${suffix}@ejemplo.com`;
    const userId = await addMember(prisma, accountId, email, 'Cob4', 'COLLECTOR');
    const old = await loginPair(email);

    const r = await call<{ sessions: number }>(admin, 'POST', `/users/${userId}/sessions/revoke`);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.ok(r.data!.sessions >= 1);
    assert.equal((await call(old.accessToken, 'GET', '/users/me/profile')).status, 401);
    const audited = await prisma.auditLog.count({ where: { accountId, action: 'SESSION_REVOKE', after: { path: ['reason'], equals: 'ADMIN_REQUEST' } } });
    assert.ok(audited >= 1);
  });

  it('un token anterior a F1 (sin av/pv) se trata como obsoleto una vez: AUTHZ_STALE, no 500', async () => {
    const jwt = await import('@nestjs/jwt');
    const secret = process.env.JWT_SECRET ?? (await import('node:fs')).readFileSync('../../.env', 'utf8').match(/JWT_SECRET="?([^"\r\n]+)/)?.[1];
    assert.ok(secret, 'JWT_SECRET para firmar el token de prueba');
    const email = `cob5-${suffix}@ejemplo.com`;
    const userId = await addMember(prisma, accountId, email, 'Cob5', 'COLLECTOR');
    const legacy = new jwt.JwtService({}).sign(
      { sub: userId, accountId, roleId: 'x', permissions: [], sessionId: randomUUID(), type: 'access' },
      { secret, expiresIn: '5m' },
    );
    const res = await call(legacy, 'GET', '/users/me/profile');
    assert.equal(res.status, 401);
    assert.equal(res.error?.code, 'AUTHZ_STALE');
  });
});

describe('F14·F1 — R-02: Personas respeta la oficina de quien pregunta', () => {
  it('el gerente de una regional no ve a las personas de otra; el administrador ve a todos', async () => {
    const types = (await call<{ id: string; code: string }[]>(admin, 'GET', '/branch-types')).data!;
    const tipo = Object.fromEntries(types.map((t) => [t.code, t.id]));
    const offices = (await call<{ id: string; isRoot: boolean }[]>(admin, 'GET', '/branches')).data!;
    const root = offices.find((o) => o.isRoot)!;
    const mk = async (name: string) => {
      const r = await call<{ id: string }>(admin, 'POST', '/branches', { name, parentId: root.id, typeId: tipo.REGIONAL });
      assert.equal(r.status, 201, JSON.stringify(r.error));
      return r.data!;
    };
    const regA = await mk(`Regional A ${suffix}`);
    const regB = await mk(`Regional B ${suffix}`);

    const place = async (key: string, role: string, office: { id: string }) => {
      const email = `${key.toLowerCase()}-${suffix}@ejemplo.com`;
      const id = await addMember(prisma, accountId, email, key, role);
      const r = await call(admin, 'POST', `/branches/${office.id}/members`, { userIds: [id] });
      assert.equal(r.status, 200, JSON.stringify(r.error));
      return { id, email };
    };
    const mgrA = await place('mgrA', 'MANAGER', regA);
    const colA = await place('colA', 'COLLECTOR', regA);
    const colB = await place('colB', 'COLLECTOR', regB);

    const token = await login(mgrA.email);
    const list = await call<{ userId: string }[]>(token, 'GET', '/users');
    assert.equal(list.status, 200, JSON.stringify(list.error));
    const seen = new Set(list.data!.map((m) => m.userId));
    assert.ok(seen.has(mgrA.id), 'se ve a sí mismo');
    assert.ok(seen.has(colA.id), 've a su regional');
    assert.ok(!seen.has(colB.id), 'NO ve a la otra regional');
    assert.equal((await call(token, 'GET', `/users/${colB.id}`)).status, 404, 'el detalle de otra regional es 404');

    const all = await call<{ userId: string }[]>(admin, 'GET', '/users');
    const adminSees = new Set(all.data!.map((m) => m.userId));
    assert.ok(adminSees.has(colA.id) && adminSees.has(colB.id), 'el administrador ve a todos');
  });
});
