/**
 * F15 · P6 — asistente de configuración (por organización) y estado de guías (por persona), de punta a punta.
 *
 * API compilada + Postgres y Redis reales (base `kobrax_it`, con la migración `user_guide_states` aplicada). Lo que los
 * unitarios no pueden afirmar: que la tabla exista con RLS FORZADA, que una persona de otra organización no vea la fila, que
 * la API (rol sin BYPASSRLS) no lea nada sin contexto de cuenta, y que la cuenta nueva nazca `pending`.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f15-p6-onboarding.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  addMember,
  API,
  appDb,
  call,
  db,
  freshDatabase,
  login,
  loginSkippingMfa,
  PASSWORD,
  startApi,
  stopApi,
} from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let accountA: string;
let adminA: string;
let adminB: string;
let collectorA: string;

interface AccountMe {
  workspace: { rev: number; hiddenModules: string[] };
  onboarding: {
    v: number;
    status: string;
    decidedBy?: string;
    decidedAt?: string;
    preset?: string;
  } | null;
  billing: unknown;
}
interface GuideState {
  v: number;
  tour: { status: string; step: number; catalogVersion: number };
  screens: Record<string, string>;
  welcomeSeen: boolean;
  firstStepsClosed: boolean;
}
interface AuthMe {
  account: { onboarding: { status: string } | null } | null;
}

const empty = (): GuideState => ({
  v: 1,
  tour: { status: 'none', step: 0, catalogVersion: 0 },
  screens: {},
  welcomeSeen: false,
  firstStepsClosed: false,
});
const mine = (token: string) => call<AccountMe>(token, 'GET', '/accounts/me');

async function signup(label: string): Promise<{ accountId: string; token: string }> {
  const email = `dueno-${label}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: `Cobranzas ${label} ${suffix}`,
      firstName: 'Dueño',
      lastName: label,
      email,
      password: PASSWORD,
      planCode: 'PROFESSIONAL',
    }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { userAccounts: true },
  });
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
  adminB = b.token;
  const colEmail = `cob-${suffix}@ejemplo.com`;
  await addMember(prisma, accountA, colEmail, 'Cob', 'COLLECTOR');
  collectorA = await login(colEmail);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('F15·P6 — la tabla y su aislamiento', () => {
  it('la migración creó `user_guide_states` con RLS activa y FORZADA', async () => {
    const rows = await prisma.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'user_guide_states'`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.relrowsecurity, true);
    assert.equal(rows[0]!.relforcerowsecurity, true);
  });

  it('🔴 la API (rol NOBYPASSRLS) sin contexto de cuenta no lee ninguna fila, aunque existan', async () => {
    const put = await call<GuideState>(adminA, 'PUT', '/users/me/guides', {
      ...empty(),
      welcomeSeen: true,
    });
    assert.equal(put.status, 200, JSON.stringify(put.error));
    const app = appDb();
    try {
      const rows = await app.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*)::bigint AS n FROM user_guide_states`;
      assert.equal(Number(rows[0]!.n), 0, 'sin app.current_account la política no deja ver nada');
    } finally {
      await app.$disconnect();
    }
    assert.ok((await prisma.userGuideState.count()) >= 1, 'la fila sí existe para el superusuario');
  });
});

describe('F15·P6 — asistente de la organización', () => {
  it('🔴 la cuenta nueva nace PENDIENTE y se lo dicen a la web en /accounts/me y en /auth/me', async () => {
    const res = await mine(adminA);
    assert.deepEqual(res.data!.onboarding, { v: 1, status: 'pending' });
    const me = await call<AuthMe>(adminA, 'GET', '/auth/me');
    assert.deepEqual(me.data!.account!.onboarding, { status: 'pending' });
    const asCollector = await call<AuthMe>(collectorA, 'GET', '/auth/me');
    assert.deepEqual(
      asCollector.data!.account!.onboarding,
      { status: 'pending' },
      'cualquier miembro lo ve, sin permisos de cuenta',
    );
  });

  it('una cuenta anterior a F15 (sin estado) devuelve `null`: no recibe el asistente', async () => {
    await prisma.account.update({ where: { id: accountA }, data: { configuration: {} } });
    assert.equal((await mine(adminA)).data!.onboarding, null);
    assert.equal((await call<AuthMe>(adminA, 'GET', '/auth/me')).data!.account!.onboarding, null);
    await prisma.account.update({
      where: { id: accountA },
      data: { configuration: { onboarding: { v: 1, status: 'pending' } } },
    });
  });

  it('🔴 un miembro sin `account:write` no puede resolverlo', async () => {
    const res = await call(collectorA, 'PATCH', '/accounts/me', { onboarding: { status: 'done' } });
    assert.ok(res.status === 403 || res.status === 401, `status ${res.status}`);
    assert.equal((await mine(adminA)).data!.onboarding!.status, 'pending');
  });

  it('el administrador lo resuelve junto con el workspace, en UNA llamada; quién y cuándo los pone el servidor', async () => {
    const res = await call<AccountMe>(adminA, 'PATCH', '/accounts/me', {
      workspace: { version: 1, rev: 0, hiddenModules: ['export'], options: {} },
      onboarding: { status: 'done', preset: 'team' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.equal(res.data!.workspace.rev, 1);
    assert.deepEqual(res.data!.workspace.hiddenModules, ['export']);
    const o = res.data!.onboarding!;
    assert.equal(o.status, 'done');
    assert.equal(o.preset, 'team');
    assert.ok(o.decidedBy && o.decidedAt);
  });

  it('el primero que lo resuelve gana: un segundo intento no cambia nada', async () => {
    const first = (await mine(adminA)).data!.onboarding!;
    const again = await call<AccountMe>(adminA, 'PATCH', '/accounts/me', {
      onboarding: { status: 'skipped' },
    });
    assert.equal(again.status, 200);
    assert.deepEqual(again.data!.onboarding, first);
  });

  it('un valor que el cliente no puede declarar (`pending`, campos del servidor) se rechaza con 400', async () => {
    for (const bad of [
      { status: 'pending' },
      { status: 'done', decidedBy: 'yo' },
      { status: 'done', preset: 'raro' },
    ]) {
      const res = await call(adminA, 'PATCH', '/accounts/me', { onboarding: bad });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });

  it('se audita solo el subárbol onboarding de la cuenta que lo resolvió', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { accountId: accountA, entity: 'account', action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const entry = rows.find((r) => JSON.stringify(r.after ?? '').includes('onboarding'));
    assert.ok(entry, 'hay una entrada de auditoría del onboarding');
    assert.ok(!JSON.stringify(entry!.after).includes('taxId'));
  });
});

describe('F15·P6 — estado de guías por persona', () => {
  it('sin fila devuelve el estado vacío', async () => {
    const res = await call<GuideState>(collectorA, 'GET', '/users/me/guides');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, empty());
  });

  it('cualquier miembro (sin permisos especiales) guarda y lee lo suyo', async () => {
    const state = {
      ...empty(),
      tour: { status: 'inProgress', step: 4, catalogVersion: 1 },
      screens: { 'screen.portfolio': 'seen' },
    };
    const put = await call<GuideState>(collectorA, 'PUT', '/users/me/guides', state);
    assert.equal(put.status, 200, JSON.stringify(put.error));
    assert.deepEqual((await call<GuideState>(collectorA, 'GET', '/users/me/guides')).data, state);
  });

  it('🔴 la persona de la misma cuenta y la de otra organización leen SU propio estado, no el ajeno', async () => {
    const admin = await call<GuideState>(adminA, 'GET', '/users/me/guides');
    assert.equal(
      admin.data!.tour.step,
      0,
      'el administrador de A no hereda el recorrido del cobrador',
    );
    await call(adminA, 'PUT', '/users/me/guides', { ...empty(), firstStepsClosed: true });
    const other = await call<GuideState>(adminB, 'GET', '/users/me/guides');
    assert.deepEqual(other.data, empty(), 'la otra organización no ve nada');
    const collector = await call<GuideState>(collectorA, 'GET', '/users/me/guides');
    assert.equal(collector.data!.firstStepsClosed, false);
  });

  it('una sola fila por persona y organización, aunque se guarde varias veces', async () => {
    for (let i = 0; i < 3; i++)
      await call(collectorA, 'PUT', '/users/me/guides', {
        ...empty(),
        tour: { status: 'inProgress', step: i, catalogVersion: 1 },
      });
    const rows = await prisma.userGuideState.findMany({ where: { accountId: accountA } });
    const keys = rows.map((r) => r.userId);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('un estado inválido responde 422 y no cambia lo guardado', async () => {
    const before = (await call<GuideState>(collectorA, 'GET', '/users/me/guides')).data;
    for (const bad of [
      { ...empty(), screens: { 'a b': 'seen' } },
      { ...empty(), tour: { status: 'x', step: 0, catalogVersion: 0 } },
      { ...empty(), pad: 'x'.repeat(5000) },
    ]) {
      const res = await call(collectorA, 'PUT', '/users/me/guides', bad);
      assert.equal(res.status, 422, JSON.stringify(res.error));
      assert.equal(res.error?.code, 'GUIDE_STATE_INVALID');
    }
    assert.deepEqual((await call<GuideState>(collectorA, 'GET', '/users/me/guides')).data, before);
  });

  it('sin sesión se rechaza', async () => {
    const res = await fetch(`${API}/users/me/guides`);
    assert.equal(res.status, 401);
  });
});
