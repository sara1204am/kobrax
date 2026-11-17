/**
 * F15 · P-2 — el cobrador independiente se planifica la jornada a sí mismo (plan C-10, H-9, H-10).
 *
 * La web (`planningTargets`) ahora ofrece a la propia persona si ejecuta rutas. Esto comprueba lo que la web da por hecho del
 * servidor: que `POST /routes/generate` acepta como destinatario a un `ACCOUNT_ADMIN` (no es `COLLECTOR`), y que con una sola
 * persona no se genera ningún pedido de cambio de ruta.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f15-p2-planificar.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { API, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let admin: string;
let adminUserId: string;
let accountId: string;

const tomorrow = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Cobranzas ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  adminUserId = owner.id;
  accountId = owner.userAccounts[0]!.accountId;
  admin = await loginSkippingMfa(email);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('F15·P-2 — planificarse la ruta a uno mismo', () => {
  it('el dueño (ACCOUNT_ADMIN) tiene los permisos que la web exige para ofrecerse: route:assign y route:execute', async () => {
    const me = await call<{ permissions: string[]; role: string }>(admin, 'GET', '/auth/me');
    assert.equal(me.data!.role, 'ACCOUNT_ADMIN');
    assert.ok(me.data!.permissions.includes('route:assign'));
    assert.ok(me.data!.permissions.includes('route:execute'));
  });

  it('🔴 `POST /routes/generate` acepta como destinatario al propio administrador: no responde «el cobrador no pertenece al tenant»', async () => {
    const res = await call(admin, 'POST', '/routes/generate', { collectorId: adminUserId, plannedDate: tomorrow() });
    // Sin créditos en mora no hay paradas que armar (ROUTE_EMPTY): es la respuesta de negocio, NO un rechazo por el rol.
    assert.notEqual(res.error?.code, 'ROUTE_COLLECTOR', JSON.stringify(res.error));
    assert.notEqual(res.status, 403, JSON.stringify(res.error));
    assert.ok([200, 201, 400, 422].includes(res.status), `HTTP ${res.status} ${JSON.stringify(res.error)}`);
    if (res.status >= 400) assert.equal(res.error?.code, 'ROUTE_EMPTY', JSON.stringify(res.error));
  });

  it('un destinatario que no es de la cuenta sí se rechaza (la guarda real sigue en pie)', async () => {
    const res = await call(admin, 'POST', '/routes/generate', { collectorId: randomUUID(), plannedDate: tomorrow() });
    assert.equal(res.error?.code, 'ROUTE_COLLECTOR');
  });

  it('H-10: con una sola persona no se genera ningún pedido de cambio de ruta', async () => {
    const pedidos = await prisma.routeChangeRequest.count({ where: { accountId } });
    assert.equal(pedidos, 0);
  });
});
