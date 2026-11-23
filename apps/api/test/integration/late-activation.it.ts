/**
 * Activación del interés moratorio en un crédito existente (F17 · F3-e, D8), por las vías reales: API compilada y base creada de cero.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/late-activation.it.ts
 *
 * Se garantiza: (1) sin política de cuenta activa no se puede activar; (2) la fecha de inicio tiene que ser posterior a hoy y válida; (3) una
 * activación válida es un hecho único, con motivo y autor, auditado, que no toca `credits.late_policy_version_id`; (4) antes del inicio no corre
 * nada y un pago se imputa como siempre; (5) desde el inicio la mora corre sólo desde ese día (nunca hacia atrás) y el pago la cubre primero;
 * (6) la activación no se edita ni se borra desde la aplicación; (7) el verificador no encuentra desvíos.
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { buildClientePayload, calculateCredit, initialCliente, lateTrancheCharge } from '@kobrax/shared';
import { civilTodayUTC, timezoneOf } from '../../src/common/context/tenant-clock.service';
import { findPaymentIntegrityViolations } from '../../src/modules/payments/payment-integrity';
import { API, appDb, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi, legalAcceptance } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin: string;
let accountId: string;
let accountTz = 'UTC';
const day = (n: number): string => new Date(civilTodayUTC(accountTz).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const n2 = (x: unknown): number => Math.round(Number(x) * 100) / 100;

const terms = (firstDueDate: string) => ({ definition: 'agreed_total' as const, principal: 120000, agreedTotal: 125000, repayment: 'installments' as const, installmentsCount: 24, frequency: 'MONTHLY' as const, firstDueDate });

async function newCredit(firstDueOffset: number): Promise<string> {
  const firstDueDate = day(firstDueOffset);
  const form = { ...initialCliente(), firstName: `A${Math.random().toString(36).slice(2, 7)}`, lastName: 'Activa', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
  form.contacts = [{ ...form.contacts[0]!, value: '70000000' }];
  const client = await call<{ id: string }>(admin, 'POST', '/clients', buildClientePayload(form));
  assert.equal(client.status, 201, JSON.stringify(client.error));
  const res = await call<{ id: string }>(admin, 'POST', '/credits', {
    clientId: client.data!.id,
    principalAmount: 120000,
    installmentAmount: 5208.33,
    frequency: 'MONTHLY',
    nextDueDate: firstDueDate,
    installmentsCount: 24,
    terms: terms(firstDueDate),
  });
  assert.equal(res.status, 201, JSON.stringify(res.error));
  return res.data!.id;
}

async function pay(creditId: string, amount: number) {
  const res = await fetch(`${API}/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ creditId, amount, method: 'CASH' }),
  });
  return { status: res.status };
}

const apps = async (creditId: string) => (await prisma.paymentApplication.findMany({ where: { creditId } })).map((a) => ({ c: a.component, amount: n2(a.amount) }));
const sum = (list: { c: string; amount: number }[], c: string) => n2(list.filter((r) => r.c === c).reduce((s, r) => s + r.amount, 0));
const activate = (id: string, body: unknown) => call<{ id: string; startsOn: string }>(admin, 'POST', `/credits/${id}/late-interest/activation`, body);

/** Mora esperada de la cuota 1 tras `days` días corriendo, con el capital real del plan (36,5 % Actual/365 = 0,1 % por día). */
const expectedLate = (days: number): number => {
  const first = calculateCredit(terms(day(-10))).schedule![0]!;
  return lateTrancheCharge(Math.round(first.principal! * 100), 36.5, days, 365) / 100;
};

