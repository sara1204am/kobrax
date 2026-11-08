/**
 * F14 · F8 — la API que sostiene a la app móvil, de punta a punta.
 *
 * Postgres y Redis reales (base `kobrax_it`), la API compilada y `PII_MOBILE_MASK=on` (el interruptor de F4, apagado por omisión).
 * Cubre: roles fuera del móvil (D-3), canal fijado en la sesión (D-5), contactos en claro y documento enmascarado (D-4), `/auth/me` con
 * oficinas y cuenta de una persona (D-2, D-7) y el rechazo de un documento enmascarado al guardar.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f8-movil.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { MeInfo } from '@kobrax/shared';
import { API, PASSWORD, addMember, call, db, freshDatabase, resetRateLimits, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let accountId = '';
const email = (label: string) => `${label}-${suffix}@ejemplo.com`;

interface Session {
  status: number;
  code?: string;
  access?: string;
  refresh?: string;
}

const decode = (jwt: string): Record<string, unknown> => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'));

/** Inicia sesión DECLARANDO el dispositivo (`x-client-type`), con el paso de «postergar MFA» para los roles críticos. */
async function loginAs(who: string, device: 'mobile' | 'web' | 'api'): Promise<Session> {
  // Esta suite inicia sesión muchas veces desde la misma IP: el límite de intentos del login no es lo que se prueba acá.
  resetRateLimits();
  const headers = { 'Content-Type': 'application/json', 'x-client-type': device };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { data?: { step?: string; accessToken?: string; refreshToken?: string; preAuthToken?: string }; error?: { code?: string } } };
  };
  let r = await post('/auth/login', { email: email(who), password: PASSWORD });
  if (r.body.data?.step === 'mfa_setup' && r.body.data.preAuthToken) r = await post('/auth/mfa/setup/skip', { preAuthToken: r.body.data.preAuthToken });
  return { status: r.status, code: r.body.error?.code, access: r.body.data?.accessToken, refresh: r.body.data?.refreshToken };
}

async function refresh(refreshToken: string, device: string): Promise<Session> {
  const res = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-type': device }, body: JSON.stringify({ refreshToken }) });
  const body = (await res.json().catch(() => ({}))) as { data?: { accessToken?: string; refreshToken?: string }; error?: { code?: string } };
  return { status: res.status, code: body.error?.code, access: body.data?.accessToken, refresh: body.data?.refreshToken };
}

