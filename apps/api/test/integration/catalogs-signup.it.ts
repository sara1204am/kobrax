/**
 * F4/13 · E1 por las vías reales: API compilada, base recreada desde cero (las 4 migraciones de `CatalogType` incluidas)
 * y el registro público de verdad. Lo que los unitarios no pueden afirmar:
 *   - que una cuenta **registrada** nazca con los catálogos por defecto (antes nacía vacía: sin métodos de pago ni bancos);
 *   - que los tipos nuevos existan en el enum de PostgreSQL y se lean por `/catalogs/:tipo`;
 *   - que el contenido (`metadata`) de un rubro o un motivo se valide;
 *   - que un ítem de un catálogo no se pueda editar desde la ruta de otro;
 *   - que una cuenta no vea los catálogos de otra (RLS).
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { addMember, API, call, db, freshDatabase, login, startApi, stopApi } from './harness';

interface Item {
  id: string;
  code: string;
  label: string;
  metadata: Record<string, unknown> | null;
}

const email = `nueva-${randomUUID().slice(0, 8)}@ejemplo.com`;
let prisma: PrismaClient;
let nueva: string;
let demo: string;

before(async () => {
  await freshDatabase();
  await startApi();
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: 'Cobranzas Prueba', firstName: 'Sara', lastName: 'Prueba', email, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  // El dueño que se registra es ACCOUNT_ADMIN: rol crítico, así que su primer login exige configurar MFA (enrolar TOTP
  // no es lo que se prueba acá). Se opera con un gerente de ESA cuenta, que es lo que haría una agencia.
  prisma = db();
  const dueno = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  const accountId = dueno.userAccounts[0]!.accountId;
  const gerente = `gerente-${randomUUID().slice(0, 8)}@ejemplo.com`;
  await addMember(prisma, accountId, gerente, 'Gerente', 'MANAGER');
  nueva = await login(gerente);
  demo = await login('manager@kobrax.demo');
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

const lista = async (token: string, tipo: string): Promise<Item[]> => {
  const r = await call<Item[]>(token, 'GET', `/catalogs/${tipo}`);
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data!;
};

describe('E1 · una cuenta registrada nace con sus catálogos', () => {
  it('métodos de pago y bancos: sin ellos la hoja de «registrar pago» abría vacía', async () => {
    assert.ok((await lista(nueva, 'PAYMENT_METHOD')).some((i) => i.code === 'CASH'));
    assert.ok((await lista(nueva, 'BANK')).length > 0);
  });

  it('los 4 catálogos nuevos existen y traen su lista', async () => {
    assert.equal((await lista(nueva, 'INCOME_SOURCE')).length, 3);
    assert.ok((await lista(nueva, 'OCCUPATION')).some((i) => i.code === 'TRANSPORT'));
    assert.equal((await lista(nueva, 'NO_PAYMENT_REASON')).length, 12);
    assert.ok((await lista(nueva, 'COLLECTION_MODALITY')).some((i) => i.code === 'PICK_UP'));
  });

  it('el motivo «ingreso atrasado» pide la fecha esperada y llega con su metadata', async () => {
    const m = (await lista(nueva, 'NO_PAYMENT_REASON')).find((i) => i.code === 'LATE_INCOME');
    assert.equal(m?.metadata?.asksExpectedIncomeDate, true);
  });

  it('los rubros traen sinónimos para reconocer lo dictado sin IA', async () => {
    const t = (await lista(nueva, 'OCCUPATION')).find((i) => i.code === 'TRANSPORT');
    assert.ok(Array.isArray(t?.metadata?.synonyms) && (t!.metadata!.synonyms as string[]).includes('chofer'));
  });
});

describe('E1 · el contenido y el tipo se validan', () => {
  it('🔴 un rubro con una fuente de ingreso inventada → 400 CATALOG_METADATA_INVALID', async () => {
    const r = await call(nueva, 'POST', '/catalogs/OCCUPATION', { code: 'RARO', label: 'Raro', metadata: { incomeSource: 'JEFE' } });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, 'CATALOG_METADATA_INVALID');
  });

  it('un rubro propio de la cuenta se crea', async () => {
    const r = await call<Item>(nueva, 'POST', '/catalogs/OCCUPATION', {
      code: 'MINERO',
      label: 'Minero',
      sortOrder: 11,
      metadata: { incomeSource: 'BUSINESS', defaultCycle: 'BIWEEKLY', synonyms: ['mina', 'cooperativa minera'] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data?.code, 'MINERO');
  });

  it('🔴 un ítem de un catálogo no se edita desde la ruta de otro', async () => {
    const motivo = (await lista(nueva, 'NO_PAYMENT_REASON'))[0]!;
    const r = await call(nueva, 'PATCH', `/catalogs/BANK/${motivo.id}`, { label: 'Hackeado' });
    assert.equal(r.status, 404);
    assert.equal(r.error?.code, 'CATALOG_NOT_FOUND');
    const sigue = (await lista(nueva, 'NO_PAYMENT_REASON')).find((i) => i.id === motivo.id);
    assert.equal(sigue?.label, motivo.label);
  });

  it('un tipo que no existe → 400', async () => {
    const r = await call(nueva, 'GET', '/catalogs/NO_EXISTE');
    assert.equal(r.status, 400);
  });
});

describe('E1 · aislamiento entre cuentas', () => {
  it('🔴 lo que una cuenta agrega no lo ve otra', async () => {
    const r = await call<Item>(nueva, 'POST', '/catalogs/NO_PAYMENT_REASON', { code: 'SOLO_NUEVA', label: 'Solo de la cuenta nueva' });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.ok((await lista(nueva, 'NO_PAYMENT_REASON')).some((i) => i.code === 'SOLO_NUEVA'));
    assert.ok(!(await lista(demo, 'NO_PAYMENT_REASON')).some((i) => i.code === 'SOLO_NUEVA'));
  });

  it('la cuenta demo (sembrada con seed) tiene los mismos tipos nuevos', async () => {
    assert.equal((await lista(demo, 'INCOME_SOURCE')).length, 3);
    assert.ok((await lista(demo, 'NO_PAYMENT_REASON')).length >= 12);
  });
});
