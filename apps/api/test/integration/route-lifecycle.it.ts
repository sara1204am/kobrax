/**
 * Ruta → ciclo de vida → visita desde el panel → cobro → pedidos de cambio (F4/12), por las vías reales: API compilada,
 * base real (migración incluida) y los permisos de verdad de cada rol.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 *
 * Lo que los unitarios no pueden afirmar: que la migración corra, que el `ValidationPipe` acepte lo que dice aceptar,
 * que la RLS y los únicos no se pisen con las paradas saltadas, y que la autoría se cumpla con los roles reales.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { call, db, freshDatabase, login, startApi, stopApi } from './harness';

let prisma: PrismaClient;
let manager: string; // Mónica: administra rutas (assign/write), NO ejecuta
let collector: string; // Carlos
let managerId: string;
let collectorId: string;
let credit1: string;
let credit2: string;

// Días relativos a hoy y DENTRO de la ventana de planificación (ROUTE_MAX_DAYS_AHEAD = 14, D-6). La semilla ocupa hoy y mañana
// de los cobradores demo: las pruebas usan del 2 al 14 para no chocar con ella ni entre sí.
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface Stop { id: string; creditId?: string; status: string; sequenceOrder: number; locationId?: string }
interface Caps { edit: boolean; start: boolean; complete: boolean; cancel: boolean; requestChange: boolean; recordVisit: boolean; cancelBlockedByVisits: boolean; isOwner: boolean }
interface Route { id: string; status: string; createdBy?: string; stops?: Stop[]; capabilities?: Caps; pendingRequests?: number; startedAt?: string; statusReason?: string }
interface Req { id: string; status: string; kind: string }

before(async () => {
  await freshDatabase();
  await startApi();
  prisma = db();
  manager = await login('manager@kobrax.demo');
  collector = await login('collector@kobrax.demo');
  managerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'manager@kobrax.demo' } })).id;
  collectorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'collector@kobrax.demo' } })).id;
  const credits = await prisma.credit.findMany({ where: { code: { in: ['CRD-DEMO-0003', 'CRD-DEMO-0004'] } }, orderBy: { code: 'asc' } });
  credit1 = credits[0]!.id;
  credit2 = credits[1]!.id;
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('F4/12 · la ruta de la manager para Carlos', () => {
  let routeId: string;
  let stop1: string;
  let stop2: string;
  let visitId: string;

  it('la manager arma la ruta con la ubicación de cada crédito: queda a su nombre y el cobrador recibe el aviso', async () => {
    const r = await call<Route>(manager, 'POST', '/routes/generate', {
      collectorId,
      plannedDate: day(5),
      creditIds: [credit1, credit2],
      requirePoints: true,
    });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    routeId = r.data!.id;
    assert.equal(r.data!.createdBy, managerId);

    const detail = await call<Route>(manager, 'GET', `/routes/${routeId}`);
    assert.equal(detail.data!.stops!.length, 2);
    assert.ok(detail.data!.stops!.every((s) => s.locationId), 'cada parada guarda su ubicación concreta');
    stop1 = detail.data!.stops![0]!.id;
    stop2 = detail.data!.stops![1]!.id;

    // El aviso viaja por el bus de eventos, aparte de la respuesta: se espera a que quede escrito.
    let n = 0;
    for (let i = 0; i < 20 && n === 0; i++) {
      n = await prisma.notification.count({ where: { userId: collectorId, type: 'ROUTE_ASSIGNED', routeId } });
      if (n === 0) await new Promise((ok) => setTimeout(ok, 100));
    }
    assert.equal(n, 1, 'Carlos recibe «te armaron la ruta», con enlace a la ruta');
  });

  it('el detalle dice qué puede hacer cada uno: la manager arma, Carlos anda y pide', async () => {
    const m = (await call<Route>(manager, 'GET', `/routes/${routeId}`)).data!.capabilities!;
    assert.equal(m.edit, true);
    assert.equal(m.isOwner, true);
    const c = (await call<Route>(collector, 'GET', `/routes/${routeId}`)).data!.capabilities!;
    assert.equal(c.edit, false);
    assert.equal(c.requestChange, true);
    assert.equal(c.start, true);
    assert.equal(c.complete, false);
  });

  it('🔴 Carlos NO edita la ruta que armó la manager: la pide, con motivo, y la manager aprueba', async () => {
    const direct = await call(collector, 'DELETE', `/routes/${routeId}/stops/${stop2}`);
    assert.equal(direct.status, 403);
    assert.equal(direct.error?.code, 'ROUTE_REQUEST_REQUIRED');

    const noReason = await call(collector, 'POST', `/routes/${routeId}/change-requests`, { kind: 'REMOVE_STOP', payload: { stopId: stop2 }, reason: '.' });
    assert.equal(noReason.status, 422);
    assert.equal(noReason.error?.code, 'ROUTE_REASON_REQUIRED');

    const asked = await call<Req>(collector, 'POST', `/routes/${routeId}/change-requests`, { kind: 'REMOVE_STOP', payload: { stopId: stop2 }, reason: 'Ese cliente se mudó de zona' });
    assert.equal(asked.status, 201, JSON.stringify(asked.error));

    // La manager lo ve pendiente en el detalle, y Carlos no puede aprobar su propio pedido.
    assert.equal((await call<Route>(manager, 'GET', `/routes/${routeId}`)).data!.pendingRequests, 1);
    const self = await call(collector, 'PATCH', `/routes/${routeId}/change-requests/${asked.data!.id}`, { decision: 'APPROVE' });
    assert.equal(self.status, 403);

    const ok = await call<Req>(manager, 'PATCH', `/routes/${routeId}/change-requests/${asked.data!.id}`, { decision: 'APPROVE', note: 'Dale' });
    assert.equal(ok.status, 200, JSON.stringify(ok.error));
    assert.equal(ok.data!.status, 'APPROVED');
    const after = await call<Route>(manager, 'GET', `/routes/${routeId}`);
    assert.equal(after.data!.stops!.length, 1, 'la parada se quitó al aprobar');
    assert.equal(after.data!.pendingRequests, 0);

    const again = await call(manager, 'PATCH', `/routes/${routeId}/change-requests/${asked.data!.id}`, { decision: 'REJECT' });
    assert.equal(again.status, 409, 'un pedido resuelto no se resuelve dos veces');
  });

  it('la manager vuelve a agregar la parada (ella sí arma): el vínculo con la ubicación queda', async () => {
    const add = await call<Stop>(manager, 'POST', `/routes/${routeId}/stops`, { clientId: (await prisma.credit.findUniqueOrThrow({ where: { id: credit2 } })).clientId, creditId: credit2 });
    assert.equal(add.status, 201, JSON.stringify(add.error));
    assert.ok(add.data!.locationId);
    stop2 = add.data!.id;
  });

  it('iniciar y completar son de Carlos; las transiciones inválidas se rechazan con su código', async () => {
    const badStart = await call(collector, 'PATCH', `/routes/${routeId}`, { status: 'COMPLETED' });
    assert.equal(badStart.status, 422);
    assert.equal(badStart.error?.code, 'ROUTE_TRANSITION', 'no se completa lo que nunca se inició');

    const start = await call<Route>(collector, 'PATCH', `/routes/${routeId}`, { status: 'IN_PROGRESS' });
    assert.equal(start.status, 200, JSON.stringify(start.error));
    assert.ok(start.data!.startedAt);
    const again = await call<Route>(collector, 'PATCH', `/routes/${routeId}`, { status: 'IN_PROGRESS' });
    assert.equal(again.status, 200, 'pedir el estado en que ya está es un reintento, no un error');
  });

  it('🔴 la manager (que no ejecuta) registra la visita A NOMBRE de Carlos: queda marcada, con GPS estimado', async () => {
    const r = await call<{ id: string }>(manager, 'POST', '/visits', {
      routeStopId: stop1,
      lat: -16.5,
      lng: -68.15,
      outcome: 'NO_CONTACT',
      details: { channel: 'DOOR', noticeLeft: true },
      notes: 'Carlos se quedó sin batería',
      source: 'WEB',
    });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    visitId = r.data!.id;
    const v = await prisma.fieldVisit.findUniqueOrThrow({ where: { id: visitId } });
    assert.equal(v.collectorId, collectorId, 'la visita es del cobrador de la ruta');
    assert.equal(v.registeredBy, managerId, 'y dice quién la cargó');
    assert.equal(v.source, 'WEB');
    assert.equal((v.details as Record<string, unknown>).gpsFallback, true);
    const stop = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop1 } });
    assert.equal(stop.status, 'VISITED');
    const audited = await prisma.auditLog.count({ where: { entity: 'field_visit', entityId: visitId, action: 'CREATE' } });
    assert.equal(audited, 1, 'la creación de la visita queda auditada');
  });

  it('una visita no se edita ni se repite: se corrige con una NUEVA que dice cuál corrige', async () => {
    const body = { routeStopId: stop1, lat: -16.5, lng: -68.15, outcome: 'NO_CONTACT', details: { channel: 'CALL' }, source: 'WEB' };
    const dup = await call(manager, 'POST', '/visits', body);
    assert.equal(dup.status, 409);
    assert.equal(dup.error?.code, 'VISIT_STOP_DONE');

    const fix = await call<{ id: string }>(manager, 'POST', '/visits', { ...body, correctsVisitId: visitId, notes: 'Era llamada, no puerta' });
    assert.equal(fix.status, 201, JSON.stringify(fix.error));
    const v = await prisma.fieldVisit.findUniqueOrThrow({ where: { id: fix.data!.id } });
    assert.equal(v.correctsVisitId, visitId);
    const visits = await prisma.fieldVisit.count({ where: { routeStopId: stop1 } });
    assert.equal(visits, 2, 'la original sigue intacta (inmutable)');
  });

  it('🔴 otro cobrador no registra sobre la parada de Carlos', async () => {
    const rosa = await login('cobrador1@kobrax.demo');
    const r = await call(rosa, 'POST', '/visits', { routeStopId: stop2, lat: -16.5, lng: -68.15, outcome: 'NO_CONTACT', details: { channel: 'DOOR' } });
    assert.equal(r.status, 404);
  });

  it('el cobro dentro de la visita queda ligado a ella; una visita de otro crédito se rechaza', async () => {
    const ok = await call<{ id: string; visitId?: string }>(collector, 'POST', '/payments', { creditId: credit1, amount: 1, method: 'CASH', visitId });
    assert.equal(ok.status, 201, JSON.stringify(ok.error));
    assert.equal(ok.data!.visitId, visitId);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: ok.data!.id } });
    assert.equal(row.visitId, visitId);

    const wrong = await call(collector, 'POST', '/payments', { creditId: credit2, amount: 1, method: 'CASH', visitId });
    assert.equal(wrong.status, 400, 'la visita es del crédito 1, no del 2');
  });

  it('🔴 con visitas registradas no se cancela: se completa; y completar con una parada sin gestionar deja SALTADA esa parada', async () => {
    const cancel = await call(collector, 'PATCH', `/routes/${routeId}`, { status: 'CANCELLED', reason: 'Quiero cancelar todo' });
    assert.equal(cancel.status, 422);
    assert.equal(cancel.error?.code, 'ROUTE_HAS_VISITS');

    const done = await call<Route>(collector, 'PATCH', `/routes/${routeId}`, { status: 'COMPLETED' });
    assert.equal(done.status, 200, JSON.stringify(done.error));
    const second = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop2 } });
    assert.equal(second.status, 'SKIPPED');
    const repeat = await call(collector, 'PATCH', `/routes/${routeId}`, { status: 'COMPLETED' });
    assert.equal(repeat.status, 200, 'completar dos veces es un reintento');
    const events = await prisma.auditLog.count({ where: { entity: 'route', entityId: routeId, action: 'UPDATE' } });
    assert.equal(events, 2, 'iniciar y completar: el reintento no vuelve a auditar');

    const reopen = await call(collector, 'PATCH', `/routes/${routeId}`, { status: 'IN_PROGRESS' });
    assert.equal(reopen.status, 422);
    assert.equal(reopen.error?.code, 'ROUTE_TRANSITION');
  });

  it('una ruta cerrada no se modifica, pero lo que se olvidó registrar sí se registra (la parada saltada pasa a visitada)', async () => {
    const closed = await call(manager, 'POST', `/routes/${routeId}/stops`, { clientId: (await prisma.credit.findUniqueOrThrow({ where: { id: credit1 } })).clientId, creditId: credit1 });
    assert.equal(closed.status, 422);
    assert.equal(closed.error?.code, 'ROUTE_CLOSED');

    const late = await call(manager, 'POST', '/visits', { routeStopId: stop2, lat: -16.5, lng: -68.15, outcome: 'NO_CONTACT', details: { channel: 'DOOR' }, source: 'WEB' });
    assert.equal(late.status, 201, JSON.stringify(late.error));
    assert.equal((await prisma.routeStop.findUniqueOrThrow({ where: { id: stop2 } })).status, 'VISITED');
  });
});

describe('F4/12 · cancelar, fechas y autoría', () => {
  it('🔴 no se arma una ruta para un día que ya pasó, y la fecha es solo el día', async () => {
    const past = await call(manager, 'POST', '/routes/generate', { collectorId, plannedDate: day(-2), creditIds: [credit1] });
    assert.equal(past.status, 422);
    assert.equal(past.error?.code, 'ROUTE_PAST_DATE');
    const withTime = await call(manager, 'POST', '/routes/generate', { collectorId, plannedDate: `${day(6)}T00:00:00.000Z`, creditIds: [credit1] });
    assert.equal(withTime.status, 400);
  });

  it('cancelar exige el motivo, deja las paradas SALTADAS (la visita agendada queda libre) y avisa al cobrador', async () => {
    const r = await call<Route>(manager, 'POST', '/routes/generate', { collectorId, plannedDate: day(7), creditIds: [credit1] });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const id = r.data!.id;

    const noReason = await call(manager, 'PATCH', `/routes/${id}`, { status: 'CANCELLED' });
    assert.equal(noReason.status, 422);
    assert.equal(noReason.error?.code, 'ROUTE_REASON_REQUIRED');

    const ok = await call<Route>(manager, 'PATCH', `/routes/${id}`, { status: 'CANCELLED', reason: 'Cambio de zona del cobrador' });
    assert.equal(ok.status, 200, JSON.stringify(ok.error));
    assert.equal(ok.data!.statusReason, 'Cambio de zona del cobrador');
    const stops = await prisma.routeStop.findMany({ where: { routeId: id } });
    assert.ok(stops.every((s) => s.status === 'SKIPPED'));

    let n = 0;
    for (let i = 0; i < 20 && n === 0; i++) {
      n = await prisma.notification.count({ where: { userId: collectorId, type: 'ROUTE_CANCELLED', routeId: id } });
      if (n === 0) await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(n, 1);
  });

  it('el cobrador que arma SU propia ruta la edita directo (él es quien la armó)', async () => {
    const r = await call<Route>(collector, 'POST', '/routes/generate', { collectorId, plannedDate: day(8), creditIds: [credit1] });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data!.createdBy, collectorId);
    const detail = await call<Route>(collector, 'GET', `/routes/${r.data!.id}`);
    assert.equal(detail.data!.capabilities!.edit, true);
    const del = await call(collector, 'DELETE', `/routes/${r.data!.id}/stops/${detail.data!.stops![0]!.id}`);
    assert.equal(del.status, 204);
  });

  it('el listado trae lo de la vista «Hoy»: siguiente parada y cobrado del día', async () => {
    const list = await call<{ id: string; nextStop?: { sequenceOrder: number }; collected?: number }[]>(manager, 'GET', `/routes?date=${day(5)}&collectorId=${collectorId}`);
    assert.equal(list.status, 200);
    const row = list.data![0]!;
    assert.equal(typeof row.collected, 'number');
    assert.equal(row.nextStop, undefined, 'todas las paradas de esa ruta ya se gestionaron');
  });
});
