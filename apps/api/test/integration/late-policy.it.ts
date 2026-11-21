/**
 * La política de mora sellada en cada crédito, por las vías reales: API compilada y base real creada de cero (migraciones + RLS + seed).
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/late-policy.it.ts
 *
 * Qué se garantiza: todo crédito nace con la política vigente de su cuenta (hoy «sin cargos adicionales»), por CUALQUIER camino de creación;
 * esa referencia no se puede cambiar; las versiones de política son append-only; y una política nueva sólo alcanza a los créditos que se crean
 * DESPUÉS (nada retroactivo).
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { buildClientePayload, initialCliente } from '@kobrax/shared';
import { API, appDb, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi, legalAcceptance } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin: string;
let accountId: string;

async function newClient(): Promise<string> {
  const form = { ...initialCliente(), firstName: `P${suffix}`, lastName: 'Politica', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
  form.contacts = [{ ...form.contacts[0]!, value: '70000000' }];
  const res = await call<{ id: string }>(admin, 'POST', '/clients', buildClientePayload(form));
  assert.equal(res.status, 201, JSON.stringify(res.error));
  return res.data!.id;
}

async function newCredit(typeCode?: string): Promise<string> {
  const firstDueDate = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const res = await call<{ id: string }>(admin, 'POST', '/credits', {
    clientId: await newClient(),
    principalAmount: 1000,
    installmentAmount: 100,
    frequency: 'MONTHLY',
    nextDueDate: firstDueDate,
    installmentsCount: 12,
    ...(typeCode ? { typeCode } : {}),
    terms: { definition: 'agreed_installment', principal: 1000, installmentAmount: 100, installmentsCount: 12, frequency: 'MONTHLY', firstDueDate },
  });
  assert.equal(res.status, 201, JSON.stringify(res.error));
  return res.data!.id;
}

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Politica ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
  accountId = (await prisma.account.findFirstOrThrow({ where: { businessName: `Politica ${suffix}` } })).id;
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('sellado de la política de mora', () => {
  it('🔴 un crédito nuevo nace sellado con la v1 «sin cargos adicionales» de su cuenta, y la ficha lo dice', async () => {
    const credit = await newCredit();
    const row = await prisma.credit.findUniqueOrThrow({ where: { id: credit }, include: { latePolicyVersion: true } });
    assert.ok(row.latePolicyVersion, 'sellado');
    assert.deepEqual(
      [row.latePolicyVersion.accountId, row.latePolicyVersion.scope, row.latePolicyVersion.version, row.latePolicyVersion.kind, row.latePolicyVersion.annualRate],
      [accountId, 'ACCOUNT', 1, 'NONE', null],
    );
    const ficha = await call<{ latePolicy?: { kind: string; scope: string; version: number; graceDays: number } }>(admin, 'GET', `/credits/${credit}`);
    assert.deepEqual(ficha.data!.latePolicy && [ficha.data!.latePolicy.kind, ficha.data!.latePolicy.scope, ficha.data!.latePolicy.version, ficha.data!.latePolicy.graceDays], ['NONE', 'ACCOUNT', 1, 0]);
  });

  it('los créditos de la misma cuenta comparten la versión: no se crea una por crédito', async () => {
    const a = await newCredit();
    const b = await newCredit();
    const rows = await prisma.credit.findMany({ where: { id: { in: [a, b] } }, select: { latePolicyVersionId: true } });
    assert.equal(new Set(rows.map((r) => r.latePolicyVersionId)).size, 1);
    assert.equal(await prisma.latePolicyVersion.count({ where: { accountId, scope: 'ACCOUNT' } }), 1);
  });

  it('🔴 creados a la vez en una cuenta SIN política: nace una sola v1 (sin duplicar ni fallar)', async () => {
    // Una cuenta que NO pasó por la API ni por la migración: no tiene ninguna versión. Seis créditos en paralelo la hacen nacer a la vez.
    const other = await prisma.account.create({ data: { accountType: 'INDEPENDENT', businessName: `Sin politica ${suffix}`, countryCode: 'BO', currencyCode: 'BOB' } });
    assert.equal(await prisma.latePolicyVersion.count({ where: { accountId: other.id } }), 0, 'arranca sin política');
    const client = await prisma.client.create({ data: { accountId: other.id } });
    await Promise.all(
      Array.from({ length: 6 }, () => prisma.credit.create({ data: { accountId: other.id, clientId: client.id, currency: 'BOB', principalAmount: 100, outstandingBalance: 100 } })),
    );
    const versions = await prisma.latePolicyVersion.findMany({ where: { accountId: other.id } });
    assert.equal(versions.length, 1, 'una sola v1');
    assert.equal(versions[0]!.kind, 'NONE');
    assert.equal(await prisma.credit.count({ where: { accountId: other.id, latePolicyVersionId: null } }), 0, 'todos sellados');
  });
});

describe('inmutabilidad y no-retroactividad', () => {
  it('🔴 la aplicación NO puede cambiar la política de un crédito ya sellado', async () => {
    const credit = await newCredit();
    const v2 = await prisma.latePolicyVersion.create({ data: { accountId, scope: 'ACCOUNT', version: 2, kind: 'NONE' } });
    const app = appDb();
    try {
      // Con la empresa en sesión (sin ella la RLS oculta la fila y el UPDATE no toca nada, ni siquiera dispara el trigger).
      await assert.rejects(
        app.$transaction([
          app.$executeRawUnsafe(`SELECT set_config('app.current_account_id', '${accountId}', true)`),
          app.$executeRawUnsafe(`UPDATE credits SET late_policy_version_id = '${v2.id}' WHERE id = '${credit}'`),
        ]),
        /inmutable|credits.late_policy_version_id/i,
      );
    } finally {
      await app.$disconnect();
    }
    const row = await prisma.credit.findUniqueOrThrow({ where: { id: credit } });
    assert.notEqual(row.latePolicyVersionId, v2.id);
  });

  it('🔴 las versiones son append-only para la aplicación: ni UPDATE ni DELETE', async () => {
    const v = await prisma.latePolicyVersion.findFirstOrThrow({ where: { accountId } });
    const app = appDb();
    try {
      await assert.rejects(app.$executeRawUnsafe(`UPDATE late_policy_versions SET grace_days = 30 WHERE id = '${v.id}'`), /permission denied|inmutable/i);
      await assert.rejects(app.$executeRawUnsafe(`DELETE FROM late_policy_versions WHERE id = '${v.id}'`), /permission denied|inmutable/i);
    } finally {
      await app.$disconnect();
    }
    assert.equal((await prisma.latePolicyVersion.findUniqueOrThrow({ where: { id: v.id } })).graceDays, v.graceDays);
  });

  it('🔴 una política NUEVA sólo alcanza a los créditos creados después; los que ya existen no cambian', async () => {
    const before = await newCredit();
    const beforeVersion = (await prisma.credit.findUniqueOrThrow({ where: { id: before } })).latePolicyVersionId;
    const latest = await prisma.latePolicyVersion.findFirstOrThrow({ where: { accountId, scope: 'ACCOUNT' }, orderBy: { version: 'desc' } });
    const next = await prisma.latePolicyVersion.create({ data: { accountId, scope: 'ACCOUNT', version: latest.version + 1, kind: 'NONE', graceDays: 3 } });

    const after = await newCredit();
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: before } })).latePolicyVersionId, beforeVersion, 'el existente conserva la suya');
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: after } })).latePolicyVersionId, next.id, 'el nuevo toma la vigente');
  });

  it('con una política de PRODUCTO para su tipo de crédito, el crédito de ese tipo la toma; los de otro tipo, la de la cuenta', async () => {
    const product = await prisma.latePolicyVersion.create({ data: { accountId, scope: 'PRODUCT', typeCode: 'MICRO', version: 1, kind: 'NONE', graceDays: 5 } });
    const micro = await newCredit('MICRO');
    const personal = await newCredit('PERSONAL');
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: micro } })).latePolicyVersionId, product.id);
    const accountLatest = await prisma.latePolicyVersion.findFirstOrThrow({ where: { accountId, scope: 'ACCOUNT' }, orderBy: { version: 'desc' } });
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: personal } })).latePolicyVersionId, accountLatest.id);
  });

  it('no se puede declarar un interés moratorio sin tasa ni convención de días (restricciones de la tabla)', async () => {
    await assert.rejects(prisma.latePolicyVersion.create({ data: { accountId, scope: 'ACCOUNT', version: 99, kind: 'ANNUAL_RATE' } }), /late_policy_versions_kind_params|check/i);
    await assert.rejects(prisma.latePolicyVersion.create({ data: { accountId, scope: 'ACCOUNT', version: 99, kind: 'NONE', annualRate: 12 } }), /late_policy_versions_kind_params|check/i);
  });
});
