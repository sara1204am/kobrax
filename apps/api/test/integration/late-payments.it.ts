/**
 * Pagos con interés moratorio (F17 · F3-c), por las vías reales: API compilada y base creada de cero.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/late-payments.it.ts
 *
 * Se garantiza: (1) sin política activa el pago se imputa EXACTAMENTE como siempre (sin filas de mora); (2) un crédito creado ANTES de activar la
 * política no cambia; (3) con política sellada, el pago cubre primero la mora y después la cuota, y el saldo del plan baja sólo por lo programado;
 * (4) la mora se corta en la fecha de cobro; (5) no se puede pagar más que saldo + mora; (6) dos pagos simultáneos no cobran de más ni de menos;
 * (7) reintentar con la misma clave no duplica; (8) el verificador reproduce la mora y no encuentra desvíos.
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { buildClientePayload, calculateCredit, initialCliente, lateTrancheCharge } from '@kobrax/shared';
import { civilTodayUTC, timezoneOf } from '../../src/common/context/tenant-clock.service';
import { findPaymentIntegrityViolations } from '../../src/modules/payments/payment-integrity';
import { API, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi, legalAcceptance } from './harness';

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
  const form = { ...initialCliente(), firstName: `M${Math.random().toString(36).slice(2, 7)}`, lastName: 'Mora', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
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

async function pay(creditId: string, amount: number, key?: string, paymentDate?: string) {
  const res = await fetch(`${API}/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({ creditId, amount, method: 'CASH', ...(paymentDate ? { paymentDate } : {}) }),
  });
  const body = (await res.json()) as { data?: { id: string; idempotentReplay?: boolean }; error?: { code: string; message: string } };
  return { status: res.status, data: body.data, error: body.error };
}

const rows = async (creditId: string) =>
  (await prisma.paymentApplication.findMany({ where: { creditId }, orderBy: [{ createdAt: 'asc' }, { component: 'desc' }, { installmentNumber: 'asc' }] })).map((a) => ({ n: a.installmentNumber, c: a.component, amount: n2(a.amount) }));
const credit = (id: string) => prisma.credit.findUniqueOrThrow({ where: { id } });
const sum = (list: { c: string; amount: number }[], c: string) => n2(list.filter((r) => r.c === c).reduce((s, r) => s + r.amount, 0));

/** Mora esperada de la cuota 1 tras `days` días de atraso, con el capital real que trae el plan (36,5 % Actual/365 = 0,1 % por día). */
const expectedLate = (days: number): number => {
  const first = calculateCredit(terms(day(-10))).schedule![0]!;
  return lateTrancheCharge(Math.round(first.principal! * 100), 36.5, days, 365) / 100;
};

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Mora ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
  const account = await prisma.account.findFirstOrThrow({ where: { businessName: `Mora ${suffix}` }, select: { id: true, timezone: true, countryCode: true } });
  accountId = account.id;
  accountTz = timezoneOf(account);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

let legacy: string;
let sealed: string;

describe('sin política activa (apagado por defecto)', () => {
  it('🔴 el pago se imputa como siempre: ninguna fila de mora y el saldo baja lo que se pagó', async () => {
    legacy = await newCredit(-10);
    const before = n2((await credit(legacy)).outstandingBalance);
    assert.equal((await pay(legacy, 100)).status, 201);
    const r = await rows(legacy);
    assert.equal(sum(r, 'LATE_INTEREST'), 0);
    assert.equal(sum(r, 'SCHEDULED'), 100);
    assert.equal(n2((await credit(legacy)).outstandingBalance), n2(before - 100));
  });
});

