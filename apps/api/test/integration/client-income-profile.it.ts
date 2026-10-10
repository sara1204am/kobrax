/**
 * F4/13 · E3 por las vías reales: API compilada y base recreada desde cero, con la tabla nueva `client_income_profiles`
 * y su RLS forzada. Lo que los unitarios no pueden afirmar:
 *   - que la migración corra desde cero y la tabla acepte lo que la API le manda (tipos `income_cycle` y `data_origin`);
 *   - que el perfil viaje con el alta y se lea con el detalle del cliente;
 *   - que el PUT sea idempotente y que un cuerpo vacío lo borre;
 *   - que la base misma rechace un día sin ciclo (CHECK), aunque alguien saltee la API;
 *   - que **otra cuenta no pueda leerlo** (RLS).
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { call, db, freshDatabase, login, startApi, stopApi } from './harness';

interface Perfil {
  incomeSourceCode?: string;
  occupationCode?: string;
  incomeCycle?: string;
  incomeDay?: number;
  notes?: string;
  origin?: string;
}
interface ClientOut {
  id: string;
  incomeProfile?: Perfil | null;
}

let manager: string;
let otraCuenta: string;
let prisma: PrismaClient;
let clientId: string;

const PERFIL: Perfil = { incomeSourceCode: 'EMPLOYEE', occupationCode: 'PUBLIC_SERVANT', incomeCycle: 'QUARTERLY', incomeDay: 15, notes: 'Cobra en la alcaldía cada 3 meses' };

const nuevo = (extra: Record<string, unknown> = {}) => ({
  clientType: 'PERSON',
  firstName: 'Rosa',
  lastName: `Mamani-${randomUUID().slice(0, 6)}`,
  contacts: [{ contactType: 'PHONE', value: '70000002', isPrimary: true }],
  ...extra,
});

before(async () => {
  await freshDatabase();
  await startApi();
  prisma = db();
  manager = await login('manager@kobrax.demo');
  otraCuenta = await login('cobrador.norte@kobrax.demo');
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('E3 · perfil de ingreso', () => {
  it('🔴 el alta lo guarda y el detalle del cliente lo devuelve', async () => {
    const r = await call<ClientOut>(manager, 'POST', '/clients', nuevo({ incomeProfile: PERFIL }));
    assert.equal(r.status, 201, JSON.stringify(r.error));
    clientId = r.data!.id;
    const detalle = await call<ClientOut>(manager, 'GET', `/clients/${clientId}`);
    assert.equal(detalle.status, 200);
    assert.equal(detalle.data!.incomeProfile?.occupationCode, 'PUBLIC_SERVANT');
    assert.equal(detalle.data!.incomeProfile?.incomeCycle, 'QUARTERLY');
    assert.equal(detalle.data!.incomeProfile?.incomeDay, 15);
  });

  it('GET propio del perfil', async () => {
    const r = await call<Perfil>(manager, 'GET', `/clients/${clientId}/income-profile`);
    assert.equal(r.status, 200);
    assert.equal(r.data?.incomeSourceCode, 'EMPLOYEE');
    assert.equal(r.data?.origin, 'MANUAL');
  });

  it('PUT reemplaza el perfil entero (estado final, no parche)', async () => {
    const r = await call<Perfil>(manager, 'PUT', `/clients/${clientId}/income-profile`, { occupationCode: 'TRANSPORT', incomeCycle: 'WEEKLY', incomeDay: 5 });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data?.occupationCode, 'TRANSPORT');
    assert.equal(r.data?.incomeSourceCode, undefined); // no vino: se limpió
    assert.equal(r.data?.notes, undefined);
  });

  it('PUT es idempotente: repetirlo deja una sola fila', async () => {
    const cuerpo = { occupationCode: 'MERCHANT', incomeCycle: 'DAILY' };
    await call(manager, 'PUT', `/clients/${clientId}/income-profile`, cuerpo);
    await call(manager, 'PUT', `/clients/${clientId}/income-profile`, cuerpo);
    assert.equal(await prisma.clientIncomeProfile.count({ where: { clientId } }), 1);
  });

  it('🔴 un día en un ciclo que no lo tiene → 400', async () => {
    const r = await call(manager, 'PUT', `/clients/${clientId}/income-profile`, { incomeCycle: 'DAILY', incomeDay: 5 });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, 'CLIENT_INCOME_PROFILE_INVALID');
  });

  it('una fuente de ingreso inventada → 400', async () => {
    const r = await call(manager, 'PUT', `/clients/${clientId}/income-profile`, { incomeSourceCode: 'JEFE' });
    assert.equal(r.status, 400);
  });

  it('🔴 la propia base rechaza un día sin ciclo, aunque se saltee la API (CHECK)', async () => {
    const cliente = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    await prisma.clientIncomeProfile.deleteMany({ where: { clientId } });
    await assert.rejects(() => prisma.clientIncomeProfile.create({ data: { accountId: cliente.accountId, clientId, incomeDay: 7 } }));
  });

  it('un cuerpo vacío borra el perfil', async () => {
    await call(manager, 'PUT', `/clients/${clientId}/income-profile`, { occupationCode: 'TRANSPORT' });
    const r = await call(manager, 'PUT', `/clients/${clientId}/income-profile`, {});
    assert.equal(r.status, 200);
    const g = await call<Perfil | null>(manager, 'GET', `/clients/${clientId}/income-profile`);
    assert.equal(g.data ?? null, null);
    assert.equal(await prisma.clientIncomeProfile.count({ where: { clientId } }), 0);
  });

  it('un cliente sin perfil sigue funcionando en el detalle', async () => {
    const r = await call<ClientOut>(manager, 'POST', '/clients', nuevo());
    const d = await call<ClientOut>(manager, 'GET', `/clients/${r.data!.id}`);
    assert.equal(d.status, 200);
    assert.ok(d.data!.incomeProfile == null);
  });

  it('el cambio queda en la bitácora', async () => {
    await call(manager, 'PUT', `/clients/${clientId}/income-profile`, { occupationCode: 'TEACHER', incomeCycle: 'MONTHLY', incomeDay: 25 });
    const filas = await prisma.auditLog.findMany({ where: { entity: 'client_income_profile' } });
    assert.ok(filas.some((f) => f.action === 'CREATE' || f.action === 'UPDATE'));
    assert.ok(filas.some((f) => f.action === 'DELETE'));
  });
});

describe('E3 · aislamiento entre cuentas (RLS)', () => {
  it('🔴 otra cuenta no puede leer ni escribir el perfil', async () => {
    await call(manager, 'PUT', `/clients/${clientId}/income-profile`, PERFIL);
    const lee = await call(otraCuenta, 'GET', `/clients/${clientId}/income-profile`);
    assert.equal(lee.status, 404);
    const escribe = await call(otraCuenta, 'PUT', `/clients/${clientId}/income-profile`, { occupationCode: 'HACKEO' });
    assert.equal(escribe.status, 404);
    const sigue = await prisma.clientIncomeProfile.findFirstOrThrow({ where: { clientId } });
    assert.equal(sigue.occupationCode, 'PUBLIC_SERVANT');
  });
});

describe('E3 · la demo trae datos de contexto (seed)', () => {
  it('perfiles de ingreso: un funcionario con ciclo trimestral y un transportista semanal', async () => {
    const perfiles = await prisma.clientIncomeProfile.findMany({ where: { account: { code: 'DEMO' } } });
    assert.ok(perfiles.length >= 4, 'hay perfiles de ejemplo');
    assert.ok(perfiles.some((p) => p.occupationCode === 'PUBLIC_SERVANT' && p.incomeCycle === 'QUARTERLY' && p.incomeDay === 15));
    assert.ok(perfiles.some((p) => p.occupationCode === 'TRANSPORT' && p.incomeCycle === 'WEEKLY'));
  });

  it('perfil de cobro: lugares con modalidad y franja', async () => {
    // visit_schedule es JSON: se cuenta por SQL para no depender de cómo Prisma filtra nulos de JSON.
    const filas = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM client_locations WHERE visit_schedule IS NOT NULL`;
    assert.ok(Number(filas[0]!.n) > 0, 'hay lugares con perfil de cobro');
  });

  it('gestiones con motivo, quién responde y plantilla', async () => {
    const act = await prisma.creditActivity.findMany({ where: { reasonCode: { not: null } } });
    assert.ok(act.length >= 4);
    const motivos = new Set(act.map((a) => a.reasonCode));
    for (const m of ['LATE_INCOME', 'OVER_INDEBTED', 'CREDIT_FOR_OTHER', 'MOVED_OR_PHONE_CHANGED']) assert.ok(motivos.has(m), `falta ${m}`);
    assert.ok(await prisma.creditActivity.findFirst({ where: { templateCode: { not: null } } }));
  });

  it('los motivos sembrados existen en el catálogo de la cuenta demo (la demo es coherente consigo misma)', async () => {
    const usados = await prisma.creditActivity.findMany({ where: { reasonCode: { not: null } }, select: { reasonCode: true }, distinct: ['reasonCode'] });
    const catalogo = await prisma.catalogItem.findMany({ where: { catalog: 'NO_PAYMENT_REASON', account: { code: 'DEMO' } }, select: { code: true } });
    const codigos = new Set(catalogo.map((c) => c.code));
    for (const u of usados) assert.ok(codigos.has(u.reasonCode!), `${u.reasonCode} no está en el catálogo`);
  });
});
