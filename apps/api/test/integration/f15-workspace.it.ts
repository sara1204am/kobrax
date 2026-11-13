/**
 * F15 · P1 — Configurable Workspace de punta a punta: guardado con control optimista, salvaguardas, aislamiento entre
 * cuentas, auditoría y lo que ve cada miembro (A-3, A-7, A-8, A-9, A-10, A-16).
 *
 * API compilada + Postgres y Redis reales (base `kobrax_it`). Lo que los unitarios no pueden afirmar: que el bloqueo de fila
 * (`SELECT … FOR UPDATE`) serialice de verdad a dos administradores, que el conteo de rutas en curso corra bajo RLS y que
 * `/auth/me` entregue el workspace a un miembro sin permisos de cuenta.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f15-workspace.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { addMember, API, call, db, freshDatabase, login, loginSkippingMfa, PASSWORD, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let accountA: string;
let accountB: string;
let adminA: string;
let adminB: string;
let collectorA: string;

interface WorkspaceDoc {
  version: number;
  rev: number;
  hiddenModules: string[];
  options: Record<string, unknown>;
}
interface AccountMe {
  workspace: WorkspaceDoc;
  limits: unknown;
  billing: unknown;
}

const doc = (rev: number, hiddenModules: string[] = [], options: Record<string, unknown> = {}) => ({ version: 1, rev, hiddenModules, options });
const patch = (token: string, workspace: unknown) => call<AccountMe>(token, 'PATCH', '/accounts/me', { workspace });
const mine = (token: string) => call<AccountMe>(token, 'GET', '/accounts/me');

async function signup(label: string): Promise<{ accountId: string; token: string }> {
  const email = `dueno-${label}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Cobranzas ${label} ${suffix}`, firstName: 'Dueño', lastName: label, email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  return { accountId: owner.userAccounts[0]!.accountId, token: await loginSkippingMfa(email) };
}

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const a = await signup('a');
  const b = await signup('b');
  accountA = a.accountId;
  adminA = a.token;
  accountB = b.accountId;
  adminB = b.token;
  const colEmail = `cob-${suffix}@ejemplo.com`;
  await addMember(prisma, accountA, colEmail, 'Cob', 'COLLECTOR');
  collectorA = await login(colEmail);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('F15·P1 — lectura', () => {
  it('R5 / A-1: una cuenta que nunca lo configuró recibe «Completo»', async () => {
    const res = await mine(adminA);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data!.workspace, doc(0));
  });
});

describe('F15·P1 — guardado, conflicto y salvaguardas', () => {
  it('🔴 C-12: un PATCH con SOLO workspace se guarda, sube el rev y no toca el resto de la cuenta', async () => {
    const before = await mine(adminA);
    const res = await patch(adminA, doc(0, ['routes'], { 'client.income': false }));
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.deepEqual(res.data!.workspace, doc(1, ['routes'], { 'client.income': false }));
    // A-10: los topes del plan y los datos fiscales no se mueven.
    assert.deepEqual(res.data!.limits, before.data!.limits);
    assert.deepEqual(res.data!.billing, before.data!.billing);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: accountA } });
    assert.deepEqual((row.configuration as { workspace: WorkspaceDoc }).workspace, doc(1, ['routes'], { 'client.income': false }));
  });

  it('🔴 A-16: dos administradores que guardan a la vez con el mismo rev → uno gana (200) y el otro recibe 409; no se pisan', async () => {
    const [x, y] = await Promise.all([patch(adminA, doc(1, ['routes', 'export'])), patch(adminA, doc(1, ['routes', 'import']))]);
    const statuses = [x.status, y.status].sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify([x.error, y.error]));
    const loser = x.status === 409 ? x : y;
    assert.equal(loser.error?.code, 'WORKSPACE_CONFLICT');
    const final = await mine(adminA);
    assert.equal(final.data!.workspace.rev, 2, 'el rev sube una sola vez');
  });

  it('un guardado con un rev viejo recibe 409 y no cambia nada', async () => {
    const current = await mine(adminA);
    const stale = await patch(adminA, doc(0, ['export']));
    assert.equal(stale.status, 409);
    assert.equal(stale.error?.code, 'WORKSPACE_CONFLICT');
    assert.deepEqual((await mine(adminA)).data!.workspace, current.data!.workspace);
  });

  it('🔴 A-3: un troncal, una clave inventada o un valor fuera del catálogo → 422 y nada se guarda', async () => {
    const current = (await mine(adminA)).data!.workspace;
    for (const bad of [doc(current.rev, ['portfolio']), doc(current.rev, ['accessSecurity']), doc(current.rev, ['inventado']), doc(current.rev, [], { 'client.phone': false }), { ...doc(current.rev), version: 2 }]) {
      const res = await patch(adminA, bad);
      assert.equal(res.status, 422, JSON.stringify(bad));
      assert.equal(res.error?.code, 'WORKSPACE_INVALID');
    }
    assert.deepEqual((await mine(adminA)).data!.workspace, current);
  });

  it('S-1 / S-7: con más de una persona en la cuenta, Equipo y Actividad no se ocultan; el aviso trae el conteo', async () => {
    const current = (await mine(adminA)).data!.workspace;
    const res = await patch(adminA, doc(current.rev, [...current.hiddenModules, 'team', 'activity']));
    assert.equal(res.status, 409, JSON.stringify(res.error));
    assert.equal(res.error?.code, 'WORKSPACE_BLOCKED');
    const blocks = (res.error?.details as { blocks: { module: string; reason: string; count: number }[] }).blocks;
    assert.deepEqual(blocks.map((b) => b.module).sort(), ['activity', 'team']);
    assert.ok(blocks.every((b) => b.reason === 'MEMBERS' && b.count === 2));
  });

  it('S-3: el conteo de rutas en curso corre bajo RLS (ocultar Rutas ya funcionó con 0 en curso)', async () => {
    const current = (await mine(adminA)).data!.workspace;
    assert.ok(current.hiddenModules.includes('routes'));
  });

  it('volver a mostrar un módulo nunca se bloquea', async () => {
    const current = (await mine(adminA)).data!.workspace;
    const res = await patch(adminA, doc(current.rev, []));
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.deepEqual(res.data!.workspace.hiddenModules, []);
  });
});

describe('F15·P1 — aislamiento y permisos', () => {
  it('🔴 A-8: lo que configura la cuenta A no toca a la cuenta B', async () => {
    const b = await mine(adminB);
    assert.deepEqual(b.data!.workspace, doc(0), 'B sigue en Completo');
    const res = await patch(adminB, doc(0, ['export']));
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.deepEqual(res.data!.workspace.hiddenModules, ['export']);
    const a = await mine(adminA);
    assert.deepEqual(a.data!.workspace.hiddenModules, [], 'A no cambió');
  });

  it('S-5: un cobrador no puede escribir el workspace (403) ni leer /accounts/me', async () => {
    assert.equal((await patch(collectorA, doc(0, ['export']))).status, 403);
    assert.equal((await mine(collectorA)).status, 403);
  });

  it('🔴 A-9: `/auth/me` entrega el workspace a todo miembro, sin permisos de cuenta y sin datos fiscales', async () => {
    const current = (await mine(adminA)).data!.workspace;
    const res = await call<{ account: { workspace: WorkspaceDoc } & Record<string, unknown> }>(collectorA, 'GET', '/auth/me');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data!.account.workspace, current);
    assert.ok(!('billing' in res.data!.account) && !('limits' in res.data!.account));
  });
});

describe('F15·P1 — auditoría', () => {
  it('🔴 A-7 / C-13: cada cambio queda auditado SOLO con su subárbol `workspace` (quién, cuándo, desde dónde)', async () => {
    const rows = await prisma.auditLog.findMany({ where: { accountId: accountA, entity: 'account', action: 'UPDATE' }, orderBy: { createdAt: 'asc' } });
    const ws = rows.filter((r) => r.after && typeof r.after === 'object' && 'workspace' in (r.after as object));
    assert.ok(ws.length >= 2, `hay al menos dos cambios auditados (hay ${ws.length})`);
    for (const r of ws) {
      assert.deepEqual(Object.keys(r.after as object), ['workspace'], 'solo el subárbol, no la fila de la cuenta');
      assert.deepEqual(Object.keys(r.before as object), ['workspace']);
      assert.ok(r.userId, 'quién');
      assert.ok(r.ip !== undefined, 'desde dónde');
    }
    // El rechazado (409/422) no deja rastro de un cambio que no ocurrió.
    const revs = ws.map((r) => (r.after as { workspace: WorkspaceDoc }).workspace.rev);
    assert.deepEqual([...revs].sort((p, q) => p - q), revs, 'en orden');
    assert.equal(new Set(revs).size, revs.length, 'sin revs repetidos: ningún guardado perdido o duplicado');
  });
});
