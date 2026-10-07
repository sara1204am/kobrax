/**
 * Visita agendada ↔ ruta ↔ ejecución, por las vías reales (F4/11 · E1): API compilada y base real.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 *
 * Lo que los tests unitarios no pueden afirmar: que la parada nazca de la visita, que ejecutarla desde la ruta cierre
 * la gestión con UNA sola actividad, y que el índice único parcial de la migración haga lo que dice.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { call, db, freshDatabase, login, startApi, stopApi } from './harness';

let prisma: PrismaClient;
let token: string;
let collectorId: string;
let creditId: string;
let creditId2: string;
let locationId: string;
let locationId2: string;

/** Un día lejano: el seed no tiene gestiones ni rutas ahí. */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface Item { id: string; status: string }
interface Stop { id: string; creditId?: string; agendaItemId?: string; status: string; sequenceOrder: number }
interface Route { id: string; stops?: Stop[]; totalCases: number }

const visitBody = (credit: string, location: string, date: string) => ({
  creditId: credit,
  type: 'VISIT',
  scheduledDate: date,
  timeMode: 'FIXED',
  scheduledTime: '10:00',
  details: { locationId: location },
});

async function n(sql: string): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql);
  return Number(row!.n);
}

before(async () => {
  await freshDatabase();
  await startApi();
  prisma = db();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'collector@kobrax.demo' } });
  collectorId = user.id;
  token = await login('collector@kobrax.demo');
  // Dos créditos de Carlos cuyo cliente tiene la dirección con punto en el mapa.
  const credits = await prisma.credit.findMany({ where: { code: { in: ['CRD-DEMO-0003', 'CRD-DEMO-0004'] } }, orderBy: { code: 'asc' } });
  const loc = async (clientId: string) => {
    const l = await prisma.clientLocation.findFirstOrThrow({ where: { clientId, latitude: { not: null }, longitude: { not: null } } });
    return l.id;
  };
  creditId = credits[0]!.id;
  creditId2 = credits[1]!.id;
  locationId = await loc(credits[0]!.clientId);
  locationId2 = await loc(credits[1]!.clientId);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