describe('con la política activada desde Cuenta → Cobranza', () => {
  it('se activa y el crédito NUEVO la sella; el anterior no cambia (D8)', async () => {
    assert.equal((await call(admin, 'PUT', '/accounts/me/late-policy', { kind: 'ANNUAL_RATE', annualRate: 36.5, dayCount: 365, graceDays: 0 })).status, 200);
    sealed = await newCredit(-10);
    assert.ok((await credit(sealed)).latePolicyVersionId);
    assert.equal((await pay(legacy, 100)).status, 201);
    assert.equal(sum(await rows(legacy), 'LATE_INTEREST'), 0);
  });

  it('🔴 el pago cubre PRIMERO la mora (10 días) y después la cuota; el saldo del plan baja sólo por lo programado', async () => {
    const late = expectedLate(10);
    assert.ok(late > 0);
    const before = n2((await credit(sealed)).outstandingBalance);
    assert.equal((await pay(sealed, 1000)).status, 201);
    const r = await rows(sealed);
    assert.equal(sum(r, 'LATE_INTEREST'), late);
    assert.equal(sum(r, 'SCHEDULED'), n2(1000 - late));
    assert.equal(n2((await credit(sealed)).outstandingBalance), n2(before - (1000 - late)));
  });

  it('la mora ya cobrada no se cobra otra vez: el segundo pago ya va entero a la cuota (sólo corren los días nuevos, sobre el capital que quedó)', async () => {
    const r1 = await rows(sealed);
    assert.equal(sum(r1, 'LATE_INTEREST'), expectedLate(10));
    assert.equal((await pay(sealed, 500)).status, 201);
    const r2 = await rows(sealed);
    // Mismo día: no hay días nuevos ⇒ sin mora nueva.
    assert.equal(sum(r2, 'LATE_INTEREST'), sum(r1, 'LATE_INTEREST'));
    assert.equal(sum(r2, 'SCHEDULED'), n2(sum(r1, 'SCHEDULED') + 500));
  });

  it('el corte es la FECHA DE COBRO: un pago fechado hace 5 días trae 5 días de mora, no 10', async () => {
    const c = await newCredit(-10);
    assert.equal((await pay(c, 1000, undefined, `${day(-5)}T12:00:00Z`)).status, 201);
    assert.equal(sum(await rows(c), 'LATE_INTEREST'), expectedLate(5));
  });

  it('🔴 no se puede pagar más que el saldo del plan + la mora', async () => {
    const c = await newCredit(-10);
    const bal = n2((await credit(c)).outstandingBalance);
    const res = await pay(c, n2(bal + expectedLate(10) + 1));
    assert.equal(res.status, 400);
    assert.deepEqual(await rows(c), []);
  });

  it('🔴 pagar TODO (plan + mora): la mora sale primero y el crédito pasa a PAID sólo cuando no queda nada', async () => {
    const c = await newCredit(-10);
    const bal = n2((await credit(c)).outstandingBalance);
    const late = expectedLate(10);
    assert.equal((await pay(c, bal)).status, 201);
    assert.equal(sum(await rows(c), 'LATE_INTEREST'), late);
    const mid = await credit(c);
    assert.equal(mid.status, 'ACTIVE');
    assert.equal(n2(mid.outstandingBalance), late);
    assert.equal((await pay(c, late)).status, 201);
    const end = await credit(c);
    assert.equal(end.status, 'PAID');
    assert.equal(n2(end.outstandingBalance), 0);
    assert.deepEqual(await findPaymentIntegrityViolations(prisma, accountId, { creditId: c }), []);
  });

  it('🔴 dos pagos simultáneos al mismo crédito: la mora se cobra una sola vez y todo suma al centavo', async () => {
    const c = await newCredit(-10);
    const late = expectedLate(10);
    const [a, b] = await Promise.all([pay(c, 30), pay(c, 30)]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const r = await rows(c);
    assert.equal(sum(r, 'LATE_INTEREST'), late);
    assert.equal(n2(sum(r, 'LATE_INTEREST') + sum(r, 'SCHEDULED')), 60);
    assert.deepEqual(await findPaymentIntegrityViolations(prisma, accountId, { creditId: c }), []);
  });

  it('🔴 reintentar con la misma Idempotency-Key no duplica pago ni aplicaciones', async () => {
    const c = await newCredit(-10);
    const key = randomUUID();
    const first = await pay(c, 100, key);
    const again = await pay(c, 100, key);
    assert.equal(first.status, 201);
    assert.equal(again.data!.id, first.data!.id);
    assert.equal(again.data!.idempotentReplay, true);
    const r = await rows(c);
    assert.equal(n2(sum(r, 'LATE_INTEREST') + sum(r, 'SCHEDULED')), 100);
    assert.equal(await prisma.payment.count({ where: { creditId: c } }), 1);
  });

  it('el verificador reproduce la mora de todos los créditos y no encuentra desvíos', async () => {
    assert.deepEqual(await findPaymentIntegrityViolations(prisma, accountId), []);
  });

  it('🔴 el verificador SÍ detecta una mora cobrada de más (inyectada a mano)', async () => {
    const c = await newCredit(-10);
    assert.equal((await pay(c, 100)).status, 201);
    const p = await prisma.payment.findFirstOrThrow({ where: { creditId: c } });
    await prisma.paymentApplication.create({ data: { accountId, paymentId: p.id, creditId: c, installmentNumber: 3, amount: 0.01, component: 'LATE_INTEREST' } });
    const found = await findPaymentIntegrityViolations(prisma, accountId, { creditId: c });
    assert.ok(found.some((v) => v.kind === 'LATE_INTEREST_EXCEEDS_ACCRUED' && v.installmentNumber === 3));
  });
});

describe('exoneración y lectura de la mora (F17 · F3-d)', () => {
  type Late = { pending: number; accrued: number; collected: number; waived: number; installments: { installmentNumber: number; pending: number }[] } | null;
  const lateOf = async (id: string) => (await call<Late>(admin, 'GET', `/credits/${id}/late-interest`)).data;

  it('un crédito SIN política sellada no devenga: la lectura es null y no se puede exonerar', async () => {
    assert.equal(await lateOf(legacy), null);
    const res = await call(admin, 'POST', `/credits/${legacy}/late-interest/waivers`, { installmentNumber: 1, amount: 1, reason: 'Convenio' });
    assert.equal(res.status, 400);
  });

  it('con política sellada, la lectura trae lo devengado y pendiente por cuota; la ficha y el historial de pagos lo traen igual', async () => {
    const c = await newCredit(-10);
    const late = expectedLate(10);
    const s = await lateOf(c);
    assert.equal(s!.pending, late);
    assert.equal(s!.installments[0]!.installmentNumber, 1);
    const detail = await call<{ lateInterest: Late }>(admin, 'GET', `/credits/${c}`);
    assert.equal(detail.data!.lateInterest!.pending, late);
    const history = await call<{ lateInterest: Late }>(admin, 'GET', `/credits/${c}/payments`);
    assert.equal(history.data!.lateInterest!.pending, late);
  });

  it('🔴 exonerar exige motivo y no puede pasar de la mora pendiente de esa cuota', async () => {
    const c = await newCredit(-10);
    const late = expectedLate(10);
    const url = `/credits/${c}/late-interest/waivers`;
    assert.equal((await call(admin, 'POST', url, { installmentNumber: 1, amount: 1 })).status, 400);
    assert.equal((await call(admin, 'POST', url, { installmentNumber: 1, amount: 1, reason: '  ' })).status, 400);
    assert.equal((await call(admin, 'POST', url, { installmentNumber: 1, amount: n2(late + 1), reason: 'Convenio' })).status, 400);
    assert.equal((await call(admin, 'POST', url, { installmentNumber: 2, amount: 1, reason: 'Convenio' })).status, 400); // la cuota 2 no tiene mora
    assert.equal(await prisma.creditLateWaiver.count({ where: { creditId: c } }), 0);
  });

  it('🔴 una exoneración parcial queda como hecho con motivo y autor, se audita, y el próximo pago cobra sólo lo que falta de mora', async () => {
    const c = await newCredit(-10);
    const late = expectedLate(10);
    const part = n2(late / 2);
    const res = await call<{ pendingAfter: number }>(admin, 'POST', `/credits/${c}/late-interest/waivers`, { installmentNumber: 1, amount: part, reason: 'Cliente en convenio' });
    assert.equal(res.status, 201, JSON.stringify(res.error));
    assert.equal(res.data!.pendingAfter, n2(late - part));
    const w = await prisma.creditLateWaiver.findFirstOrThrow({ where: { creditId: c } });
    assert.equal(w.reason, 'Cliente en convenio');
    assert.ok(w.createdBy);
    assert.equal(await prisma.auditLog.count({ where: { accountId, entity: 'credit_late_waiver', entityId: w.id } }), 1);
    assert.equal((await lateOf(c))!.waived, part);

    assert.equal((await pay(c, 500)).status, 201);
    assert.equal(sum(await rows(c), 'LATE_INTEREST'), n2(late - part));
    assert.deepEqual(await findPaymentIntegrityViolations(prisma, accountId, { creditId: c }), []);
  });

  it('exonerar TODA la mora: el próximo pago va entero a la cuota', async () => {
    const c = await newCredit(-10);
    const late = expectedLate(10);
    assert.equal((await call(admin, 'POST', `/credits/${c}/late-interest/waivers`, { installmentNumber: 1, amount: late, reason: 'Perdón total' })).status, 201);
    assert.equal((await lateOf(c))!.pending, 0);
    assert.equal((await pay(c, 100)).status, 201);
    const r = await rows(c);
    assert.equal(sum(r, 'LATE_INTEREST'), 0);
    assert.equal(sum(r, 'SCHEDULED'), 100);
  });
});
