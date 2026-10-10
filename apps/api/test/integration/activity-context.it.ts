/**
 * F4/13 · E4 por las vías reales: API compilada y base recreada desde cero, con las columnas nuevas de
 * `credit_activities` y el tipo `payer_party`. Lo que los unitarios no pueden afirmar:
 *   - que la migración corra desde cero y la base acepte el contexto (motivo, fecha esperada, quién responde, origen);
 *   - que se lea de vuelta en la ficha del crédito;
 *   - que lo anterior (sin contexto) siga válido y quede en NULL;
 *   - que lo inválido se rechace con 400 sin escribir nada;
 *   - que la actividad quede auditada **sin el texto libre** de las notas.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { call, db, freshDatabase, login, startApi, stopApi } from './harness';

interface MoraRow {
  creditId: string;
}
interface Activity {
  id: string;
  type: string;
  result?: string;
  reasonCode?: string;
  expectedIncomeDate?: string;
  payerParty?: string;
  origin?: string;
}
interface Detail {
  activities: Activity[];
}

let manager: string;
let prisma: PrismaClient;
let creditId: string;

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  await freshDatabase();
  await startApi();
  prisma = db();
  manager = await login('manager@kobrax.demo');
  const list = await call<MoraRow[]>(manager, 'GET', '/mora?limit=1');
  assert.equal(list.status, 200, JSON.stringify(list.error));
  assert.ok(list.data && list.data.length > 0, 'la demo trae al menos un crédito');
  creditId = list.data[0]!.creditId;
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

const detail = async (): Promise<Detail> => {
  const r = await call<Detail>(manager, 'GET', `/mora/${creditId}`);
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data!;
};

describe('E4 · contexto de la gestión', () => {
  const id = randomUUID();

  it('🔴 guarda el motivo, la fecha esperada, quién responde y el origen, y los devuelve en la ficha', async () => {
    const r = await call(manager, 'POST', `/mora/${creditId}/activities`, {
      id,
      type: 'CALL',
      result: 'NO_ANSWER',
      notes: 'Dijo que su sueldo se atrasa; habla Juan Pérez',
      reasonCode: 'LATE_INCOME',
      expectedIncomeDate: future(5),
      payerParty: 'GUARANTOR',
      origin: 'DICTATION',
    });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.error));
    const act = (await detail()).activities.find((a) => a.id === id);
    assert.ok(act, 'la gestión aparece');
    assert.equal(act!.reasonCode, 'LATE_INCOME');
    assert.equal(act!.expectedIncomeDate, future(5));
    assert.equal(act!.payerParty, 'GUARANTOR');
    assert.equal(act!.origin, 'DICTATION');
  });

  it('los campos nuevos están en la base con sus tipos', async () => {
    const row = await prisma.creditActivity.findUniqueOrThrow({ where: { id } });
    assert.equal(row.reasonCode, 'LATE_INCOME');
    assert.equal(row.payerParty, 'GUARANTOR');
    assert.equal(row.origin, 'DICTATION');
    assert.equal(row.expectedIncomeDate?.toISOString().slice(0, 10), future(5));
  });

  it('🔴 reintentar con el mismo id no duplica la gestión (cola offline)', async () => {
    const r = await call(manager, 'POST', `/mora/${creditId}/activities`, { id, type: 'CALL', result: 'NO_ANSWER', reasonCode: 'LATE_INCOME' });
    assert.ok(r.status === 200 || r.status === 201);
    assert.equal(await prisma.creditActivity.count({ where: { id } }), 1);
  });

  it('🔴 una gestión sin contexto (anterior a estos campos) sigue válida y queda en NULL', async () => {
    const idViejo = randomUUID();
    const r = await call(manager, 'POST', `/mora/${creditId}/activities`, { id: idViejo, type: 'VISIT', result: 'NOT_FOUND' });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.error));
    const row = await prisma.creditActivity.findUniqueOrThrow({ where: { id: idViejo } });
    assert.equal(row.reasonCode, null);
    assert.equal(row.expectedIncomeDate, null);
    assert.equal(row.payerParty, null);
    assert.equal(row.origin, null);
  });

  it('el motivo puede ir junto a una promesa de pago', async () => {
    const r = await call(manager, 'POST', `/mora/${creditId}/activities`, {
      type: 'CALL',
      result: 'PROMISE_TO_PAY',
      promise: { amount: 100, promiseDate: future(6), paymentMethodCode: 'CASH' },
      reasonCode: 'LATE_INCOME',
      expectedIncomeDate: future(5),
    });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.error));
  });

  const invalidos: [string, Record<string, unknown>, string][] = [
    ['motivo con formato inválido', { type: 'CALL', result: 'NO_ANSWER', reasonCode: 'perdió el empleo' }, 'MORA_REASON_INVALID'],
    ['fecha esperada sin motivo', { type: 'CALL', result: 'NO_ANSWER', expectedIncomeDate: future(3) }, 'MORA_EXPECTED_INCOME_DATE_NEEDS_REASON'],
    ['fecha esperada pasada', { type: 'CALL', result: 'NO_ANSWER', reasonCode: 'LATE_INCOME', expectedIncomeDate: '2020-01-01' }, 'MORA_EXPECTED_INCOME_DATE_PAST'],
    ['quién responde inventado', { type: 'CALL', result: 'NO_ANSWER', payerParty: 'VECINO' }, 'MORA_PAYER_INVALID'],
    ['contexto en una nota', { type: 'NOTE', notes: 'x', reasonCode: 'FORGOT' }, 'MORA_CONTEXT_NOT_ALLOWED'],
  ];
  for (const [label, body, code] of invalidos) {
    it(`${label} → 400 ${code}`, async () => {
      const antes = await prisma.creditActivity.count({ where: { creditId } });
      const r = await call(manager, 'POST', `/mora/${creditId}/activities`, body);
      assert.equal(r.status, 400);
      assert.equal(r.error?.code, code);
      assert.equal(await prisma.creditActivity.count({ where: { creditId } }), antes, 'no escribe nada');
    });
  }

  it('🔴 un campo desconocido se rechaza (la API es estricta con lo que no conoce)', async () => {
    const r = await call(manager, 'POST', `/mora/${creditId}/activities`, { type: 'CALL', result: 'NO_ANSWER', motivoInventado: 'x' });
    assert.equal(r.status, 400);
  });

  it('🔴 se audita la gestión con contexto, SIN el texto libre de las notas', async () => {
    const filas = await prisma.auditLog.findMany({ where: { entity: 'credit_activity', entityId: id } });
    assert.equal(filas.length, 1);
    const despues = JSON.stringify(filas[0]!.after);
    assert.ok(despues.includes('LATE_INCOME'));
    assert.ok(!despues.includes('Juan'), 'las notas pueden traer datos personales: no van a la bitácora');
    assert.ok(!despues.includes('sueldo'));
  });
});

describe('E5 · plantilla elegida', () => {
  it('🔴 un mensaje guarda el código de la plantilla y la ficha lo devuelve', async () => {
    const id = randomUUID();
    const r = await call(manager, 'POST', `/mora/${creditId}/activities`, { id, type: 'MESSAGE', result: 'CONTACTED', templateCode: 'LAST_NOTICE' });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.error));
    const fila = await prisma.creditActivity.findUniqueOrThrow({ where: { id } });
    assert.equal(fila.templateCode, 'LAST_NOTICE');
    const act = (await detail()).activities.find((a) => a.id === id) as (Activity & { templateCode?: string }) | undefined;
    assert.equal(act?.templateCode, 'LAST_NOTICE');
  });

  it('una llamada con plantilla se rechaza', async () => {
    const r = await call(manager, 'POST', `/mora/${creditId}/activities`, { type: 'CALL', result: 'CONTACTED', templateCode: 'LAST_NOTICE' });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, 'MORA_TEMPLATE_NOT_ALLOWED');
  });

  it('un mensaje sin plantilla queda con NULL', async () => {
    const id = randomUUID();
    await call(manager, 'POST', `/mora/${creditId}/activities`, { id, type: 'MESSAGE', result: 'NO_ANSWER' });
    const fila = await prisma.creditActivity.findUniqueOrThrow({ where: { id } });
    assert.equal(fila.templateCode, null);
  });
});