describe('visita agendada → ruta → ejecución (F4/11 · E1)', () => {
  it('toda visita lleva la ubicación: una dirección libre se rechaza (AGENDA_013)', async () => {
    const r = await call(token, 'POST', '/agenda', { ...visitBody(creditId, locationId, day(40)), details: { customAddress: { address: 'Calle 1' } } });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, 'AGENDA_013');
  });

  it('ejecutar la parada cierra la gestión con UNA sola actividad', async () => {
    const date = day(41);
    const item = await call<Item>(token, 'POST', '/agenda', visitBody(creditId, locationId, date));
    assert.equal(item.status, 201, JSON.stringify(item.error));

    // La visita entra sola a la ruta de su día, aunque quien arma la ruta no la elija.
    const route = await call<Route>(token, 'POST', '/routes/generate', { collectorId, plannedDate: date });
    assert.equal(route.status, 201, JSON.stringify(route.error));
    const detail = await call<Route>(token, 'GET', `/routes/${route.data!.id}`);
    const stop = detail.data!.stops!.find((s) => s.agendaItemId === item.data!.id);
    assert.ok(stop, 'la visita agendada es una parada de la ruta');
    assert.equal(stop!.creditId, creditId);
    assert.equal(stop!.sequenceOrder, 1, 'las visitas van primero cuando no se eligieron créditos');

    // Desde la agenda NO se ejecuta: se haría una segunda actividad y sin GPS.
    const bloqueada = await call(token, 'POST', `/agenda/${item.data!.id}/complete`, { outcome: 'CONTACTED' });
    assert.equal(bloqueada.status, 409);
    assert.equal(bloqueada.error?.code, 'AGENDA_014');

    const antes = await n(`SELECT count(*) AS n FROM credit_activities WHERE credit_id = '${creditId}' AND type::text = 'VISIT'`);
    const visit = await call(token, 'POST', '/visits', { routeStopId: stop!.id, lat: -16.5, lng: -68.12, outcome: 'CONTACTED', notes: 'Atendió' });
    assert.equal(visit.status, 201, JSON.stringify(visit.error));

    // Una sola actividad nueva, la gestión ejecutada y enlazada a ella, una sola visita de campo.
    const despues = await n(`SELECT count(*) AS n FROM credit_activities WHERE credit_id = '${creditId}' AND type::text = 'VISIT'`);
    assert.equal(despues - antes, 1, 'una sola actividad VISIT');
    const [row] = await prisma.$queryRawUnsafe<{ status: string; result_activity_id: string | null }[]>(
      `SELECT status::text AS status, result_activity_id FROM agenda_items WHERE id = '${item.data!.id}'`,
    );
    assert.equal(row!.status, 'EXECUTED');
    assert.ok(row!.result_activity_id, 'la gestión apunta a la actividad');
    assert.equal(await n(`SELECT count(*) AS n FROM credit_activities WHERE id = '${row!.result_activity_id}' AND type::text = 'VISIT'`), 1);
    assert.equal(await n(`SELECT count(*) AS n FROM field_visits WHERE route_stop_id = '${stop!.id}'`), 1);
    assert.equal(await n(`SELECT count(*) AS n FROM route_stops WHERE id = '${stop!.id}' AND status::text = 'VISITED'`), 1);
  });

  it('reagendar la visita la saca de la ruta planificada y renumera las demás', async () => {
    const date = day(42);
    const a = await call<Item>(token, 'POST', '/agenda', visitBody(creditId, locationId, date));
    const b = await call<Item>(token, 'POST', '/agenda', { ...visitBody(creditId2, locationId2, date), scheduledTime: '11:00' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const route = await call<Route>(token, 'POST', '/routes/generate', { collectorId, plannedDate: date });
    assert.equal(route.status, 201, JSON.stringify(route.error));
    const antes = await call<Route>(token, 'GET', `/routes/${route.data!.id}`);
    assert.ok(antes.data!.stops!.some((s) => s.agendaItemId === a.data!.id));
    assert.ok(antes.data!.stops!.some((s) => s.agendaItemId === b.data!.id));

    const reasons = await call<{ code: string }[]>(token, 'GET', '/catalogs/RESCHEDULE_REASON');
    const moved = await call<Item>(token, 'POST', `/agenda/${a.data!.id}/reschedule`, {
      scheduledDate: day(43),
      timeMode: 'FIXED',
      scheduledTime: '10:00',
      reasonCode: reasons.data![0]!.code,
    });
    assert.equal(moved.status, 201, JSON.stringify(moved.error));

    const despues = await call<Route>(token, 'GET', `/routes/${route.data!.id}`);
    const stops = despues.data!.stops!;
    assert.ok(!stops.some((s) => s.agendaItemId === a.data!.id), 'la parada de la visita reagendada se fue');
    assert.ok(stops.some((s) => s.agendaItemId === b.data!.id), 'la otra visita sigue');
    assert.deepEqual(stops.map((s) => s.sequenceOrder), stops.map((_, i) => i + 1), 'secuencia sin agujeros');
  });

  it('una visita no entra a dos paradas activas: el índice único parcial lo impide', async () => {
    const date = day(44);
    const item = await call<Item>(token, 'POST', '/agenda', visitBody(creditId, locationId, date));
    const route = await call<Route>(token, 'POST', '/routes/generate', { collectorId, plannedDate: date });
    assert.equal(route.status, 201, JSON.stringify(route.error));
    const route2 = await prisma.routePlan.create({ data: { accountId: (await prisma.credit.findUniqueOrThrow({ where: { id: creditId } })).accountId, collectorId, plannedDate: new Date(day(45)) } });
    const clientId = (await prisma.credit.findUniqueOrThrow({ where: { id: creditId } })).clientId;
    await assert.rejects(
      prisma.routeStop.create({ data: { accountId: route2.accountId, routeId: route2.id, clientId, creditId, agendaItemId: item.data!.id, sequenceOrder: 1 } }),
      /route_stops_agenda_item_active_key|Unique constraint/,
    );
  });
});

describe('desactivar a quien tiene trabajo a su nombre (F4/11 · D1)', () => {
  let admin: string;
  let rosa: string;
  let marco: string;

  before(async () => {
    // El administrador de la demo exige configurar el segundo factor para entrar; un gerente no. Se le presta el permiso de
    // administrar miembros (solo en esta base de prueba) para llamar a la API real sin armar el flujo de MFA.
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
    const perms = await prisma.permission.findMany({ where: { code: { in: ['user:write', 'user:read'] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
    admin = await login('manager@kobrax.demo');
    rosa = (await prisma.user.findUniqueOrThrow({ where: { email: 'cobrador1@kobrax.demo' } })).id;
    marco = (await prisma.user.findUniqueOrThrow({ where: { email: 'cobrador2@kobrax.demo' } })).id;
  });

  it('se rechaza con el conteo de lo que tiene, y no se desactiva', async () => {
    const r = await call(admin, 'PATCH', `/users/${rosa}`, { isActive: false });
    assert.equal(r.status, 409, JSON.stringify(r.error));
    assert.equal(r.error?.code, 'USER_HAS_PENDING_WORK');
    const details = r.error?.details as { agenda: number; credits: number; routes: number };
    assert.ok(details.agenda + details.credits + details.routes > 0);
    assert.equal(await n(`SELECT count(*) AS n FROM user_accounts WHERE user_id = '${rosa}' AND is_active`), 1);
  });

  it('con un destinatario pasa créditos y gestiones y desactiva, todo en un paso', async () => {
    const antes = await n(`SELECT count(*) AS n FROM agenda_items WHERE assignee_id = '${marco}' AND status::text = 'SCHEDULED' AND deleted_at IS NULL`);
    const suyas = await n(`SELECT count(*) AS n FROM agenda_items WHERE assignee_id = '${rosa}' AND status::text = 'SCHEDULED' AND deleted_at IS NULL`);
    assert.ok(suyas > 0, 'el seed le dejó gestiones pendientes a Rosa');

    const r = await call(admin, 'PATCH', `/users/${rosa}`, { isActive: false, reassignToUserId: marco });
    assert.equal(r.status, 200, JSON.stringify(r.error));

    assert.equal(await n(`SELECT count(*) AS n FROM user_accounts WHERE user_id = '${rosa}' AND is_active`), 0, 'quedó desactivada');
    assert.equal(await n(`SELECT count(*) AS n FROM agenda_items WHERE assignee_id = '${rosa}' AND status::text = 'SCHEDULED' AND deleted_at IS NULL`), 0, 'sin gestiones a su nombre');
    assert.equal(await n(`SELECT count(*) AS n FROM credits WHERE assigned_manager_id = '${rosa}' AND deleted_at IS NULL AND status::text NOT IN ('PAID','CANCELLED')`), 0, 'sin créditos a su cargo');
    assert.equal(await n(`SELECT count(*) AS n FROM route_plans WHERE collector_id = '${rosa}' AND status::text IN ('PLANNED','IN_PROGRESS')`), 0, 'sin rutas vivas');
    const despues = await n(`SELECT count(*) AS n FROM agenda_items WHERE assignee_id = '${marco}' AND status::text = 'SCHEDULED' AND deleted_at IS NULL`);
    assert.ok(despues >= antes + suyas, 'Marco recibió lo de Rosa');
  });

  it('un destinatario que no puede recibir se rechaza', async () => {
    // Un administrador que NO es quien hace la baja no recibe cartera (quien pide sí podría quedársela él mismo).
    const dueno = (await prisma.user.findUniqueOrThrow({ where: { email: 'owner@kobrax.demo' } })).id;
    const r = await call(admin, 'PATCH', `/users/${marco}`, { isActive: false, reassignToUserId: dueno });
    assert.equal(r.status, 400, JSON.stringify(r.error));
    assert.equal(r.error?.code, 'USER_REASSIGN_TARGET_INVALID');
  });
});
