/**
 * Libro del interés moratorio (F17 · F3-b): las garantías del ESQUEMA, por las vías reales (API compilada, base creada de cero con migraciones +
 * RLS + roles de la aplicación). Todavía no hay código que escriba mora; esto fija lo que la base ya impide para cuando lo haya.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/late-ledger.it.ts
 *
 * Se garantiza: (1) las aplicaciones de antes son `SCHEDULED`; (2) un pago puede aplicar a la MISMA cuota una parte programada y una de mora,
 * pero no repetir un componente; (3) una exoneración exige monto positivo y motivo; (4) es un hecho inmutable para la aplicación; (5) copia
 * oficina y responsable del crédito (barrera de alcance) y los sigue cuando el crédito cambia.
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
let creditId: string;
let paymentId: string;

async function newClient(): Promise<string> {
  const form = { ...initialCliente(), firstName: `L${suffix}`, lastName: 'Libro', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
  form.contacts = [{ ...form.contacts[0]!, value: '70000000' }];
  const res = await call<{ id: string }>(admin, 'POST', '/clients', buildClientePayload(form));
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
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Libro ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
  accountId = (await prisma.account.findFirstOrThrow({ where: { businessName: `Libro ${suffix}` } })).id;

  const firstDueDate = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const credit = await call<{ id: string }>(admin, 'POST', '/credits', {
    clientId: await newClient(),
    principalAmount: 1000,
    installmentAmount: 100,
    frequency: 'MONTHLY',
    nextDueDate: firstDueDate,
    installmentsCount: 12,
    terms: { definition: 'agreed_installment', principal: 1000, installmentAmount: 100, installmentsCount: 12, frequency: 'MONTHLY', firstDueDate },
  });
  assert.equal(credit.status, 201, JSON.stringify(credit.error));
  creditId = credit.data!.id;

  const pay = await call<{ id: string }>(admin, 'POST', '/payments', { creditId, amount: 40, method: 'CASH' });
  assert.equal(pay.status, 201, JSON.stringify(pay.error));
  paymentId = pay.data!.id;
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('payment_applications.component', () => {
  it('🔴 las aplicaciones que ya existían (y las que escribe el código de hoy) son SCHEDULED', async () => {
    const rows = await prisma.paymentApplication.findMany({ where: { creditId } });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.component === 'SCHEDULED'));
  });

  it('un pago puede aplicar a la MISMA cuota una parte de mora y otra programada', async () => {
    const late = await prisma.paymentApplication.create({ data: { accountId, paymentId, creditId, installmentNumber: 1, amount: 1.5, component: 'LATE_INTEREST' } });
    assert.equal(late.component, 'LATE_INTEREST');
    const both = await prisma.paymentApplication.findMany({ where: { paymentId, installmentNumber: 1 } });
    assert.deepEqual(both.map((r) => r.component).sort(), ['LATE_INTEREST', 'SCHEDULED']);
  });

  it('🔴 pero no se aplica dos veces el mismo componente a la misma cuota (barrera contra la doble aplicación)', async () => {
    await assert.rejects(prisma.paymentApplication.create({ data: { accountId, paymentId, creditId, installmentNumber: 1, amount: 0.5, component: 'LATE_INTEREST' } }), /Unique constraint|payment_inst_kind_comp/i);
    await assert.rejects(prisma.paymentApplication.create({ data: { accountId, paymentId, creditId, installmentNumber: 1, amount: 0.5 } }), /Unique constraint|payment_inst_kind_comp/i);
  });
});

describe('credit_late_waivers — exoneraciones', () => {
  const waiver = (over: Record<string, unknown> = {}) => ({ accountId, creditId, installmentNumber: 1, amount: 2.5, reason: 'Cliente en convenio', ...over });

  it('una exoneración válida se guarda, y COPIA oficina y responsable del crédito (barrera de alcance)', async () => {
    const credit = await prisma.credit.findUniqueOrThrow({ where: { id: creditId } });
    const w = await prisma.creditLateWaiver.create({ data: waiver() });
    assert.equal(w.creditBranchId, credit.branchId);
    assert.equal(w.creditManagerId, credit.assignedManagerId);
  });

  it('sin monto positivo o sin motivo se rechaza (restricciones de la tabla)', async () => {
    await assert.rejects(prisma.creditLateWaiver.create({ data: waiver({ amount: 0 }) }), /credit_late_waivers_amount_pos|check/i);
    await assert.rejects(prisma.creditLateWaiver.create({ data: waiver({ amount: -3 }) }), /credit_late_waivers_amount_pos|check/i);
    await assert.rejects(prisma.creditLateWaiver.create({ data: waiver({ reason: '  ' }) }), /credit_late_waivers_reason_given|check/i);
    await assert.rejects(prisma.creditLateWaiver.create({ data: waiver({ installmentNumber: 0 }) }), /credit_late_waivers_installment_pos|check/i);
  });

  it('🔴 es un hecho INMUTABLE para la aplicación: ni UPDATE ni DELETE', async () => {
    const w = await prisma.creditLateWaiver.findFirstOrThrow({ where: { creditId } });
    const app = appDb();
    try {
      await assert.rejects(app.$executeRawUnsafe(`UPDATE credit_late_waivers SET amount = 999 WHERE id = '${w.id}'`), /permission denied|inmutable/i);
      await assert.rejects(app.$executeRawUnsafe(`DELETE FROM credit_late_waivers WHERE id = '${w.id}'`), /permission denied|inmutable/i);
    } finally {
      await app.$disconnect();
    }
    assert.equal(Number((await prisma.creditLateWaiver.findUniqueOrThrow({ where: { id: w.id } })).amount), 2.5);
  });

  it('🔴 la aplicación sólo ve las exoneraciones de SU empresa (RLS por tenant)', async () => {
    const app = appDb();
    try {
      const mine = await app.$transaction([
        app.$executeRawUnsafe(`SELECT set_config('app.current_account_id', '${accountId}', true)`),
        app.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM credit_late_waivers`),
      ]);
      assert.ok(Number(mine[1][0]!.n) >= 1);
      const other = await app.$transaction([
        app.$executeRawUnsafe(`SELECT set_config('app.current_account_id', 'otra-empresa', true)`),
        app.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM credit_late_waivers`),
      ]);
      assert.equal(Number(other[1][0]!.n), 0);
    } finally {
      await app.$disconnect();
    }
  });

  it('cuando el crédito cambia de responsable, sus exoneraciones siguen al crédito (copias de alcance)', async () => {
    const someone = await prisma.user.findFirstOrThrow({ where: { userAccounts: { some: { accountId } } } });
    await prisma.credit.update({ where: { id: creditId }, data: { assignedManagerId: someone.id } });
    const w = await prisma.creditLateWaiver.findFirstOrThrow({ where: { creditId } });
    assert.equal(w.creditManagerId, someone.id);
  });
});