async function signup(label: string): Promise<string> {
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Empresa ${label}`, firstName: 'Dueño', lastName: label, email: email(label), password: PASSWORD }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: email(label) }, include: { userAccounts: true } });
  return owner.userAccounts[0]!.accountId;
}

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', PII_MOBILE_MASK: 'on' });
  prisma = db();
  accountId = await signup('empresa');
  await addMember(prisma, accountId, email('cobrador'), 'Cobrador', 'COLLECTOR');
  await addMember(prisma, accountId, email('supervisor'), 'Supervisor', 'SUPERVISOR');
  await addMember(prisma, accountId, email('auditor'), 'Auditor', 'AUDITOR');
  await addMember(prisma, accountId, email('consulta'), 'Consulta', 'VIEWER');
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('F8 · roles de campo y el canal móvil (D-3)', () => {
  it('🔴 un auditor y una persona de consulta NO inician sesión desde la app: 403 MOBILE_ROLE_NOT_ALLOWED', async () => {
    for (const who of ['auditor', 'consulta']) {
      const s = await loginAs(who, 'mobile');
      assert.equal(s.status, 403, who);
      assert.equal(s.code, 'MOBILE_ROLE_NOT_ALLOWED', who);
      assert.equal(s.access, undefined);
    }
  });

  it('🔴 «Mobile» o «MOBILE» en el encabezado tampoco abre la puerta al auditor', async () => {
    for (const device of ['Mobile', 'MOBILE'] as const) {
      const s = await loginAs('auditor', device as never);
      assert.equal(s.status, 403, device);
      assert.equal(s.code, 'MOBILE_ROLE_NOT_ALLOWED', device);
    }
  });

  it('los mismos roles entran por la web con normalidad', async () => {
    for (const who of ['auditor', 'consulta']) assert.equal((await loginAs(who, 'web')).status, 200, who);
  });

  it('los roles de campo (administrador, supervisor, cobrador) entran por el móvil', async () => {
    for (const who of ['empresa', 'supervisor', 'cobrador']) {
      const s = await loginAs(who, 'mobile');
      assert.equal(s.status, 200, `${who}: ${s.code}`);
      assert.ok(s.access);
    }
  });

  it('🔴 quien pasa a un rol fuera del móvil pierde la sesión de la app en su PRÓXIMO refresco (y la sesión queda cerrada)', async () => {
    const s = await loginAs('supervisor', 'mobile');
    assert.equal(s.status, 200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email('supervisor') } });
    const auditor = await prisma.role.findUniqueOrThrow({ where: { name: 'AUDITOR' } });
    const auditorRole = await prisma.accountRole.findFirstOrThrow({ where: { accountId, key: 'AUDITOR' } });
    await prisma.userAccount.updateMany({ where: { userId: user.id, accountId }, data: { roleId: auditor.id, accountRoleId: auditorRole.id } });

    const r = await refresh(s.refresh!, 'mobile');
    assert.equal(r.status, 403);
    assert.equal(r.code, 'MOBILE_ROLE_NOT_ALLOWED');
    // La sesión quedó cerrada: ni el refresh ni el access sirven ya.
    assert.equal((await refresh(s.refresh!, 'mobile')).status >= 400, true);
    const sessionId = String(decode(s.access!).sessionId);
    const row = await prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.equal(row.isActive, false);
  });
});

describe('F8 · el canal sale de la SESIÓN, no del encabezado (D-5)', () => {
  it('🔴 el token lleva `ch` con el dispositivo declarado al iniciar la sesión', async () => {
    assert.equal(decode((await loginAs('cobrador', 'mobile')).access!).ch, 'mobile');
    assert.equal(decode((await loginAs('cobrador', 'web')).access!).ch, 'web');
  });

  it('🔴 el refresco CONSERVA el canal aunque el encabezado diga otra cosa (un token del móvil no se hace pasar por la web)', async () => {
    const s = await loginAs('cobrador', 'mobile');
    const r = await refresh(s.refresh!, 'web');
    assert.equal(r.status, 200, r.code);
    assert.equal(decode(r.access!).ch, 'mobile');
  });
});

describe('F8 · contactos en claro, documento enmascarado (D-4)', () => {
  let admin = '';
  let adminWeb = '';
  let clientId = '';

  before(async () => {
    admin = (await loginAs('empresa', 'mobile')).access!;
    adminWeb = (await loginAs('empresa', 'web')).access!;
    const c = await call<{ id: string }>(adminWeb, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Marta', lastName: 'Cliente', nationalId: '5551234' });
    assert.equal(c.status, 201, JSON.stringify(c.error));
    clientId = c.data!.id;
    const phone = await call(adminWeb, 'POST', `/clients/${clientId}/contacts`, { contactType: 'PHONE', value: '70011223', isPrimary: true });
    assert.equal(phone.status, 201, JSON.stringify(phone.error));
  });

  const view = (token: string, extra: Record<string, string> = {}) =>
    fetch(`${API}/clients/${clientId}?reveal=true`, { headers: { Authorization: `Bearer ${token}`, ...extra } }).then(async (r) => ({
      status: r.status,
      data: ((await r.json()) as { data?: { nationalId?: string; contacts?: { value: string }[] } }).data,
    }));

  it('🔴 desde el móvil `?reveal=true` NO da 403: devuelve el teléfono en claro y el documento ENMASCARADO', async () => {
    const r = await view(admin);
    assert.equal(r.status, 200);
    assert.equal(r.data?.contacts?.[0]?.value, '70011223');
    assert.ok(r.data?.nationalId?.includes('*'), `documento enmascarado: ${r.data?.nationalId}`);
    assert.notEqual(r.data?.nationalId, '5551234');
  });

  it('🔴 un token del móvil que declara ser «web» en la petición SIGUE enmascarado (el canal es el de la sesión)', async () => {
    const r = await view(admin, { 'x-client-type': 'web' });
    assert.equal(r.status, 200);
    assert.ok(r.data?.nationalId?.includes('*'));
  });

  it('por la web el documento sigue en claro (como siempre)', async () => {
    const r = await view(adminWeb);
    assert.equal(r.data?.nationalId, '5551234');
  });

  it('el revelado de contactos desde el móvil queda auditado (categorías y canal, nunca valores)', async () => {
    const rows = await prisma.auditLog.findMany({ where: { accountId, entity: 'client', entityId: clientId, action: 'PII_REVEAL' }, orderBy: { createdAt: 'desc' }, take: 5 });
    assert.ok(rows.length >= 1);
    assert.ok(!JSON.stringify(rows.map((r) => r.after)).includes('70011223'), 'ningún valor en el rastro');
  });

  it('la persona de consulta (web) sigue sin poder revelar: 403 PII_REVEAL_DENIED', async () => {
    const viewer = (await loginAs('consulta', 'web')).access!;
    const r = await call(viewer, 'GET', `/clients/${clientId}?reveal=true`);
    assert.equal(r.status, 403);
    assert.equal(r.error?.code, 'PII_REVEAL_DENIED');
  });

  it('🔴 guardar un documento ENMASCARADO se rechaza (422): no pisa el documento real', async () => {
    const patch = await call(admin, 'PATCH', `/clients/${clientId}`, { nationalId: '55512***' });
    assert.equal(patch.status, 422);
    assert.equal(patch.error?.code, 'CLIENT_DOCUMENT_MASKED');
    const create = await call(adminWeb, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Otra', lastName: 'Persona', nationalId: '12345***' });
    assert.equal(create.status, 422);
    assert.equal(create.error?.code, 'CLIENT_DOCUMENT_MASKED');
    assert.equal((await view(adminWeb)).data?.nationalId, '5551234', 'el documento real no cambió');
  });

  it('🔴 el RUC (taxId) enmascarado tampoco se guarda: 422', async () => {
    const patch = await call(admin, 'PATCH', `/clients/${clientId}`, { taxId: '12345***' });
    assert.equal(patch.status, 422);
    assert.equal(patch.error?.code, 'CLIENT_DOCUMENT_MASKED');
  });

  it('editar otros campos desde el móvil sin tocar el documento funciona', async () => {
    const patch = await call(admin, 'PATCH', `/clients/${clientId}`, { firstName: 'Marta Elena' });
    assert.equal(patch.status, 200, JSON.stringify(patch.error));
  });
});

describe('F8 · `/auth/me` informa las oficinas y si la cuenta es de una persona (D-2, D-7)', () => {
  it('la cuenta del cobrador independiente (una sola persona) es `soloUser`; una empresa con equipo no', async () => {
    await signup('independiente');
    const solo = (await loginAs('independiente', 'mobile')).access!;
    const meSolo = await call<MeInfo>(solo, 'GET', '/auth/me');
    assert.equal(meSolo.data?.account?.soloUser, true);
    const empresa = (await loginAs('empresa', 'mobile')).access!;
    assert.equal((await call<MeInfo>(empresa, 'GET', '/auth/me')).data?.account?.soloUser, false);
  });

  it('trae `roleKey` y la lista de oficinas de la persona (con la central marcada)', async () => {
    const empresa = (await loginAs('empresa', 'mobile')).access!;
    const me = (await call<MeInfo>(empresa, 'GET', '/auth/me')).data!;
    assert.equal(me.roleKey, 'ACCOUNT_ADMIN');
    assert.ok(Array.isArray(me.offices));
    for (const o of me.offices ?? []) assert.deepEqual(Object.keys(o).sort(), ['id', 'isRoot', 'name']);
  });

  it('las oficinas asignadas aparecen con su nombre y se distingue la central', async () => {
    const cobrador = await prisma.user.findUniqueOrThrow({ where: { email: email('cobrador') } });
    const root = await prisma.branch.findFirst({ where: { accountId, isRoot: true, deletedAt: null } });
    assert.ok(root, 'la cuenta tiene su oficina central');
    // El plan gratuito admite una sola oficina: la agencia se inserta directo en la base (lo que se prueba es lo que `/auth/me` informa).
    const child = await prisma.branch.create({
      data: { accountId, name: 'Agencia Sur', parentId: root!.id, typeId: root!.typeId, path: `${root!.path}${randomUUID().slice(0, 8)}/`, depth: root!.depth + 1, isRoot: false, active: true },
    });
    await prisma.userBranchAssignment.create({ data: { accountId, userId: cobrador.id, branchId: child.id, isPrimary: true } });
    const token = (await loginAs('cobrador', 'mobile')).access!;
    const me = (await call<MeInfo>(token, 'GET', '/auth/me')).data!;
    assert.ok(me.offices?.some((o) => o.name === 'Agencia Sur' && o.isRoot === false), JSON.stringify(me.offices));
  });
});