let early: string; // creado ANTES de que la cuenta active la política
let early2: string;

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Activa ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
  const account = await prisma.account.findFirstOrThrow({ where: { businessName: `Activa ${suffix}` }, select: { id: true, timezone: true, countryCode: true } });
  accountId = account.id;
  accountTz = timezoneOf(account);
  early = await newCredit(-10);
  early2 = await newCredit(-10);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('activar la mora en un crédito existente (F3-e)', () => {
  it('🔴 sin política de cuenta activa no se puede activar', async () => {
    const res = await activate(early, { startsOn: day(5), reason: 'Convenio' });
    assert.equal(res.status, 400);
    assert.equal(await prisma.creditLateActivation.count({ where: { creditId: early } }), 0);
  });

  it('🔴 la fecha de inicio debe ser posterior a hoy y válida; el motivo es obligatorio', async () => {
    assert.equal((await call(admin, 'PUT', '/accounts/me/late-policy', { kind: 'ANNUAL_RATE', annualRate: 36.5, dayCount: 365, graceDays: 0 })).status, 200);
    for (const startsOn of [day(0), day(-3)]) assert.equal((await activate(early, { startsOn, reason: 'Convenio' })).status, 400, startsOn);
    assert.equal((await activate(early, { startsOn: '2026-02-30', reason: 'Convenio' })).status, 400);
    assert.equal((await activate(early, { startsOn: 'mañana', reason: 'Convenio' })).status, 400);
    assert.equal((await activate(early, { startsOn: day(5), reason: ' ' })).status, 400);
    assert.equal((await activate(early, { startsOn: day(5) })).status, 400);
    assert.equal(await prisma.creditLateActivation.count({ where: { creditId: early } }), 0);
  });

  it('una activación válida es un hecho único con motivo y autor, auditado; el sello del crédito NO cambia', async () => {
    const sealedBefore = (await prisma.credit.findUniqueOrThrow({ where: { id: early } })).latePolicyVersionId;
    const res = await activate(early, { startsOn: day(5), reason: ' Convenio de refinanciación ' });
    assert.equal(res.status, 201, JSON.stringify(res.error));
    const a = await prisma.creditLateActivation.findFirstOrThrow({ where: { creditId: early } });
    assert.equal(a.reason, 'Convenio de refinanciación');
    assert.ok(a.createdBy);
    assert.equal(a.startsOn.toISOString().slice(0, 10), day(5));
    assert.equal(await prisma.auditLog.count({ where: { accountId, entity: 'credit_late_activation', entityId: a.id } }), 1);
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: early } })).latePolicyVersionId, sealedBefore);
    // La ficha lo muestra.
    const detail = await call<{ lateActivation: { startsOn: string } | null }>(admin, 'GET', `/credits/${early}`);
    assert.equal(detail.data!.lateActivation!.startsOn, day(5));
  });

  it('🔴 sólo una vez por crédito, y un crédito que ya devenga no se activa', async () => {
    assert.equal((await activate(early, { startsOn: day(9), reason: 'Otra vez' })).status, 400);
    const born = await newCredit(-10); // nace sellado con ANNUAL_RATE
    assert.equal((await activate(born, { startsOn: day(5), reason: 'Convenio' })).status, 400);
  });

  it('🔴 antes del inicio no corre nada: la lectura queda en cero y un pago se imputa como siempre', async () => {
    const read = await call<{ pending: number } | null>(admin, 'GET', `/credits/${early}/late-interest`);
    assert.equal(read.data?.pending ?? 0, 0);
    assert.equal((await pay(early, 100)).status, 201);
    const r = await apps(early);
    assert.equal(sum(r, 'LATE_INTEREST'), 0);
    assert.equal(sum(r, 'SCHEDULED'), 100);
    assert.deepEqual(await findPaymentIntegrityViolations(prisma, accountId, { creditId: early }), []);
  });

  it('🔴 desde el inicio corre sólo desde ese día (nunca hacia atrás) y el pago la cubre primero', async () => {
    // Una activación con inicio ya pasado sólo se puede sembrar con el propietario de la base (la API la exige futura): simula que llegó el día.
    await prisma.creditLateActivation.create({
      data: { accountId, creditId: early2, policyVersionId: (await prisma.latePolicyVersion.findFirstOrThrow({ where: { accountId, kind: 'ANNUAL_RATE' } })).id, startsOn: new Date(`${day(-4)}T00:00:00Z`), reason: 'Convenio' },
    });
    // La cuota 1 venció hace 10 días, pero sólo corren los 5 días desde `startsOn` (día -4 .. hoy), no los 10.
    const late = expectedLate(5);
    const read = await call<{ pending: number; policy: { startsOn: string } }>(admin, 'GET', `/credits/${early2}/late-interest`);
    assert.equal(read.data!.pending, late);
    assert.equal(read.data!.policy.startsOn, day(-4));
    assert.notEqual(late, expectedLate(10));

    assert.equal((await pay(early2, 500)).status, 201);
    assert.equal(sum(await apps(early2), 'LATE_INTEREST'), late);
    assert.deepEqual(await findPaymentIntegrityViolations(prisma, accountId, { creditId: early2 }), []);
  });

  it('🔴 la aplicación no puede editar ni borrar una activación', async () => {
    const a = await prisma.creditLateActivation.findFirstOrThrow({ where: { creditId: early } });
    const app = appDb();
    try {
      await assert.rejects(app.$executeRawUnsafe(`UPDATE credit_late_activations SET starts_on = '2000-01-01' WHERE id = '${a.id}'`), /permission denied|inmutable/i);
      await assert.rejects(app.$executeRawUnsafe(`DELETE FROM credit_late_activations WHERE id = '${a.id}'`), /permission denied|inmutable/i);
    } finally {
      await app.$disconnect();
    }
  });
});
