/**
 * Imputación de pagos a cuotas (auditoría «Mora vs Cartera»), por las vías reales: API compilada, base real con la migración
 * `payment_applications` y los roles de la aplicación (RLS incluida). Sin mocks: lo que se prueba es lo que queda PERSISTIDO.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/payment-applications.it.ts
 *
 * El crédito es el de la auditoría: 120.000 prestados, 125.000 acordados, 24 cuotas mensuales de 5.208,33, creado con condiciones y cuota
 * fija — o sea, SIN cronograma guardado: el caso en el que el pago movía el saldo y nada más.
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { buildClientePayload, initialCliente } from '@kobrax/shared';
import { civilTodayUTC, timezoneOf } from '../../src/common/context/tenant-clock.service';
import { findPaymentIntegrityViolations } from '../../src/modules/payments/payment-integrity';
import { API, appDb, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi, legalAcceptance } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin: string;

/**
 * «Hoy ± n» en el día CIVIL de la cuenta, no en UTC: con la fecha UTC, entre las 20:00 y la medianoche en Bolivia el servidor ya está en «mañana» y
 * un crédito que «venció ayer» todavía no vencería para la cuenta (justo el desfase que corrige `accountToday`).
 */
let accountTz = 'UTC';
const day = (n: number): string => new Date(civilTodayUTC(accountTz).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const n2 = (x: unknown): number => Math.round(Number(x) * 100) / 100;

async function newClient(label: string): Promise<string> {
  const form = { ...initialCliente(), firstName: label, lastName: 'Imputación', nationalId: `${Math.floor(Math.random() * 9e6) + 1e6}` };
  form.contacts = [{ ...form.contacts[0]!, value: '70000000' }];
  const res = await call<{ id: string }>(admin, 'POST', '/clients', buildClientePayload(form));
  assert.equal(res.status, 201, JSON.stringify(res.error));
  return res.data!.id;
}

/** El crédito de la auditoría. `firstDueOffset` = días desde hoy hasta la cuota 1 (−1 = venció ayer). */
async function newCredit(firstDueOffset: number): Promise<string> {
  const firstDueDate = day(firstDueOffset);
  const res = await call<{ id: string; hasSchedule?: boolean }>(admin, 'POST', '/credits', {
    clientId: await newClient(`C${Math.random().toString(36).slice(2, 7)}`),
    principalAmount: 120000,
    installmentAmount: 5208.33,
    frequency: 'MONTHLY',
    nextDueDate: firstDueDate,
    installmentsCount: 24,
    terms: { definition: 'agreed_total', principal: 120000, agreedTotal: 125000, repayment: 'installments', installmentsCount: 24, frequency: 'MONTHLY', firstDueDate },
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

const state = async (creditId: string) => {
  const c = await prisma.credit.findUniqueOrThrow({ where: { id: creditId } });
  return {
    balance: n2(c.outstandingBalance),
    days: c.daysPastDue,
    status: c.status,
    nextDueDate: (c.metadata as { nextDueDate?: string }).nextDueDate,
  };
};
const applications = async (creditId: string) =>
  (await prisma.paymentApplication.findMany({ where: { creditId }, orderBy: [{ createdAt: 'asc' }, { installmentNumber: 'asc' }] })).map((a) => ({
    installment: a.installmentNumber,
    amount: n2(a.amount),
    kind: a.kind,
    paymentId: a.paymentId,
  }));

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await legalAcceptance()), businessName: `Cobranzas ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  admin = await loginSkippingMfa(email);
  accountTz = timezoneOf(await prisma.account.findFirstOrThrow({ where: { businessName: `Cobranzas ${suffix}` }, select: { timezone: true, countryCode: true } }));
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('el caso de la auditoría: dos pagos de 3.000 sobre una cuota de 5.208,33 ya vencida', () => {
  let credit: string;

  it('el crédito nace con condiciones y SIN cronograma guardado, en mora de 1 día', async () => {
    credit = await newCredit(-1);
    assert.equal(await prisma.creditInstallment.count({ where: { creditId: credit } }), 0);
    assert.deepEqual(await state(credit), { balance: 125000, days: 1, status: 'ACTIVE', nextDueDate: day(-1) });
  });

  it('el primer pago no cubre la cuota: sigue en mora, y queda guardado a qué cuota fue', async () => {
    const r = await pay(credit, 3000);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const s = await state(credit);
    assert.equal(s.balance, 122000);
    assert.equal(s.days, 1);
    assert.deepEqual(await applications(credit), [{ installment: 1, amount: 3000, kind: 'APPLY', paymentId: r.data!.id }]);
    const open = await prisma.creditArrearEpisode.count({ where: { creditId: credit, endedAt: null } });
    assert.equal(open, 1, 'sigue en mora: el episodio sigue abierto');
  });

  it('🔴 el segundo pago ACUMULA: completa la cuota 1, deja 791,67 en la 2, el crédito queda vigente y la mora se cierra', async () => {
    const r = await pay(credit, 3000);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const s = await state(credit);
    assert.equal(s.balance, 119000);
    assert.equal(s.days, 0, 'con lo vencido cubierto ya no hay mora (antes seguía en 1 día con 6.000 pagados)');
    assert.equal(s.status, 'ACTIVE');
    assert.notEqual(s.nextDueDate, day(-1), 'la próxima fecha avanzó a la cuota 2');
    const apps = await applications(credit);
    assert.deepEqual(
      apps.filter((a) => a.paymentId === r.data!.id).map((a) => [a.installment, a.amount]),
      [[1, 2208.33], [2, 791.67]],
    );
    const total = apps.reduce((sum, a) => sum + a.amount, 0);
    assert.equal(n2(total), 6000, 'lo aplicado = lo pagado, sin perder un centavo');
    assert.equal(await prisma.creditArrearEpisode.count({ where: { creditId: credit, endedAt: null } }), 0, 'el trigger cerró el episodio de mora');
  });

  it('la auditoría del pago deja el reparto', async () => {
    const log = await prisma.auditLog.findFirst({ where: { entity: 'payment', action: 'CREATE' }, orderBy: { createdAt: 'desc' } });
    const after = log!.after as { applications?: { installmentNumber: number; amount: number }[] };
    assert.deepEqual(after.applications, [{ installmentNumber: 1, amount: 2208.33 }, { installmentNumber: 2, amount: 791.67 }]);
  });
});

describe('un solo pago que cubre varias cuotas', () => {
  it('10.416,66 sobre dos cuotas vencidas: las dos quedan pagadas y el crédito vigente', async () => {
    const credit = await newCredit(-35); // cuotas 1 (hace 35 días) y 2 (hace 5) vencidas
    assert.ok((await state(credit)).days > 0);
    const r = await pay(credit, 10416.66);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.deepEqual(
      (await applications(credit)).map((a) => [a.installment, a.amount]),
      [[1, 5208.33], [2, 5208.33]],
    );
    const s = await state(credit);
    assert.equal(s.days, 0);
    assert.equal(s.balance, n2(125000 - 10416.66));
  });

  it('un pago mayor que el saldo se rechaza y no deja ninguna aplicación', async () => {
    const credit = await newCredit(5);
    const r = await pay(credit, 125000.01);
    assert.equal(r.status, 400);
    assert.deepEqual(await applications(credit), []);
    assert.equal((await state(credit)).balance, 125000);
  });

  it('un pago anticipado sin mora se aplica en orden y no mueve fechas ni importes del plan', async () => {
    const credit = await newCredit(10);
    const r = await pay(credit, 6000);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.deepEqual((await applications(credit)).map((a) => [a.installment, a.amount]), [[1, 5208.33], [2, 791.67]]);
    assert.equal((await state(credit)).days, 0);
  });
});

describe('integridad: idempotencia y concurrencia', () => {
  it('el mismo Idempotency-Key dos veces registra UN pago y UNA imputación', async () => {
    const credit = await newCredit(10);
    const key = randomUUID();
    const a = await pay(credit, 1000, key);
    const b = await pay(credit, 1000, key);
    assert.equal(a.status, 201);
    assert.ok(b.status === 200 || b.status === 201, JSON.stringify(b));
    assert.equal(b.data!.id, a.data!.id);
    assert.equal(b.data!.idempotentReplay, true);
    assert.equal(await prisma.payment.count({ where: { creditId: credit } }), 1);
    assert.deepEqual((await applications(credit)).map((x) => [x.installment, x.amount]), [[1, 1000]]);
    assert.equal((await state(credit)).balance, 124000);
  });

  it('🔴 el mismo Idempotency-Key a la VEZ (intento en vivo + cola offline): un solo pago', async () => {
    const credit = await newCredit(10);
    const key = randomUUID();
    const results = await Promise.all([pay(credit, 700, key), pay(credit, 700, key), pay(credit, 700, key)]);
    assert.ok(results.every((r) => r.status === 200 || r.status === 201), JSON.stringify(results.map((r) => r.status)));
    assert.equal(new Set(results.map((r) => r.data!.id)).size, 1);
    assert.equal(await prisma.payment.count({ where: { creditId: credit } }), 1);
    assert.equal((await state(credit)).balance, 124300);
  });

  it('🔴 seis pagos simultáneos al mismo crédito no pierden saldo: el saldo, lo aplicado y los recibos cuadran', async () => {
    const credit = await newCredit(10);
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(credit, 500, randomUUID())));
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => [r.status, r.error?.code])));
    const s = await state(credit);
    assert.equal(s.balance, 125000 - 3000, 'antes se pisaban: cada uno escribía «saldo leído − 500»');
    const apps = await applications(credit);
    assert.equal(n2(apps.reduce((sum, a) => sum + a.amount, 0)), 3000);
    const receipts = (await prisma.payment.findMany({ where: { creditId: credit } })).map((p) => p.receiptNumber);
    assert.equal(new Set(receipts).size, 6, 'seis recibos distintos');
  });

  it('pagos simultáneos a créditos DISTINTOS de la misma empresa no chocan por el número de recibo', async () => {
    const credits = await Promise.all([newCredit(10), newCredit(10), newCredit(10), newCredit(10)]);
    const results = await Promise.all(credits.map((c) => pay(c, 100, randomUUID())));
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => [r.status, r.error?.code])));
  });
});

describe('lectura: Cartera, Mora y el historial cuentan la MISMA historia', () => {
  let credit: string;
  type Plan = { situation: string; balance: number; overdueAmount: number; nextPayment: { number: number; dueDate: string; amount: number; overdue: boolean } | null; rows: { number: number; status: string; paid: number; pending: number }[] };

  it('tras los dos pagos de 3.000: el plan de Cartera y el de Mora son idénticos y dicen lo que se espera', async () => {
    credit = await newCredit(-1);
    await pay(credit, 3000);
    await pay(credit, 3000);

    const cartera = await call<{ plan?: Plan; outstandingBalance: number; daysPastDue: number }>(admin, 'GET', `/credits/${credit}`);
    const mora = await call<{ plan?: Plan; balance?: number; daysPastDue: number }>(admin, 'GET', `/mora/${credit}`);
    assert.equal(cartera.status, 200, JSON.stringify(cartera.error));
    assert.equal(mora.status, 200, JSON.stringify(mora.error));
    assert.deepEqual(mora.data!.plan, cartera.data!.plan, 'una sola función, un solo estado');

    const plan = cartera.data!.plan!;
    assert.equal(plan.situation, 'CURRENT');
    assert.equal(plan.balance, 119000);
    assert.equal(plan.overdueAmount, 0);
    assert.deepEqual(plan.rows.slice(0, 3).map((r) => [r.number, r.status, r.paid, r.pending]), [
      [1, 'PAID', 5208.33, 0],
      [2, 'PARTIAL', 791.67, 4416.66],
      [3, 'PENDING', 0, 5208.33],
    ]);
    assert.deepEqual(plan.nextPayment && [plan.nextPayment.number, plan.nextPayment.amount, plan.nextPayment.overdue], [2, 4416.66, false]);
    // El saldo, la mora y el plan coinciden: Σ pendiente de las cuotas = saldo del crédito.
    assert.equal(cartera.data!.outstandingBalance, plan.balance);
    assert.equal(mora.data!.balance, plan.balance);
    assert.equal(mora.data!.daysPastDue, 0);
    assert.equal(cartera.data!.daysPastDue, 0);
  });

  it('el historial del crédito: cada pago con las cuotas que cubrió y el saldo posterior, del más reciente al más antiguo', async () => {
    const r = await call<{
      code?: string;
      plan: { balance: number; collectedAmount: number; prepaidAmount: number } | null;
      payments: { amount: number; status: string; imputation?: { allocations: { installmentNumber: number; amount: number; coversInstallment: boolean }[]; balanceAfter: number } }[];
    }>(admin, 'GET', `/credits/${credit}/payments`);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data!.payments.length, 2);
    const [latest, first] = r.data!.payments;
    assert.equal(latest!.status, 'REGISTERED');
    assert.deepEqual(latest!.imputation!.allocations, [
      { installmentNumber: 1, amount: 2208.33, coversInstallment: true },
      { installmentNumber: 2, amount: 791.67, coversInstallment: false },
    ]);
    assert.equal(latest!.imputation!.balanceAfter, 119000);
    assert.deepEqual(first!.imputation!.allocations, [{ installmentNumber: 1, amount: 3000, coversInstallment: false }]);
    assert.equal(first!.imputation!.balanceAfter, 122000);
    assert.equal(r.data!.plan!.collectedAmount, 6000);
    assert.equal(r.data!.plan!.prepaidAmount, 0);
  });

  it('el historial muestra SÓLO los pagos de ese crédito', async () => {
    const other = await newCredit(10);
    await pay(other, 111);
    const r = await call<{ payments: { creditId: string }[] }>(admin, 'GET', `/credits/${credit}/payments`);
    assert.ok(r.data!.payments.every((p) => p.creditId === credit));
  });

  it('un crédito que no existe (o no se puede ver) responde 404', async () => {
    const r = await call(admin, 'GET', `/credits/${randomUUID()}/payments`);
    assert.equal(r.status, 404);
  });
});

describe('«Monto vencido» de Mora en un crédito con condiciones y sin cronograma guardado', () => {
  type Row = { creditId: string; overdueAmount?: number; overdueSource?: string; daysPastDue: number };
  const listRow = async (creditId: string): Promise<Row | undefined> => {
    const r = await call<Row[]>(admin, 'GET', '/mora?limit=100');
    assert.equal(r.status, 200, JSON.stringify(r.error));
    return r.data!.find((x) => x.creditId === creditId);
  };

  it('🔴 la lista NO lo deja vacío: sin pagos es la cuota vencida; con un pago parcial, lo que falta; y coincide con la ficha y con Cartera', async () => {
    const credit = await newCredit(-1);
    assert.equal((await listRow(credit))?.overdueAmount, 5208.33, 'antes salía vacío («—»)');

    await pay(credit, 3000);
    const parcial = await listRow(credit);
    assert.equal(parcial?.overdueAmount, 2208.33);
    assert.equal(parcial?.overdueSource, 'SCHEDULE');

    const ficha = await call<{ overdueAmount?: number; suggestedPaymentAmount?: number; plan?: { overdueAmount: number } }>(admin, 'GET', `/mora/${credit}`);
    const cartera = await call<{ suggestedPaymentAmount?: number; plan?: { overdueAmount: number } }>(admin, 'GET', `/credits/${credit}`);
    // Los tres lugares dicen lo mismo: lo vencido, y lo que se sugiere cobrar es ese próximo pago.
    assert.equal(ficha.data!.overdueAmount, 2208.33);
    assert.equal(ficha.data!.plan!.overdueAmount, 2208.33);
    assert.equal(cartera.data!.plan!.overdueAmount, 2208.33);
    assert.equal(ficha.data!.suggestedPaymentAmount, 2208.33, 'ya no sugiere la cuota entera (5.208,33)');
    assert.equal(cartera.data!.suggestedPaymentAmount, 2208.33);
  });

  it('al cubrir lo vencido, la ficha dice 0 vencido y sugiere la siguiente cuota (lo que falta de ella)', async () => {
    const credit = await newCredit(-1);
    await pay(credit, 6000);
    const ficha = await call<{ overdueAmount?: number; suggestedPaymentAmount?: number }>(admin, 'GET', `/mora/${credit}`);
    assert.equal(ficha.data!.overdueAmount, 0);
    assert.equal(ficha.data!.suggestedPaymentAmount, 4416.66);
    assert.equal(await listRow(credit), undefined, 'ya no está en mora: sale de la lista');
  });
});

describe('la fecha del pago', () => {
  const noonDaysAgo = (n: number): string => new Date(new Date(`${day(-n)}T12:00:00Z`).getTime()).toISOString();

  it('🔴 un pago de un día anterior queda con ESA fecha de cobro y su fecha de registro aparte', async () => {
    const credit = await newCredit(10);
    const r = await pay(credit, 500, undefined, noonDaysAgo(4));
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: r.data!.id } });
    assert.equal(row.paymentDate.toISOString(), noonDaysAgo(4));
    assert.ok(Date.now() - row.createdAt.getTime() < 60_000, 'registrado ahora');
    // La imputación y el saldo no dependen de la fecha de cobro: se aplicó igual.
    assert.deepEqual((await applications(credit)).map((a) => [a.installment, a.amount]), [[1, 500]]);
    assert.equal((await state(credit)).balance, 124500);
  });

  it('🔴 una fecha FUTURA se rechaza y no deja pago ni imputación', async () => {
    const credit = await newCredit(10);
    const r = await pay(credit, 500, undefined, new Date(Date.now() + 2 * 86_400_000).toISOString());
    assert.equal(r.status, 400);
    assert.equal(await prisma.payment.count({ where: { creditId: credit } }), 0);
    assert.deepEqual(await applications(credit), []);
  });

  it('más viejo que el tope (30 días) se rechaza; justo dentro del tope, no', async () => {
    const credit = await newCredit(10);
    assert.equal((await pay(credit, 100, undefined, noonDaysAgo(45))).status, 400);
    assert.equal((await pay(credit, 100, undefined, noonDaysAgo(29))).status, 201);
  });

  it('un pago cobrado antes pero REGISTRADO después se imputa en orden de registro: no reescribe lo ya aplicado', async () => {
    const credit = await newCredit(-1);
    await pay(credit, 5208.33); // registrado primero: cubre la cuota 1
    const late = await pay(credit, 1000, undefined, noonDaysAgo(3)); // cobrado hace 3 días, registrado ahora
    assert.equal(late.status, 201);
    assert.deepEqual(
      (await applications(credit)).map((a) => [a.installment, a.amount]),
      [[1, 5208.33], [2, 1000]],
      'el cobrado antes NO se cuela delante de lo ya aplicado',
    );
    assert.equal((await state(credit)).days, 0);
  });
});

describe('verificador de coherencia (el trabajo nocturno): reporta, no corrige', () => {
  it('lo que generó el servicio no tiene ningún desvío: pagos, cuotas guardadas y saldos cuadran', async () => {
    const credit = await newCredit(-1);
    await pay(credit, 3000);
    await pay(credit, 3000);
    await pay(credit, 12.5);
    const accountId = (await prisma.credit.findUniqueOrThrow({ where: { id: credit } })).accountId;
    const found = await findPaymentIntegrityViolations(prisma, accountId);
    assert.deepEqual(found, [], JSON.stringify(found.slice(0, 3)));
  });

  it('🔴 si alguien toca la imputación a mano (fuera de la aplicación), el verificador lo detecta y no lo corrige', async () => {
    const credit = await newCredit(10);
    await pay(credit, 1000);
    const accountId = (await prisma.credit.findUniqueOrThrow({ where: { id: credit } })).accountId;
    const app = await prisma.paymentApplication.findFirstOrThrow({ where: { creditId: credit } });
    // Mantenimiento como propietario (la aplicación no puede hacerlo): se infla lo aplicado.
    await prisma.$executeRawUnsafe(`UPDATE payment_applications SET amount = amount + 500 WHERE id = '${app.id}'`);
    try {
      const found = await findPaymentIntegrityViolations(prisma, accountId, { creditId: credit });
      assert.deepEqual(found.map((v) => v.kind).sort(), ['APPLIED_EXCEEDS_PAYMENT', 'BALANCE_MISMATCH'].sort());
      assert.equal(n2((await prisma.paymentApplication.findUniqueOrThrow({ where: { id: app.id } })).amount), 1500, 'sólo reporta: no corrigió nada');
    } finally {
      await prisma.$executeRawUnsafe(`UPDATE payment_applications SET amount = 1000 WHERE id = '${app.id}'`);
    }
    assert.deepEqual(await findPaymentIntegrityViolations(prisma, accountId, { creditId: credit }), []);
  });
});

describe('inmutabilidad (los roles de la aplicación no pueden reescribir la imputación)', () => {
  it('UPDATE y DELETE sobre payment_applications se rechazan con el rol de la aplicación', async () => {
    const some = await prisma.paymentApplication.findFirstOrThrow();
    const app = appDb();
    try {
      await assert.rejects(app.$executeRawUnsafe(`UPDATE payment_applications SET amount = 1 WHERE id = '${some.id}'`), /permission denied|inmutable/i);
      await assert.rejects(app.$executeRawUnsafe(`DELETE FROM payment_applications WHERE id = '${some.id}'`), /permission denied|inmutable/i);
    } finally {
      await app.$disconnect();
    }
    assert.equal(n2((await prisma.paymentApplication.findUniqueOrThrow({ where: { id: some.id } })).amount), n2(some.amount));
  });
});
