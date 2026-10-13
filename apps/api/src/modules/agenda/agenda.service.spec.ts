import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgendaService } from './agenda.service';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CONTACT = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';
/** Segundo teléfono del deudor: el detalle NO debe emitirlo (sólo el que eligió la gestión). */
const OTHER_CONTACT = '33333333-3333-4333-8333-333333333333';

/** `YYYY-MM-DD` de hoy y de mañana en UTC (el server ancla `scheduledDate` a medianoche UTC). */
function isoUTC(offsetDays = 0): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offsetDays)).toISOString().slice(0, 10);
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', clientId: 'cl1', creditId: 'cr1', assigneeId: 'u1', createdBy: 'u1',
    type: 'CALL', status: 'SCHEDULED', priorityCode: null, expectedResultCode: null,
    scheduledDate: new Date('2026-07-08'), timeMode: 'FIXED', scheduledTime: '09:00',
    timeSlot: null, observations: null, details: {}, resultActivityId: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

/** Crédito de `cl1` (saldo 1000, moneda BOB), a cargo de `u1`. `daysPastDue: 0` = al día. Sin caso de por medio. */
function creditRow(over: Record<string, unknown> = {}) {
  return {
    id: UUID, clientId: 'cl1', code: 'CR-001', principalAmount: 1500, outstandingBalance: 1000, currency: 'BOB',
    daysPastDue: 12, deletedAt: null, assignedManagerId: 'u1', externalSource: null,
    ...over,
  };
}

interface Opts {
  /** Hora de pared de la empresa «ahora», en minutos desde su medianoche (por defecto 00:00). */
  nowMinutes?: number;
  permissions?: string[];
  rows?: unknown[];
  clients?: unknown[];
  credits?: unknown[];
  /** Episodio de mora abierto del crédito (`null`/ausente = al día). */
  episode?: { id: string } | null;
  contacts?: unknown[];
  locations?: unknown[];
  catalog?: Record<string, unknown> | null;
  installments?: unknown[];
  /** `findOne`: el ítem que resuelve el scope (`null` → 404). */
  item?: Record<string, unknown> | null;
  /** `findOne`: las otras gestiones del mismo caso. */
  history?: unknown[];
  /** `findOne`: el crédito del ítem. */
  credit?: Record<string, unknown> | null;
  /** `findOne`: filas de catálogo que resuelven los `code`s de una promesa. */
  catalogRows?: { code: string; label: string }[];
  /** `complete`: la actividad que dejó la ejecución anterior (reintento). */
  priorActivity?: { result: string } | null;
  /** `create`: la 1ª alta choca con la PK (carrera); desde ahí `findFirst` devuelve este ítem. */
  createRace?: Record<string, unknown>;
  /** Rangos de mora de la cuenta (`arrear_categories`). */
  categories?: Record<string, unknown>[];
  /** `userAccount` de la cuenta (nombres de quienes atienden). */
  userAccounts?: unknown[];
  /** Miembros que `resolveAssignee` busca por id (destinatarios de una asignación). */
  members?: { userId: string; isActive: boolean; branchId: string | null; role: { name: string } }[];
  /** La membresía de quien opera (u1): su agencia. */
  me?: { branchId: string | null };
  /** `summary`: cuántas pendientes de hoy / vencidas, y su reparto por persona. */
  todayCount?: number;
  overdueCount?: number;
  todayBy?: { assigneeId: string; _count: { _all: number } }[];
  overdueBy?: { assigneeId: string; _count: { _all: number } }[];
  /** `findOne`: las actividades de bitácora que cerraron gestiones (resultado y nota). */
  activities?: { id: string; result: string | null; notes: string | null; userId: string | null; createdAt: Date }[];
  /** `findOne`: la gestión a la que se movió una reagendada. */
  successor?: { id: string; scheduledDate: Date } | null;
  /** La parada activa que lleva la gestión (visita en ruta). */
  activeStop?: { id: string; routeId?: string; status?: string } | null;
  /** La ruta del cobrador ese día (planificada o en curso). */
  route?: { id: string; status: string } | null;
  /** `summary`: ejecutadas con gestión real (sus `resultActivityId`) y cuántas de esas gestiones son de hoy. */
  executedActivityIds?: string[];
  activitiesToday?: number;
  promisesDueCount?: number;
  promisesTakenCount?: number;
}

function makeService(opts: Opts = {}) {
  const calls = {
    listWhere: undefined as Record<string, unknown> | undefined,
    itemWhere: undefined as Record<string, unknown> | undefined,
    historyWhere: undefined as Record<string, unknown> | undefined,
    visibleSql: undefined as { sql: string; values: unknown[] } | undefined,
    creditUpdate: undefined as Record<string, unknown> | undefined,
    created: undefined as Record<string, unknown> | undefined,
    /** Todas las altas, en orden: la promesa crea DOS agendados (ella y su recordatorio, S5·D2). */
    createdAll: [] as Record<string, unknown>[],
    audits: [] as { entity: string; action: string }[],
    reveals: [] as { id: string; reveal: boolean }[],
    addedContacts: [] as Record<string, unknown>[],
    addedLocations: [] as Record<string, unknown>[],
    activity: undefined as Record<string, unknown> | undefined,
    updated: undefined as Record<string, unknown> | undefined,
    events: [] as string[],
    eventPayloads: [] as { event: string; payload: Record<string, unknown> }[],
    stopOps: [] as Record<string, unknown>[],
    counts: [] as unknown[],
    executedWhere: undefined as Record<string, unknown> | undefined,
    promiseWheres: [] as Record<string, unknown>[],
    activityWhere: undefined as Record<string, unknown> | undefined,
    reminderCancels: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    /** Cuántas veces se consultó cada tabla del enriquecimiento: tiene que ser UNA por página (sin N+1). */
    queries: { credit: 0, category: 0, users: 0 },
    creditSelect: undefined as Record<string, unknown> | undefined,
  };
  let raced = false;
  const first = <T>(list: T[] | undefined) => (list && list.length > 0 ? list[0] : null);
  const tx = {
    agendaItem: {
      findMany: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
        // `summary`: las ejecutadas con gestión real (solo pide `resultActivityId`).
        if (args.select && 'resultActivityId' in args.select) {
          calls.executedWhere = args.where;
          return (opts.executedActivityIds ?? []).map((id) => ({ resultActivityId: id }));
        }
        // `findOne` pide el historial por `creditId`; el resto de las lecturas listan por día/vencidos.
        if (args.where?.creditId && args.where?.id) {
          calls.historyWhere = args.where;
          return opts.history ?? [];
        }
        calls.listWhere = args.where;
        return opts.rows ?? [];
      },
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        // La gestión a la que se movió una reagendada (`rescheduledFromId`), no la del scope.
        if (args.where?.rescheduledFromId !== undefined) return opts.successor ?? null;
        calls.itemWhere = args.where;
        if (opts.createRace) return raced ? opts.createRace : null;
        return opts.item ?? null;
      },
      count: async (args?: { where?: { scheduledDate?: unknown; type?: string; status?: string } }) => {
        // `summary`: promesas que vencen hoy (SCHEDULED) y promesas tomadas hoy (por fecha de creación).
        if (args?.where?.type === 'PROMISE_TO_PAY') {
          calls.promiseWheres.push(args.where as Record<string, unknown>);
          return args.where.status ? (opts.promisesDueCount ?? 0) : (opts.promisesTakenCount ?? 0);
        }
        // `summary` cuenta dos veces: hoy (fecha exacta) y vencidas (`lt`).
        calls.counts.push(args?.where?.scheduledDate);
        return args?.where?.scheduledDate instanceof Date ? (opts.todayCount ?? 0) : (opts.overdueCount ?? 0);
      },
      groupBy: async (args: { where: { scheduledDate: unknown } }) => (args.where.scheduledDate instanceof Date ? (opts.todayBy ?? []) : (opts.overdueBy ?? [])),
      create: async (args: { data: Record<string, unknown> }) => {
        if (opts.createRace && !raced) {
          raced = true;
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        // `created` sigue siendo la PRIMERA alta (lo que esperan los tests de S2); `createdAll`
        // guarda todas, porque la promesa además crea su recordatorio.
        calls.created ??= args.data;
        calls.createdAll.push(args.data);
        return row(args.data);
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.updated = args.data;
        return row({ ...(opts.item ?? {}), ...args.data, id: args.where.id });
      },
      // El recordatorio de la promesa se cancela con `updateMany` sobre `details.promiseItemId`.
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.reminderCancels.push(args);
        return { count: 1 };
      },
    },
    creditActivity: {
      // El detalle y su historial piden el resultado de las ejecutadas.
      findMany: async () => opts.activities ?? [],
      count: async (args: { where: Record<string, unknown> }) => {
        calls.activityWhere = args.where;
        return opts.activitiesToday ?? 0;
      },
      findFirst: async () => opts.priorActivity ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.activity = args.data;
        return { id: 'act-1', ...args.data };
      },
    },
    // Visibilidad por crédito (mismo alcance que la ficha de mora): una fila por cada crédito visible.
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      calls.visibleSql = { sql: q.sql, values: q.values };
      return ((opts.credits ?? []) as { id: string; clientId: string }[]).map((c) => ({ id: c.id, client_id: c.clientId }));
    },
    creditArrearEpisode: { findFirst: async () => opts.episode ?? null },
    credit: {
      findFirst: async () => opts.credit ?? first(opts.credits as unknown[] | undefined),
      findMany: async (args?: { select?: Record<string, unknown> }) => {
        // El enriquecimiento de la lista pide `arrearEpisodes`; los demás usos (agendables) no.
        if (args?.select && 'arrearEpisodes' in args.select) {
          calls.queries.credit += 1;
          calls.creditSelect = args.select;
        }
        return opts.credits ?? [];
      },
      update: async (args: { data: Record<string, unknown> }) => {
        calls.creditUpdate = args.data;
        return {};
      },
    },
    client: { findMany: async () => opts.clients ?? [] },
    arrearCategory: {
      findMany: async () => {
        calls.queries.category += 1;
        return opts.categories ?? [];
      },
    },
    userAccount: {
      findMany: async () => {
        calls.queries.users += 1;
        return opts.userAccounts ?? [];
      },
      findFirst: async (args: { where?: { userId?: string } }) =>
        args.where?.userId === 'u1' ? (opts.me ?? { branchId: null }) : ((opts.members ?? []).find((m) => m.userId === args.where?.userId) ?? null),
    },
    clientContact: { findFirst: async () => first(opts.contacts as unknown[]) },
    clientLocation: { findFirst: async () => first(opts.locations as unknown[]) },
    catalogItem: {
      findFirst: async () => opts.catalog ?? null,
      findMany: async () => opts.catalogRows ?? [],
    },
    creditInstallment: { groupBy: async () => opts.installments ?? [] },
    // Paradas y rutas: el vínculo visita ↔ parada (F4/11). Cada escritura queda anotada en `calls.stopOps`.
    routeStop: {
      findFirst: async () => opts.activeStop ?? null,
      findMany: async () => (opts.activeStop ? [{ id: opts.activeStop.id, routeId: opts.activeStop.routeId ?? 'r1' }] : []),
      count: async () => 0,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.stopOps.push({ op: 'create', ...args.data });
        return {};
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.stopOps.push({ op: 'update', id: args.where.id, ...args.data });
        return {};
      },
      delete: async (args: { where: { id: string } }) => {
        calls.stopOps.push({ op: 'delete', id: args.where.id });
        return {};
      },
    },
    routePlan: {
      findFirst: async () => opts.route ?? null,
      update: async () => ({}),
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const perms = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'u1', permissions: perms, can: (p: string) => perms.includes(p) };
  const audit = {
    record: async (e: { entity: string; action: string }) => void calls.audits.push({ entity: e.entity, action: e.action }),
  };
  const clientsService = {
    findOne: async (id: string, reveal: boolean) => {
      calls.reveals.push({ id, reveal });
      return {
        id, firstName: 'Ana', lastName: 'Ruiz', nationalId: '8821903',
        contacts: [
          { id: CONTACT, contactType: 'PHONE', value: '78012345', isPrimary: true },
          { id: OTHER_CONTACT, contactType: 'PHONE', value: '79999999', isPrimary: false },
        ],
        locations: [
          { id: LOCATION, locationType: 'HOME', address: 'Av. Siempre Viva 742', zone: 'Sur', latitude: -17.78, longitude: -63.18 },
        ],
      };
    },
    // El real cifra el `value`; el mock devuelve ciphertext para probar que el service no lo filtra.
    addContact: async (clientId: string, dto: { contactType: string; value: string; notes?: string }) => {
      calls.addedContacts.push({ clientId, ...dto });
      return { id: 'new-contact', contactType: dto.contactType, value: `enc(${dto.value})`, isPrimary: false };
    },
    addLocation: async (clientId: string, dto: Record<string, unknown>) => {
      calls.addedLocations.push({ clientId, ...dto });
      return {
        id: 'new-location',
        locationType: dto.locationType,
        address: `enc(${String(dto.address)})`,
        zone: dto.zone ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      };
    },
  };
  const events = {
    emit: (e: string, payload?: unknown) => {
      calls.events.push(e);
      calls.eventPayloads.push({ event: e, payload: payload as Record<string, unknown> });
    },
  };
  // El reloj del tenant, fijado en UTC: los tests arman sus fechas con `isoUTC`, que es la misma vara.
  const clock = {
    today: async () => new Date(`${isoUTC(0)}T00:00:00.000Z`),
    // Minutos desde la medianoche de la empresa «ahora»; 0 = recién empezó el día (no estorba a los tests de hora).
    nowWallMinutes: async () => opts.nowMinutes ?? 0,
    // La Paz (UTC−4): el día civil empieza a las 04:00 UTC.
    timezone: async () => 'America/La_Paz',
  };
  const service = new AgendaService(
    prisma as never,
    tenant as never,
    audit as never,
    clientsService as never,
    events as never,
    clock as never,
  );
  return { service, calls };
}

/** Body mínimo válido de creación; `over` pisa lo que cada test necesite. */
function createDto(over: Record<string, unknown> = {}) {
  return {
    creditId: UUID, type: 'CALL', scheduledDate: isoUTC(1),
    timeMode: 'FIXED', scheduledTime: '15:30', details: { contactId: CONTACT }, ...over,
  } as never;
}

async function expectError(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (err: { response?: { code?: string } }) => {
    assert.equal(err.response?.code, code);
    return true;
  });
}

describe('AgendaService.listByDay (scope + enriquecimiento)', () => {
  it('cobrador sin AGENDA_ASSIGN queda acotado a sus agendados', async () => {
    const { service, calls } = makeService({ rows: [] });
    await service.listByDay('2026-07-08');
    assert.equal(calls.listWhere!.assigneeId, 'u1');
    assert.ok((calls.listWhere!.scheduledDate as Date) instanceof Date);
  });

  it('con AGENDA_ASSIGN no fuerza el assigneeId', async () => {
    const { service, calls } = makeService({ permissions: ['agenda:assign'], rows: [] });
    await service.listByDay('2026-07-08');
    assert.equal(calls.listWhere!.assigneeId, undefined);
  });

  it('enriquece con el nombre del deudor (ref suave → lookup)', async () => {
    const { service } = makeService({
      rows: [row({ clientId: 'cl1' })],
      clients: [{ id: 'cl1', firstName: 'Ana', lastName: 'Ruiz', businessName: null }],
    });
    const res = await service.listByDay('2026-07-08');
    assert.equal(res.data![0]!.clientName, 'Ana Ruiz');
  });
});

describe('AgendaService · campos del crédito en la lista', () => {
  const CATS = [
    { code: 'A', name: 'Categoría A', color: null, fromDays: 1, toDays: 30 },
    { code: 'B', name: 'Categoría B', color: '#f59e0b', fromDays: 31, toDays: 60 },
  ];
  const credit = (over: Record<string, unknown> = {}) => ({
    id: 'cr1', code: 'C-12345', outstandingBalance: 2450.5, currency: 'BOB', daysPastDue: 45, writtenOffAt: null,
    arrearEpisodes: [{ id: 'e1' }], ...over,
  });
  const user = (userId: string, firstName: string, lastName: string) => ({ userId, user: { profile: { firstName, lastName }, email: `${firstName}@x.com` } });

  it('trae código, situación, días, categoría, saldo, moneda y nombre de quien atiende', async () => {
    const { service } = makeService({
      rows: [row({ assigneeId: 'u1' })],
      credits: [credit()],
      categories: CATS,
      userAccounts: [user('u1', 'Carlos', 'Rojas')],
    });
    const [it] = (await service.listByDay({ date: '2026-07-08' })).data!;
    assert.equal(it!.creditCode, 'C-12345');
    assert.equal(it!.creditSituation, 'IN_ARREARS');
    assert.equal(it!.daysPastDue, 45);
    assert.deepEqual(it!.category, { code: 'B', name: 'Categoría B', color: '#f59e0b' });
    assert.equal(it!.balance, 2450.5);
    assert.equal(it!.currency, 'BOB');
    assert.equal(it!.assigneeName, 'Carlos Rojas');
  });

  it('sin episodio abierto está «al día» y sin categoría, aunque tenga días', async () => {
    const { service } = makeService({ rows: [row()], credits: [credit({ arrearEpisodes: [], daysPastDue: 0 })], categories: CATS });
    const [it] = (await service.listByDay({ date: '2026-07-08' })).data!;
    assert.equal(it!.creditSituation, 'CURRENT');
    assert.equal(it!.category, undefined);
  });

  it('la situación sale del episodio, no de los días: con episodio abierto y 0 días sigue en mora', async () => {
    const { service } = makeService({ rows: [row()], credits: [credit({ daysPastDue: 0 })], categories: CATS });
    const [it] = (await service.listByDay({ date: '2026-07-08' })).data!;
    assert.equal(it!.creditSituation, 'IN_ARREARS');
    assert.equal(it!.category, undefined); // days < 1 → sin categoría
  });

  it('sin nombre en el perfil no hay assigneeName y el correo nunca sale', async () => {
    const { service } = makeService({
      rows: [row({ assigneeId: 'u1' })],
      credits: [credit()],
      userAccounts: [{ userId: 'u1', user: { profile: null, email: 'secreto@x.com' } }],
    });
    const res = await service.listByDay({ date: '2026-07-08' });
    assert.equal(res.data![0]!.assigneeName, undefined);
    assert.ok(!JSON.stringify(res).includes('secreto@x.com'));
  });

  it('una consulta por tabla para toda la página (sin N+1)', async () => {
    const { service, calls } = makeService({
      rows: [row({ id: 'a1' }), row({ id: 'a2', assigneeId: 'u2' }), row({ id: 'a3', creditId: 'cr2' })],
      credits: [credit(), credit({ id: 'cr2', code: 'C-2' })],
      categories: CATS,
      userAccounts: [user('u1', 'Carlos', 'Rojas'), user('u2', 'Ana', 'Martínez')],
    });
    const res = await service.listByDay({ date: '2026-07-08' });
    assert.equal(res.data!.length, 3);
    assert.deepEqual(calls.queries, { credit: 1, category: 1, users: 1 });
    assert.equal(res.data![2]!.creditCode, 'C-2');
  });

  it('no pide el correo ni datos de contacto de las personas', async () => {
    const { service, calls } = makeService({ rows: [row()], credits: [credit()] });
    await service.listByDay({ date: '2026-07-08' });
    assert.ok(calls.creditSelect && !('clientId' in calls.creditSelect));
  });

  it('sin filas no consulta nada de más', async () => {
    const { service, calls } = makeService({ rows: [] });
    await service.listByDay({ date: '2026-07-08' });
    assert.deepEqual(calls.queries, { credit: 0, category: 0, users: 0 });
  });

  it('las vencidas traen los mismos campos', async () => {
    const { service } = makeService({ rows: [row()], credits: [credit()], categories: CATS });
    const [it] = (await service.listOverdue({ limit: 5 } as never)).data!;
    assert.equal(it!.creditCode, 'C-12345');
    assert.equal(it!.category?.code, 'B');
  });
});

describe('AgendaService.listOverdue', () => {
  it('filtra SCHEDULED con fecha < hoy, desc, y respeta el scope', async () => {
    const { service, calls } = makeService({ rows: [] });
    await service.listOverdue({ limit: 2 });
    assert.equal(calls.listWhere!.status, 'SCHEDULED');
    assert.ok((calls.listWhere!.scheduledDate as { lt: Date }).lt instanceof Date);
    assert.equal(calls.listWhere!.assigneeId, 'u1');
  });
});

describe('AgendaService.findOne (detalle S3)', () => {
  const CREDIT = { id: 'cr1', code: 'CR-001', outstandingBalance: 8450, currency: 'BOB', daysPastDue: 12 };
  const detail = (over: Record<string, unknown> = {}) => makeService({ item: row(over), credit: CREDIT });

  it('agendado ajeno o inexistente → 404 sin revelar PII', async () => {
    const { service, calls } = makeService({ item: null });
    await expectError(() => service.findOne('a1'), 'AGENDA_NOT_FOUND');
    assert.deepEqual(calls.reveals, []);
    assert.deepEqual(calls.audits, []);
  });

  it('acota al scope del cobrador y excluye los soft-deleted', async () => {
    const { service, calls } = detail({ details: { contactId: CONTACT } });
    await service.findOne('a1');
    assert.equal(calls.itemWhere!.assigneeId, 'u1');
    assert.equal(calls.itemWhere!.deletedAt, null);
  });

  it('con AGENDA_ASSIGN no fuerza el assigneeId', async () => {
    const { service, calls } = makeService({ permissions: ['agenda:assign'], item: row(), credit: CREDIT });
    await service.findOne('a1');
    assert.equal(calls.itemWhere!.assigneeId, undefined);
  });

  it('CALL: emite sólo el teléfono elegido, no la agenda completa del deudor', async () => {
    const { service } = detail({ type: 'CALL', details: { contactId: CONTACT } });
    const res = await service.findOne('a1');
    assert.equal(res.data!.target!.phone, '78012345');
    assert.equal(JSON.stringify(res.data).includes('79999999'), false); // el otro número no viaja
  });

  it('VISIT con locationId: dirección y coordenadas del cliente', async () => {
    const { service } = detail({ type: 'VISIT', details: { locationId: LOCATION } });
    const res = await service.findOne('a1');
    assert.equal(res.data!.target!.address, 'Av. Siempre Viva 742');
    assert.equal(res.data!.target!.latitude, -17.78);
  });

  it('VISIT con dirección libre: sale de details, no de client_locations', async () => {
    const { service } = detail({ type: 'VISIT', details: { customAddress: { address: 'Calle Falsa 123', zone: 'Norte' } } });
    const res = await service.findOne('a1');
    assert.equal(res.data!.target!.address, 'Calle Falsa 123');
    assert.equal(res.data!.target!.latitude, undefined); // una dirección tipeada no tiene punto en el mapa
  });

  it('REMINDER: sin target, pero el CI viene en claro y se audita igual', async () => {
    const { service, calls } = detail({ type: 'REMINDER', details: { description: 'Llamar al garante' } });
    const res = await service.findOne('a1');
    assert.equal(res.data!.target, undefined);
    assert.equal(res.data!.client.nationalId, '8821903');
    assert.deepEqual(calls.reveals, [{ id: 'cl1', reveal: true }]);
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'PII_REVEAL' }]);
  });

  it('PROMISE_TO_PAY: resuelve las etiquetas del medio de pago y del banco', async () => {
    const { service } = makeService({
      item: row({ type: 'PROMISE_TO_PAY', details: { amount: 500, promiseDate: '2026-07-20', paymentMethodCode: 'TRANSFER', bankCode: 'BNB' } }),
      credit: CREDIT,
      catalogRows: [{ code: 'TRANSFER', label: 'Transferencia bancaria' }, { code: 'BNB', label: 'Banco Nacional de Bolivia' }],
    });
    const res = await service.findOne('a1');
    assert.equal(res.data!.labels!.TRANSFER, 'Transferencia bancaria');
    assert.equal(res.data!.labels!.BNB, 'Banco Nacional de Bolivia');
    assert.equal(res.data!.target, undefined);
  });

  it('los tipos sin códigos de catálogo no emiten labels', async () => {
    const { service } = detail({ type: 'CALL', details: { contactId: CONTACT } });
    const res = await service.findOne('a1');
    assert.equal(res.data!.labels, undefined);
  });

  it('el historial es del mismo crédito, excluye el ítem abierto y los borrados', async () => {
    const { service, calls } = makeService({
      item: row(),
      credit: CREDIT,
      history: [row({ id: 'a2', status: 'EXECUTED', scheduledDate: new Date('2026-06-21') })],
    });
    const res = await service.findOne('a1');
    assert.equal(calls.historyWhere!.creditId, 'cr1');
    assert.deepEqual(calls.historyWhere!.id, { not: 'a1' });
    assert.equal(calls.historyWhere!.deletedAt, null);
    // El historial es del crédito, no del cobrador: un supervisor y su cobrador ven lo mismo.
    assert.equal(calls.historyWhere!.assigneeId, undefined);
    assert.equal(res.data!.history[0]!.id, 'a2');
    assert.equal(res.data!.history[0]!.isOverdue, false); // EXECUTED nunca vence
  });

  it('un pendiente con fecha pasada aparece vencido en el historial', async () => {
    const { service } = makeService({
      item: row(),
      credit: CREDIT,
      history: [row({ id: 'a2', status: 'SCHEDULED', scheduledDate: new Date('2020-01-01') })],
    });
    const res = await service.findOne('a1');
    assert.equal(res.data!.history[0]!.isOverdue, true);
  });

  it('trae el saldo del crédito para la "deuda total"', async () => {
    const { service } = detail();
    const res = await service.findOne('a1');
    assert.equal(res.data!.credit!.outstandingBalance, 8450);
    assert.equal(res.data!.credit!.currency, 'BOB');
  });
});

describe('AgendaService.complete (ejecutar S4)', () => {
  it('deja un CreditActivity con el outcome, apunta el agendado y lo pasa a EXECUTED', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'SCHEDULED' }) });
    const res = await service.complete('a1', { outcome: 'CONTACTED' } as never);
    assert.equal(calls.activity!.type, 'CALL'); // mapType CALL -> CALL
    assert.equal(calls.activity!.result, 'CONTACTED');
    assert.equal(calls.activity!.creditId, 'cr1');
    assert.equal(calls.activity!.clientId, 'cl1');
    assert.equal(calls.activity!.episodeId, null, 'crédito al día: sin episodio');
    assert.ok(calls.creditUpdate!.lastActionAt instanceof Date, 'última gestión (informativa)');
    assert.equal(calls.updated!.status, 'EXECUTED');
    assert.equal(calls.updated!.resultActivityId, 'act-1');
    assert.equal(res.data!.status, 'EXECUTED');
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'EXECUTE' }]);
    assert.equal(calls.events.length, 0);
  });

  it('con una mora abierta, la actividad queda ligada a ese episodio', async () => {
    const { service, calls } = makeService({ item: row({ type: 'VISIT', status: 'SCHEDULED' }), episode: { id: 'ep-1' } });
    await service.complete('a1', { outcome: 'CONTACTED' } as never);
    assert.equal(calls.activity!.episodeId, 'ep-1');
  });

  it('un agendado preventivo (crédito al día) se ejecuta igual', async () => {
    const { service, calls } = makeService({ item: row({ type: 'REMINDER', status: 'SCHEDULED' }) });
    const res = await service.complete('a1', { outcome: 'DONE' } as never);
    assert.equal(res.data!.status, 'EXECUTED');
    assert.equal(calls.updated!.resultActivityId, 'act-1');
  });

  it('mapea el tipo de gestión al tipo de actividad de la bitácora', async () => {
    for (const [agenda, activity, outcome] of [
      ['VISIT', 'VISIT', 'CONTACTED'],
      ['WHATSAPP', 'MESSAGE', 'CONTACTED'],
      ['PROMISE_TO_PAY', 'NOTE', 'PROMISE_KEPT'],
      ['REMINDER', 'NOTE', 'DONE'],
    ] as const) {
      const { service, calls } = makeService({ item: row({ type: agenda, status: 'SCHEDULED' }) });
      await service.complete('a1', { outcome } as never);
      assert.equal(calls.activity!.type, activity, `${agenda} -> ${activity}`);
    }
  });

  it('un outcome que no corresponde al tipo → AGENDA_007, sin escribir nada', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'SCHEDULED' }) });
    await expectError(() => service.complete('a1', { outcome: 'PROMISE_KEPT' } as never), 'AGENDA_007');
    assert.equal(calls.activity, undefined);
    assert.equal(calls.updated, undefined);
  });

  it('ejecutar una gestión ya ejecutada → AGENDA_008 (no re-registra)', async () => {
    const { service } = makeService({ item: row({ type: 'CALL', status: 'EXECUTED' }) });
    await expectError(() => service.complete('a1', { outcome: 'CONTACTED' } as never), 'AGENDA_008');
  });

  it('gestión ajena o inexistente → 404', async () => {
    const { service } = makeService({ item: null });
    await expectError(() => service.complete('a1', { outcome: 'CONTACTED' } as never), 'AGENDA_NOT_FOUND');
  });

  it('acota al scope del cobrador', async () => {
    const { service, calls } = makeService({ item: row({ type: 'REMINDER', status: 'SCHEDULED' }) });
    await service.complete('a1', { outcome: 'DONE' } as never);
    assert.equal(calls.itemWhere!.assigneeId, 'u1');
  });
});

describe('AgendaService.postpone (S4 · D-8: solo hacia adelante y el mismo día)', () => {
  const hoy = () => new Date(isoUTC(0));
  const SCHEDULED = (over: Record<string, unknown> = {}) => row({ status: 'SCHEDULED', scheduledDate: hoy(), scheduledTime: '09:00', timeMode: 'FIXED', ...over });

  it('corre la hora AGENDADA (naive) +30, sigue SCHEDULED y fija a hora exacta', async () => {
    const { service, calls } = makeService({ item: SCHEDULED() });
    const res = await service.postpone('a1', { minutes: 30 } as never);
    assert.equal(calls.updated!.scheduledTime, '09:30'); // +30 sobre la hora agendada
    assert.equal(calls.updated!.timeMode, 'FIXED');
    assert.equal(calls.updated!.timeSlot, null);
    assert.notEqual(res.data!.status, 'EXECUTED');
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'POSTPONE' }]);
  });

  it('suma 15, 30 y 60 minutos exactos', async () => {
    for (const [min, hora] of [[15, '09:15'], [30, '09:30'], [60, '10:00']] as const) {
      const { service, calls } = makeService({ item: SCHEDULED() });
      await service.postpone('a1', { minutes: min } as never);
      assert.equal(calls.updated!.scheduledTime, hora, `+${min}`);
    }
  });

  it('🔴 nunca cambia el día: cruzar la medianoche se rechaza y no escribe nada (AGENDA_POSTPONE_RULE)', async () => {
    const { service, calls } = makeService({ item: SCHEDULED({ scheduledTime: '23:50' }) });
    await expectError(() => service.postpone('a1', { minutes: 60 } as never), 'AGENDA_POSTPONE_RULE');
    assert.equal(calls.updated, undefined);
  });

  it('el límite del día: 23:30 + 15 sí (23:45), 23:50 + 15 no', async () => {
    const ok = makeService({ item: SCHEDULED({ scheduledTime: '23:30' }) });
    await ok.service.postpone('a1', { minutes: 15 } as never);
    assert.equal(ok.calls.updated!.scheduledTime, '23:45');
    const no = makeService({ item: SCHEDULED({ scheduledTime: '23:50' }) });
    await expectError(() => no.service.postpone('a1', { minutes: 15 } as never), 'AGENDA_POSTPONE_RULE');
  });

  it('un agendado por franja parte del inicio de la franja (MORNING = 08:00)', async () => {
    const { service, calls } = makeService({ item: row({ status: 'SCHEDULED', scheduledDate: hoy(), scheduledTime: null, timeSlot: 'MORNING', timeMode: 'LAPSE' }) });
    await service.postpone('a1', { minutes: 15 } as never);
    assert.equal(calls.updated!.scheduledTime, '08:15'); // no 00:15
    assert.equal(calls.updated!.timeMode, 'FIXED');
    assert.equal(calls.updated!.timeSlot, null);
  });

  it('🔴 un vencido de HOY se pospone desde AHORA, no sobre su hora vieja (que seguiría en el pasado)', async () => {
    // Estaba a las 09:00, son las 14:10: +30 → 14:40, no 09:30.
    const { service, calls } = makeService({ item: SCHEDULED(), nowMinutes: 14 * 60 + 10 });
    await service.postpone('a1', { minutes: 30 } as never);
    assert.equal(calls.updated!.scheduledTime, '14:40');
  });

  it('una gestión de un día que ya pasó no se pospone: se reagenda (AGENDA_POSTPONE_RULE)', async () => {
    const { service, calls } = makeService({ item: SCHEDULED({ scheduledDate: new Date(isoUTC(-1)) }) });
    await expectError(() => service.postpone('a1', { minutes: 15 } as never), 'AGENDA_POSTPONE_RULE');
    assert.equal(calls.updated, undefined);
  });

  it('una gestión de un día futuro se pospone sobre su propia hora (ahora no estorba)', async () => {
    const { service, calls } = makeService({ item: SCHEDULED({ scheduledDate: new Date(isoUTC(2)) }), nowMinutes: 20 * 60 });
    await service.postpone('a1', { minutes: 30 } as never);
    assert.equal(calls.updated!.scheduledTime, '09:30');
    assert.equal((calls.updated!.scheduledDate as Date | undefined), undefined, 'el día no se toca');
  });

  it('toTime: hora exacta posterior del mismo día; la hora QUEDA ahí y el día no cambia', async () => {
    const { service, calls } = makeService({ item: SCHEDULED() });
    await service.postpone('a1', { toTime: '10:30' } as never);
    assert.equal(calls.updated!.scheduledTime, '10:30');
    assert.equal(calls.updated!.scheduledDate, undefined);
    assert.equal(calls.updated!.timeMode, 'FIXED');
  });

  it('🔴 toTime igual o anterior a la actual, o a «ahora», no es posponer (AGENDA_POSTPONE_RULE)', async () => {
    const a = makeService({ item: SCHEDULED() });
    await expectError(() => a.service.postpone('a1', { toTime: '08:00' } as never), 'AGENDA_POSTPONE_RULE');
    const b = makeService({ item: SCHEDULED(), nowMinutes: 11 * 60 });
    await expectError(() => b.service.postpone('a1', { toTime: '10:30' } as never), 'AGENDA_POSTPONE_RULE');
  });

  it('🔴 idempotente: reenviar el mismo toTime sobre una gestión que ya quedó a esa hora es éxito y no vuelve a auditar', async () => {
    const { service, calls } = makeService({ item: SCHEDULED({ scheduledTime: '10:30' }) });
    const res = await service.postpone('a1', { toTime: '10:30' } as never);
    assert.equal(res.data!.scheduledTime, '10:30');
    assert.equal(calls.updated, undefined, 'no escribe');
    assert.deepEqual(calls.audits, []);
  });

  it('toTime manda sobre minutes; sin ninguno → AGENDA_004', async () => {
    const { service, calls } = makeService({ item: SCHEDULED() });
    await service.postpone('a1', { toTime: '11:00', minutes: 30 } as never);
    assert.equal(calls.updated!.scheduledTime, '11:00');
    await expectError(() => service.postpone('a1', {} as never), 'AGENDA_004');
  });

  it('posponer una gestión ya ejecutada → AGENDA_008', async () => {
    const { service } = makeService({ item: row({ status: 'EXECUTED' }) });
    await expectError(() => service.postpone('a1', { minutes: 15 } as never), 'AGENDA_008');
  });

  it('no se pospone la de otra persona: 404 (alcance de asignado)', async () => {
    const { service } = makeService({ item: null as never });
    await expectError(() => service.postpone('a1', { minutes: 15 } as never), 'AGENDA_NOT_FOUND');
  });
});

describe('AgendaService.clientContext', () => {
  it('lista TODOS los créditos visibles (al día y en mora) y revela la PII con auditoría', async () => {
    const { service, calls } = makeService({ credits: [creditRow(), creditRow({ id: 'cr-aldia', code: 'CR-002', daysPastDue: 0 })] });
    const res = await service.clientContext('cl1');
    assert.equal(res.data!.credits.length, 2);
    assert.deepEqual(res.data!.credits.map((c) => c.daysPastDue), [12, 0]); // al día = 0 → acción preventiva
    assert.equal(res.data!.credits[0]!.outstandingBalance, 1000);
    assert.equal(res.data!.client.displayName, 'Ana Ruiz');
    assert.equal(res.data!.contacts[0]!.value, '78012345'); // en claro
    assert.deepEqual(calls.reveals, [{ id: 'cl1', reveal: true }]);
    // Doble rastro: el de ClientsService (entity `client`) + el propio del módulo, que identifica la puerta.
    assert.deepEqual(calls.audits, [{ entity: 'agenda_client_context', action: 'PII_REVEAL' }]);
  });

  it('el alcance es el de la ficha de mora: un cobrador entra por responsable/asignación, no por caso', async () => {
    const { service, calls } = makeService({ permissions: ['collection:write'], credits: [creditRow()] });
    await service.clientContext('cl1');
    assert.match(calls.visibleSql!.sql, /cr\.assigned_manager_id = ?/);
    assert.match(calls.visibleSql!.sql, /credit_assignments/);
    assert.ok(calls.visibleSql!.values.includes('u1'));
    assert.ok(calls.visibleSql!.values.includes('cl1'));
  });

  it('trae el capital y el saldo de las cuotas vencidas (impago, no el monto original)', async () => {
    const { service } = makeService({
      credits: [creditRow()],
      installments: [{ creditId: UUID, _sum: { amount: 400, paidAmount: 150 } }],
    });
    const res = await service.clientContext('cl1');
    assert.equal(res.data!.credits[0]!.principalAmount, 1500);
    assert.equal(res.data!.credits[0]!.overdueAmount, 250); // 400 - 150 ya pagados
  });

  it('crédito sin cronograma cargado → mora 0, no undefined', async () => {
    const { service } = makeService({ credits: [creditRow()], installments: [] });
    const res = await service.clientContext('cl1');
    assert.equal(res.data!.credits[0]!.overdueAmount, 0);
  });

  it('sin créditos visibles corta con AGENDA_002 y NO revela PII', async () => {
    const { service, calls } = makeService({ credits: [] });
    await expectError(() => service.clientContext('cl1'), 'AGENDA_002');
    assert.deepEqual(calls.reveals, []);
    assert.deepEqual(calls.audits, []);
  });
});

describe('AgendaService.addClientContact', () => {
  const phone = { contactType: 'PHONE' as const, value: '78099999', notes: 'Celular nuevo' };

  it('delega el cifrado y el audit en ClientsService, y no filtra el ciphertext', async () => {
    const { service, calls } = makeService({ credits: [creditRow()] });
    const res = await service.addClientContact('cl1', phone);
    assert.deepEqual(calls.addedContacts, [{ clientId: 'cl1', ...phone }]);
    assert.equal(res.data!.value, '78099999'); // el valor que mandó el cliente, no `enc(...)`
    assert.equal(res.data!.id, 'new-contact');
  });

  it('respeta el scope: cliente sin casos propios → AGENDA_002 y no escribe nada', async () => {
    const { service, calls } = makeService({ credits: [] });
    await expectError(() => service.addClientContact('cl1', phone), 'AGENDA_002');
    assert.deepEqual(calls.addedContacts, []);
  });
});

describe('AgendaService.addClientLocation', () => {
  const place = { locationType: 'HOME' as const, address: 'Calle Falsa 123', zone: 'Sur', latitude: -17.78, longitude: -63.18 };

  it('guarda la dirección con sus coordenadas y devuelve el texto en claro', async () => {
    const { service, calls } = makeService({ credits: [creditRow()] });
    const res = await service.addClientLocation('cl1', place);
    assert.deepEqual(calls.addedLocations, [{ clientId: 'cl1', ...place }]);
    assert.equal(res.data!.address, 'Calle Falsa 123'); // no `enc(...)`
    assert.equal(res.data!.latitude, -17.78);
    assert.equal(res.data!.longitude, -63.18);
  });

  it('las coordenadas son opcionales: se puede cargar sólo la dirección', async () => {
    const { service } = makeService({ credits: [creditRow()] });
    const res = await service.addClientLocation('cl1', { locationType: 'WORK', address: 'Av. Siempre Viva 742' });
    assert.equal(res.data!.latitude, undefined);
    assert.equal(res.data!.longitude, undefined);
  });

  it('respeta el scope: cliente sin casos propios → AGENDA_002 y no escribe nada', async () => {
    const { service, calls } = makeService({ credits: [] });
    await expectError(() => service.addClientLocation('cl1', place), 'AGENDA_002');
    assert.deepEqual(calls.addedLocations, []);
  });
});

describe('AgendaService.create', () => {
  it('crea por crédito, sin caso: deriva clientId/assigneeId del crédito (nunca del body)', async () => {
    const { service, calls } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }] });
    const res = await service.create(createDto());
    assert.equal(calls.created!.clientId, 'cl1');
    assert.equal(calls.created!.assigneeId, 'u1');
    assert.equal(calls.created!.timeSlot, null); // FIXED no persiste franja
    assert.equal(calls.created!.creditId, UUID);
    assert.ok(calls.visibleSql!.values.includes(UUID), 'el alcance se resuelve sobre el crédito');
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'CREATE' }]);
    assert.equal(res.data!.type, 'CALL');
  });

  // ── El recordatorio de la promesa (Rutas S5 · D2) ────────────────────────
  // El sheet de RT-6 le promete al cobrador un recordatorio 24h antes. Esto lo cumple.

  /** Alta de una promesa de pago para dentro de `days` días. */
  const promiseDto = (days: number) =>
    createDto({
      type: 'PROMISE_TO_PAY',
      scheduledDate: isoUTC(days),
      details: { amount: 500, promiseDate: isoUTC(days), paymentMethodCode: 'CASH' },
    });

  it('una promesa crea TAMBIÉN su recordatorio, el día anterior', async () => {
    const { service, calls } = makeService({
      credits: [creditRow()],
      catalog: { code: 'CASH', label: 'Efectivo' }, // el medio de pago que valida `assertPaymentMethod`
    });
    await service.create(promiseDto(5));

    assert.equal(calls.createdAll.length, 2);
    const [promesa, recordatorio] = calls.createdAll;
    assert.equal(promesa!.type, 'PROMISE_TO_PAY');
    assert.equal(recordatorio!.type, 'REMINDER');
    // Un día antes, exacto.
    const dif = (recordatorio!.scheduledDate as Date).getTime() - (promesa!.scheduledDate as Date).getTime();
    assert.equal(dif, -24 * 60 * 60 * 1000);
    // Del mismo cobrador: es él quien tiene que acordarse.
    assert.equal(recordatorio!.assigneeId, promesa!.assigneeId);
    assert.equal(recordatorio!.creditId, promesa!.creditId);
    // Y queda auditado como cualquier alta.
    assert.deepEqual(calls.audits, [
      { entity: 'agenda_item', action: 'CREATE' },
      { entity: 'agenda_item', action: 'CREATE' },
    ]);
  });

  it('una promesa para MAÑANA no crea recordatorio: caería hoy y no recuerda nada', async () => {
    const { service, calls } = makeService({
      credits: [creditRow()],
      catalog: { code: 'CASH', label: 'Efectivo' }, // el medio de pago que valida `assertPaymentMethod`
    });
    await service.create(promiseDto(1));
    assert.equal(calls.createdAll.length, 1);
    assert.equal(calls.createdAll[0]!.type, 'PROMISE_TO_PAY');
  });

  it('el resto de los tipos no crean recordatorio', async () => {
    const { service, calls } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }] });
    await service.create(createDto());
    assert.equal(calls.createdAll.length, 1);
  });

  it('un supervisor agendando sobre un crédito ajeno lo asigna al responsable del crédito, no a sí mismo', async () => {
    const { service, calls } = makeService({
      permissions: ['agenda:assign', 'assignment:write', 'data:scope:all'],
      credits: [creditRow({ assignedManagerId: 'cobrador-2' })],
      contacts: [{ id: CONTACT }],
    });
    await service.create(createDto());
    assert.equal(calls.created!.assigneeId, 'cobrador-2'); // si no, el cobrador nunca lo vería en su agenda
    assert.doesNotMatch(calls.visibleSql!.sql, /assigned_manager_id = /); // el alcance total ve todo
  });

  it('crédito AL DÍA (sin episodio ni caso): se puede agendar una acción preventiva', async () => {
    const { service, calls } = makeService({ credits: [creditRow({ daysPastDue: 0 })], contacts: [{ id: CONTACT }] });
    const res = await service.create(createDto());
    assert.equal(res.data!.creditId, UUID);
    assert.equal(calls.created!.creditId, UUID);
  });

  it('crédito sin responsable → el agendado queda para quien lo crea', async () => {
    const { service, calls } = makeService({ credits: [creditRow({ assignedManagerId: null })], contacts: [{ id: CONTACT }] });
    await service.create(createDto());
    assert.equal(calls.created!.assigneeId, 'u1');
  });

  it('crédito fuera de alcance / inexistente → AGENDA_001', async () => {
    const { service } = makeService({ credits: [] });
    await expectError(() => service.create(createDto()), 'AGENDA_001');
  });

  it('fecha pasada → AGENDA_003', async () => {
    const { service } = makeService({ credits: [creditRow()] });
    await expectError(() => service.create(createDto({ scheduledDate: isoUTC(-1) })), 'AGENDA_003');
  });

  it('hoy sí se puede agendar (el borde no es pasado)', async () => {
    const { service } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }] });
    await service.create(createDto({ scheduledDate: isoUTC(0) }));
  });

  it('FIXED sin hora → AGENDA_004; LAPSE sin franja → AGENDA_004', async () => {
    const { service } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }] });
    await expectError(() => service.create(createDto({ scheduledTime: undefined })), 'AGENDA_004');
    await expectError(() => service.create(createDto({ timeMode: 'LAPSE', scheduledTime: undefined })), 'AGENDA_004');
  });

  it('details inválido para el tipo → AGENDA_005 con la lista de errores', async () => {
    const { service } = makeService({ credits: [creditRow()] });
    await expectError(() => service.create(createDto({ details: {} })), 'AGENDA_005');
  });

  it('contactId de otro cliente → AGENDA_006', async () => {
    const { service } = makeService({ credits: [creditRow()], contacts: [] });
    await expectError(() => service.create(createDto()), 'AGENDA_006');
  });

  it('VISIT con dirección libre → AGENDA_013: toda visita lleva la ubicación del domicilio (F4/11)', async () => {
    const { service } = makeService({ credits: [creditRow()], locations: [] });
    await expectError(() => service.create(createDto({ type: 'VISIT', details: { customAddress: { address: 'Calle 1' } } })), 'AGENDA_013');
  });

  it('VISIT con una dirección sin coordenadas → AGENDA_013', async () => {
    const { service } = makeService({ credits: [creditRow()], locations: [{ id: LOCATION, address: 'Av. 1', latitude: null, longitude: null }] });
    await expectError(() => service.create(createDto({ type: 'VISIT', details: { locationId: LOCATION } })), 'AGENDA_013');
  });

  it('VISIT con dirección y coordenadas se agenda', async () => {
    const { service, calls } = makeService({ credits: [creditRow()], locations: [{ id: LOCATION, address: 'Av. 1', latitude: -16.5, longitude: -68.1 }] });
    await service.create(createDto({ type: 'VISIT', details: { locationId: LOCATION } }));
    assert.equal(calls.created!.type, 'VISIT');
  });

  it('VISIT con locationId ajeno → AGENDA_006', async () => {
    const { service } = makeService({ credits: [creditRow()], locations: [] });
    await expectError(() => service.create(createDto({ type: 'VISIT', details: { locationId: LOCATION } })), 'AGENDA_006');
  });

  const promise = (over: Record<string, unknown> = {}) =>
    createDto({
      type: 'PROMISE_TO_PAY',
      details: { amount: 500, promiseDate: isoUTC(3), paymentMethodCode: 'CASH', ...over },
    });

  it('promesa por encima del saldo → AGENDA_006', async () => {
    const { service } = makeService({ credits: [creditRow()], catalog: { code: 'CASH', metadata: {} } });
    await expectError(() => service.create(promise({ amount: 1000.01 })), 'AGENDA_006');
  });

  it('promesa sobre un crédito EXTERNO (PSF): sin tope de saldo (el saldo reportado puede ser solo capital)', async () => {
    const { service, calls } = makeService({ credits: [creditRow({ externalSource: 'PSF' })], catalog: { code: 'CASH', metadata: {} } });
    await service.create(promise({ amount: 5000 }));
    assert.equal((calls.created!.details as { amount: number }).amount, 5000);
  });

  it('medio de pago inexistente o inactivo → AGENDA_006', async () => {
    const { service } = makeService({ credits: [creditRow()], catalog: null });
    await expectError(() => service.create(promise()), 'AGENDA_006');
  });

  it('medio con requiresBank y sin banco → AGENDA_006', async () => {
    const { service } = makeService({ credits: [creditRow()], catalog: { code: 'TRANSFER', metadata: { requiresBank: true } } });
    await expectError(() => service.create(promise({ paymentMethodCode: 'TRANSFER' })), 'AGENDA_006');
  });

  it('promesa con fecha de pago pasada → AGENDA_003', async () => {
    const { service } = makeService({ credits: [creditRow()], catalog: { code: 'CASH', metadata: {} } });
    await expectError(() => service.create(promise({ promiseDate: isoUTC(-1) })), 'AGENDA_003');
  });

  it('promesa válida persiste los details normalizados', async () => {
    const { service, calls } = makeService({ credits: [creditRow()], catalog: { code: 'CASH', metadata: {} } });
    await service.create(promise());
    assert.equal((calls.created!.details as { amount: number }).amount, 500);
  });
});

/** Crédito del ítem que edita/reagenda (saldo 1000 BOB), para los cruces de `assertReferences`. */
const ITEM_CREDIT = { id: 'cr1', code: 'CR-001', outstandingBalance: 1000, currency: 'BOB', deletedAt: null };

describe('AgendaService.update (S5 — editar)', () => {
  it('ítem ajeno o inexistente → 404 sin filtrar existencia', async () => {
    const { service } = makeService({ item: null });
    await expectError(() => service.update('a1', { observations: 'x' } as never), 'AGENDA_NOT_FOUND');
  });

  it('una gestión ya ejecutada no se edita → AGENDA_008', async () => {
    const { service } = makeService({ item: row({ status: 'EXECUTED' }) });
    await expectError(() => service.update('a1', { observations: 'x' } as never), 'AGENDA_008');
  });

  it('cambiar de tipo sin mandar details nuevos → AGENDA_005', async () => {
    // El `contactId` de la llamada no sirve para una visita: la combinación se revalida entera.
    const { service } = makeService({ item: row({ details: { contactId: CONTACT } }), credit: ITEM_CREDIT });
    await expectError(() => service.update('a1', { type: 'VISIT' } as never), 'AGENDA_005');
  });

  it('teléfono que no es del cliente → AGENDA_006 (reusa assertReferences)', async () => {
    const { service } = makeService({ item: row(), credit: ITEM_CREDIT, contacts: [] });
    await expectError(() => service.update('a1', { details: { contactId: OTHER_CONTACT } } as never), 'AGENDA_006');
  });

  it('la fecha NO se puede mover editando (D5): el campo se ignora', async () => {
    const { service, calls } = makeService({ item: row(), credit: ITEM_CREDIT });
    await service.update('a1', { observations: 'llamar temprano', scheduledDate: isoUTC(5) } as never);
    assert.equal(calls.updated!.scheduledDate, undefined);
    assert.equal(calls.updated!.observations, 'llamar temprano');
  });

  it('pasar a hora fija sin hora → AGENDA_004 (valida la combinación resultante)', async () => {
    const { service } = makeService({ item: row({ timeMode: 'LAPSE', scheduledTime: null, timeSlot: 'MORNING' }) });
    await expectError(() => service.update('a1', { timeMode: 'FIXED' } as never), 'AGENDA_004');
  });

  it('pasar a lapso limpia la hora exacta', async () => {
    const { service, calls } = makeService({ item: row() });
    await service.update('a1', { timeMode: 'LAPSE', timeSlot: 'AFTERNOON' } as never);
    assert.equal(calls.updated!.scheduledTime, null);
    assert.equal(calls.updated!.timeSlot, 'AFTERNOON');
  });

  it('audita el cambio con before y after', async () => {
    const { service, calls } = makeService({ item: row() });
    await service.update('a1', { observations: 'ok' } as never);
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'UPDATE' }]);
  });
});

describe('AgendaService.cancel (S6)', () => {
  it('motivo inexistente o inactivo en el catálogo → AGENDA_006', async () => {
    const { service } = makeService({ item: row(), catalog: null });
    await expectError(() => service.cancel('a1', { reasonCode: 'NOPE' } as never), 'AGENDA_006');
  });

  it('una gestión ya cancelada no se vuelve a cancelar → AGENDA_008', async () => {
    const { service } = makeService({ item: row({ status: 'CANCELLED' }), catalog: { code: 'WRONG_DATA' } });
    await expectError(() => service.cancel('a1', { reasonCode: 'WRONG_DATA' } as never), 'AGENDA_008');
  });

  it('guarda estado, motivo y audit', async () => {
    const { service, calls } = makeService({ item: row(), catalog: { code: 'CLIENT_UNAVAILABLE' } });
    const res = await service.cancel('a1', { reasonCode: 'CLIENT_UNAVAILABLE' } as never);
    assert.equal(calls.updated!.status, 'CANCELLED');
    assert.equal(calls.updated!.reasonCode, 'CLIENT_UNAVAILABLE');
    assert.equal(res.data!.status, 'CANCELLED');
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'CANCEL' }]);
  });
});

describe('AgendaService.reschedule (S6)', () => {
  const dto = (over: Record<string, unknown> = {}) =>
    ({ scheduledDate: isoUTC(1), timeMode: 'FIXED', scheduledTime: '10:00', reasonCode: 'NO_ANSWER', ...over }) as never;

  it('a una fecha pasada → AGENDA_003', async () => {
    const { service } = makeService({ item: row(), catalog: { code: 'NO_ANSWER' } });
    await expectError(() => service.reschedule('a1', dto({ scheduledDate: isoUTC(-1) })), 'AGENDA_003');
  });

  it('motivo fuera del catálogo → AGENDA_006', async () => {
    const { service } = makeService({ item: row(), catalog: null });
    await expectError(() => service.reschedule('a1', dto()), 'AGENDA_006');
  });

  it('crea el nuevo apuntando al viejo y deja el viejo RESCHEDULED con su motivo', async () => {
    const { service, calls } = makeService({ item: row(), catalog: { code: 'NO_ANSWER' } });
    await service.reschedule('a1', dto());
    assert.equal(calls.created!.rescheduledFromId, 'a1');
    assert.equal(calls.created!.scheduledTime, '10:00');
    assert.equal(calls.updated!.status, 'RESCHEDULED');
    assert.equal(calls.updated!.reasonCode, 'NO_ANSWER');
    assert.deepEqual(calls.audits, [
      { entity: 'agenda_item', action: 'RESCHEDULE' },
      { entity: 'agenda_item', action: 'CREATE' },
    ]);
  });

  it('el nuevo queda del cobrador del original, no de quien reagenda', async () => {
    // Un supervisor (AGENDA_ASSIGN) reagenda una gestión de otro: si se tomara `tenant.userId`,
    // el cobrador que debe ejecutarla dejaría de verla (misma lección que el alta de S2).
    const { service, calls } = makeService({
      permissions: ['agenda:assign'],
      item: row({ assigneeId: 'u9' }),
      catalog: { code: 'CLIENT_REQUEST' },
    });
    await service.reschedule('a1', dto({ reasonCode: 'CLIENT_REQUEST' }));
    assert.equal(calls.created!.assigneeId, 'u9');
  });

  it('copia tipo, details y observaciones: reagendar no es editar', async () => {
    const { service, calls } = makeService({
      item: row({ type: 'WHATSAPP', details: { contactId: CONTACT, message: 'hola' }, observations: 'insistir' }),
      catalog: { code: 'NO_ANSWER' },
    });
    await service.reschedule('a1', dto());
    assert.equal(calls.created!.type, 'WHATSAPP');
    assert.deepEqual(calls.created!.details, { contactId: CONTACT, message: 'hola' });
    assert.equal(calls.created!.observations, 'insistir');
  });
});

describe('AgendaService.remove (S6 — eliminar)', () => {
  it('marca deletedAt y audita el borrado', async () => {
    const { service, calls } = makeService({ item: row() });
    const res = await service.remove('a1');
    assert.ok(calls.updated!.deletedAt instanceof Date);
    assert.equal(res.data!.id, 'a1'); // responde 200 con el ítem, no 204 (apiMutate trata el 204 como error)
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'DELETE' }]);
  });

  it('una gestión ejecutada no se borra → AGENDA_008 (su actividad quedaría huérfana)', async () => {
    const { service } = makeService({ item: row({ status: 'EXECUTED' }) });
    await expectError(() => service.remove('a1'), 'AGENDA_008');
  });

  it('respeta el scope: ítem ajeno → 404', async () => {
    const { service, calls } = makeService({ item: null });
    await expectError(() => service.remove('a1'), 'AGENDA_NOT_FOUND');
    assert.equal(calls.itemWhere!.assigneeId, 'u1');
  });
});

describe('AgendaService idempotente (cola offline)', () => {
  const ID = '4f2504e0-4f89-41d3-9a0c-0305e82c3302';

  it('create con id que ya existe (mismo crédito): devuelve el ítem, sin alta ni recordatorio ni audit', async () => {
    const { service, calls } = makeService({ item: row({ id: ID, creditId: UUID }), credits: [creditRow()] });
    const r = await service.create(createDto({ id: ID, type: 'PROMISE_TO_PAY', scheduledDate: isoUTC(5), details: { amount: 100, promiseDate: isoUTC(5), paymentMethodCode: 'CASH' } }));
    assert.equal(r.data!.id, ID);
    assert.equal(calls.createdAll.length, 0);
    assert.equal(calls.audits.length, 0);
  });

  it('el reintento NO falla por fecha pasada aunque el ítem se creó días atrás', async () => {
    const { service, calls } = makeService({ item: row({ id: ID, creditId: UUID }) });
    const r = await service.create(createDto({ id: ID, scheduledDate: isoUTC(-3) }));
    assert.equal(r.data!.id, ID);
    assert.equal(calls.createdAll.length, 0);
  });

  it('create con id de OTRO crédito: 409 AGENDA_009', async () => {
    const { service } = makeService({ item: row({ id: ID, creditId: 'otro-credito' }) });
    await expectError(() => service.create(createDto({ id: ID })), 'AGENDA_009');
  });

  it('create con id de un ítem eliminado: 409 AGENDA_009', async () => {
    const { service } = makeService({ item: row({ id: ID, creditId: UUID, deletedAt: new Date() }) });
    await expectError(() => service.create(createDto({ id: ID })), 'AGENDA_009');
  });

  it('create con id nuevo: lo usa como PK', async () => {
    const { service, calls } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }] });
    await service.create(createDto({ id: ID }));
    assert.equal(calls.created!.id, ID);
  });

  it('carrera en create: reintenta una vez y devuelve el ganador, sin otra alta', async () => {
    const { service, calls } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }], createRace: row({ id: ID, creditId: UUID }) });
    const r = await service.create(createDto({ id: ID }));
    assert.equal(r.data!.id, ID);
    assert.equal(calls.createdAll.length, 0);
  });

  it('complete ya EXECUTED con el MISMO resultado: devuelve lo hecho, sin otra actividad ni audit/evento', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'EXECUTED', resultActivityId: 'act-0' }), priorActivity: { result: 'CONTACTED' } });
    const r = await service.complete('a1', { outcome: 'CONTACTED' } as never);
    assert.equal(r.data!.status, 'EXECUTED');
    assert.equal(calls.activity, undefined);
    assert.equal(calls.updated, undefined);
    assert.equal(calls.audits.length, 0);
    assert.equal(calls.events.length, 0);
  });

  it('complete ya EXECUTED con OTRO resultado: sigue siendo 409 AGENDA_008', async () => {
    const { service } = makeService({ item: row({ type: 'CALL', status: 'EXECUTED', resultActivityId: 'act-0' }), priorActivity: { result: 'NO_CONTACT' } });
    await expectError(() => service.complete('a1', { outcome: 'CONTACTED' } as never), 'AGENDA_008');
  });
});

// ── Alcance por crédito de quien tiene AGENDA_ASSIGN (F4/08 · D8) ─────────────
describe('AgendaService · alcance por crédito con AGENDA_ASSIGN', () => {
  const SUP = ['agenda:assign', 'data:scope:branch'];

  it('supervisor (agencia): lista sólo los agendados de los créditos de su agencia, no todo el tenant', async () => {
    const { service, calls } = makeService({ permissions: SUP, credits: [{ id: 'cr1', clientId: 'cl1' }, { id: 'cr2', clientId: 'cl2' }], rows: [] });
    await service.listByDay({ date: '2026-07-08' });
    assert.equal(calls.listWhere!.assigneeId, undefined);
    assert.deepEqual(calls.listWhere!.creditId, { in: ['cr1', 'cr2'] });
    assert.match(calls.visibleSql!.sql, /user_accounts/); // el alcance por sucursal de la ficha de mora
  });

  it('gerente / administrador (alcance total): sin filtro, y sin consulta de alcance', async () => {
    const { service, calls } = makeService({ permissions: ['agenda:assign', 'data:scope:all'], rows: [] });
    await service.listByDay({ date: '2026-07-08' });
    assert.equal(calls.listWhere!.assigneeId, undefined);
    assert.equal(calls.listWhere!.creditId, undefined);
    assert.equal(calls.visibleSql, undefined);
  });

  it('cobrador sin AGENDA_ASSIGN sigue en «lo propio»: sin consulta de alcance', async () => {
    const { service, calls } = makeService({ permissions: ['collection:write'], rows: [] });
    await service.listByDay({ date: '2026-07-08' });
    assert.equal(calls.listWhere!.assigneeId, 'u1');
    assert.equal(calls.visibleSql, undefined);
  });

  it('vencidos: mismo alcance (supervisor = créditos de su agencia)', async () => {
    const { service, calls } = makeService({ permissions: SUP, credits: [{ id: 'cr1', clientId: 'cl1' }], rows: [] });
    await service.listOverdue({} as never);
    assert.deepEqual(calls.listWhere!.creditId, { in: ['cr1'] });
  });

  it('detalle, ejecutar, posponer, editar, cancelar y reagendar buscan el ítem dentro del alcance por crédito', async () => {
    const run = async (fn: (s: AgendaService) => Promise<unknown>) => {
      const { service, calls } = makeService({
        permissions: SUP,
        credits: [{ id: 'cr1', clientId: 'cl1' }],
        item: row({ type: 'CALL', details: { contactId: CONTACT } }),
        credit: creditRow(),
        catalog: { code: 'CLIENT_REQUEST' },
      });
      await fn(service).catch(() => undefined); // sólo importa la búsqueda del ítem
      return calls.itemWhere!;
    };
    for (const fn of [
      (s: AgendaService) => s.findOne('a1'),
      (s: AgendaService) => s.complete('a1', { outcome: 'CONTACTED' } as never),
      (s: AgendaService) => s.postpone('a1', { scheduledDate: isoUTC(2) } as never),
      (s: AgendaService) => s.update('a1', { observations: 'x' } as never),
      (s: AgendaService) => s.cancel('a1', { reasonCode: 'CLIENT_REQUEST' } as never),
      (s: AgendaService) => s.reschedule('a1', { reasonCode: 'CLIENT_REQUEST', scheduledDate: isoUTC(2) } as never),
    ]) {
      const where = await run(fn);
      assert.deepEqual(where.creditId, { in: ['cr1'] });
      assert.equal(where.assigneeId, undefined);
    }
  });

  it('un ítem de un crédito fuera de la agencia del supervisor: 404 (no se filtra que existe)', async () => {
    // El alcance no devuelve el crédito del ítem → el `findFirst` con `creditId in []` no lo encuentra.
    const { service, calls } = makeService({ permissions: SUP, credits: [], item: null });
    await expectError(() => service.cancel('a1', { reasonCode: 'CLIENT_REQUEST' } as never), 'AGENDA_NOT_FOUND');
    assert.deepEqual(calls.itemWhere!.creditId, { in: [] });
  });
});

// ── Asignar a otra persona, «asignada por» y autoría (F4/09) ───────────────────────────────────

const COLLECTOR_OK = { userId: 'u7', isActive: true, branchId: 'b1', role: { name: 'COLLECTOR' } };

describe('AgendaService.create · a quién se asigna (F4/09)', () => {
  const create = (opts: Opts, dto: Record<string, unknown> = {}) => {
    const { service, calls } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }], ...opts });
    return { run: () => service.create(createDto(dto)), calls };
  };

  it('un cobrador no puede asignarle a otro: AGENDA_010', async () => {
    const { run } = create({ permissions: ['agenda:write'], members: [COLLECTOR_OK] }, { assigneeId: 'u7' });
    await expectError(run, 'AGENDA_010');
  });

  it('un cobrador sí puede mandar su propio id', async () => {
    const { run, calls } = create({ permissions: ['agenda:write'] }, { assigneeId: 'u1' });
    await run();
    assert.equal(calls.created!.assigneeId, 'u1');
    assert.equal(calls.created!.createdBy, 'u1');
  });

  it('sin assigneeId queda para el responsable del crédito, como siempre', async () => {
    const { run, calls } = create({ permissions: ['agenda:write'], credits: [creditRow({ assignedManagerId: 'u5' })] });
    await run();
    assert.equal(calls.created!.assigneeId, 'u5');
  });

  it('el supervisor asigna a un cobrador de su agencia; el id explícito gana sobre el responsable del crédito', async () => {
    const { run, calls } = create({ permissions: ['agenda:write', 'agenda:assign', 'data:scope:branch'], me: { branchId: 'b1' }, members: [COLLECTOR_OK] }, { assigneeId: 'u7' });
    await run();
    assert.equal(calls.created!.assigneeId, 'u7');
    assert.equal(calls.created!.createdBy, 'u1');
  });

  it('el supervisor no asigna a alguien de otra agencia: AGENDA_011', async () => {
    const { run } = create(
      { permissions: ['agenda:write', 'agenda:assign', 'data:scope:branch'], me: { branchId: 'b1' }, members: [{ ...COLLECTOR_OK, branchId: 'b2' }] },
      { assigneeId: 'u7' },
    );
    await expectError(run, 'AGENDA_011');
  });

  it('un supervisor sin agencia no asigna a nadie más (falla cerrado)', async () => {
    const { run } = create(
      { permissions: ['agenda:write', 'agenda:assign', 'data:scope:branch'], me: { branchId: null }, members: [{ ...COLLECTOR_OK, branchId: null }] },
      { assigneeId: 'u7' },
    );
    await expectError(run, 'AGENDA_011');
  });

  it('el gerente (alcance total) asigna a un cobrador de cualquier agencia', async () => {
    const { run, calls } = create(
      { permissions: ['agenda:write', 'agenda:assign', 'data:scope:all'], me: { branchId: 'b1' }, members: [{ ...COLLECTOR_OK, branchId: 'b2' }] },
      { assigneeId: 'u7' },
    );
    await run();
    assert.equal(calls.created!.assigneeId, 'u7');
  });

  it('no se asigna a un gerente, a un inactivo ni a quien no existe: AGENDA_011', async () => {
    const perms = ['agenda:write', 'agenda:assign', 'data:scope:all'];
    for (const members of [
      [{ ...COLLECTOR_OK, role: { name: 'MANAGER' } }],
      [{ ...COLLECTOR_OK, isActive: false }],
      [],
    ]) {
      const { run } = create({ permissions: perms, members }, { assigneeId: 'u7' });
      await expectError(run, 'AGENDA_011');
    }
  });
});

describe('AgendaService · solo el creador edita y elimina (F4/09)', () => {
  const ADMIN = ['agenda:write', 'agenda:assign', 'data:scope:all'];

  it('quien no la creó no la edita, ni siquiera el administrador: AGENDA_012', async () => {
    const { service } = makeService({ permissions: ADMIN, item: row({ assigneeId: 'u9', createdBy: 'u2' }) });
    await expectError(() => service.update('a1', { observations: 'x' } as never), 'AGENDA_012');
  });

  it('el responsable a quien se la asignaron tampoco la edita', async () => {
    const { service } = makeService({ permissions: ['agenda:write'], item: row({ assigneeId: 'u1', createdBy: 'u2' }) });
    await expectError(() => service.update('a1', { observations: 'x' } as never), 'AGENDA_012');
  });

  it('quien no la creó no la elimina, ni siquiera el administrador: AGENDA_012', async () => {
    const { service, calls } = makeService({ permissions: ADMIN, item: row({ assigneeId: 'u9', createdBy: 'u2' }) });
    await expectError(() => service.remove('a1'), 'AGENDA_012');
    assert.equal(calls.updated, undefined);
  });

  it('una sin creador (recordatorio automático) es de su responsable, no de un tercero ni de un administrador', async () => {
    const ajena = makeService({ permissions: ADMIN, item: row({ createdBy: null, assigneeId: 'u9' }) });
    await expectError(() => ajena.service.update('a1', { observations: 'x' } as never), 'AGENDA_012');
    await expectError(() => ajena.service.remove('a1'), 'AGENDA_012');

    const propia = makeService({ item: row({ createdBy: null, assigneeId: 'u1', type: 'REMINDER', details: { description: 'Cobrar cuota' } }) });
    await propia.service.remove('a1');
    assert.ok(propia.calls.updated!.deletedAt instanceof Date, 'el responsable puede quitar su recordatorio automático');
  });

  it('el creador sí edita y elimina aunque se la haya asignado a otro', async () => {
    const { service, calls } = makeService({ permissions: ADMIN, item: row({ assigneeId: 'u9', createdBy: 'u1' }) });
    await service.update('a1', { observations: 'nota' } as never);
    assert.equal(calls.updated!.observations, 'nota');
    await service.remove('a1');
    assert.ok(calls.updated!.deletedAt instanceof Date);
  });

  it('reagendar conserva al creador: quien reagenda no pasa a ser el dueño', async () => {
    const { service, calls } = makeService({ item: row({ assigneeId: 'u1', createdBy: 'u2' }), catalog: { code: 'CLIENT_REQUEST' } });
    await service.reschedule('a1', { scheduledDate: isoUTC(2), timeMode: 'FIXED', scheduledTime: '10:00', reasonCode: 'CLIENT_REQUEST' } as never);
    assert.equal(calls.created!.createdBy, 'u2');
  });
});

describe('AgendaService · «asignada por» (F4/09)', () => {
  const NAMES = [
    { userId: 'u1', user: { profile: { firstName: 'Carlos', lastName: 'Collector' }, email: 'carlos@x.com' } },
    { userId: 'u2', user: { profile: { firstName: 'Sandra', lastName: 'Soria' }, email: 'sandra@x.com' } },
  ];

  it('en la lista aparece el nombre de quien la creó solo si no es el responsable', async () => {
    const { service } = makeService({
      permissions: ['agenda:assign'],
      rows: [row({ id: 'a1', assigneeId: 'u1', createdBy: 'u2' }), row({ id: 'a2', assigneeId: 'u1', createdBy: 'u1' })],
      userAccounts: NAMES,
    });
    const res = await service.listByDay({ date: '2026-07-08' });
    assert.equal(res.data![0]!.assignedByName, 'Sandra Soria');
    assert.equal(res.data![0]!.createdBy, 'u2');
    assert.equal(res.data![0]!.canEdit, false, 'la creó u2, no quien mira (u1)');
    assert.equal(res.data![1]!.canEdit, true, 'la creó quien mira y está pendiente');
    assert.equal(res.data![1]!.assignedByName, undefined);
    assert.ok(!JSON.stringify(res.data).includes('@x.com'), 'nunca el correo');
  });

  it('una gestión suelta (alta, edición…) también la trae', async () => {
    const { service } = makeService({
      permissions: ['agenda:write', 'agenda:assign', 'data:scope:all'],
      credits: [creditRow()],
      contacts: [{ id: CONTACT }],
      members: [COLLECTOR_OK],
      userAccounts: NAMES,
    });
    const res = await service.create(createDto({ assigneeId: 'u7' }));
    assert.equal(res.data!.assigneeId, 'u7');
    assert.equal(res.data!.assignedByName, 'Carlos Collector');
  });
});

describe('AgendaService.listAssignees (F4/09)', () => {
  it('devuelve nombre y rol, ordenados, sin correo ni teléfono', async () => {
    const { service } = makeService({
      permissions: ['agenda:assign'],
      userAccounts: [
        { userId: 'u7', branchId: 'b1', role: { name: 'COLLECTOR' }, user: { profile: { firstName: 'Rosa', lastName: 'Aliaga' }, email: 'r@x.com' } },
        { userId: 'u1', branchId: 'b1', role: { name: 'SUPERVISOR' }, user: { profile: { firstName: 'Ana', lastName: 'Zeta' }, email: 'a@x.com' } },
      ],
    });
    const res = await service.listAssignees();
    assert.deepEqual(res.data!.map((m) => m.userId), ['u1', 'u7']);
    assert.deepEqual(Object.keys(res.data![0]!).sort(), ['branchId', 'firstName', 'lastName', 'roleName', 'userId']);
    assert.ok(!JSON.stringify(res.data).includes('@x.com'));
  });
});

// ── Visita ↔ ruta (F4/11 · E1) ─────────────────────────────────────────────────────────────────

describe('AgendaService · la visita y su ruta (F4/11)', () => {
  const VISIT = (over: Record<string, unknown> = {}) => row({ type: 'VISIT', details: { locationId: LOCATION }, ...over });

  it('una visita que una ruta lleva se registra desde la parada: AGENDA_014', async () => {
    const { service } = makeService({ item: VISIT(), activeStop: { id: 's1' } });
    await expectError(() => service.complete('a1', { outcome: 'CONTACTED' } as never), 'AGENDA_014');
  });

  it('una visita sin parada se ejecuta como siempre', async () => {
    const { service, calls } = makeService({ item: VISIT(), activeStop: null });
    await service.complete('a1', { outcome: 'CONTACTED' } as never);
    assert.equal(calls.updated!.status, 'EXECUTED');
  });

  it('reagendar la visita saca la parada de la ruta planificada (se borra)', async () => {
    const { service, calls } = makeService({
      item: VISIT(),
      catalog: { code: 'CLIENT_REQUEST' },
      activeStop: { id: 's1', routeId: 'r1' },
      route: { id: 'r1', status: 'PLANNED' },
    });
    await service.reschedule('a1', { scheduledDate: isoUTC(2), timeMode: 'FIXED', scheduledTime: '10:00', reasonCode: 'CLIENT_REQUEST' } as never);
    assert.ok(calls.stopOps.some((o) => o.op === 'delete' && o.id === 's1'));
  });

  it('cancelar la visita con la ruta en curso deja la parada SALTEADA, no la borra', async () => {
    const { service, calls } = makeService({
      item: VISIT(),
      catalog: { code: 'CLIENT_UNAVAILABLE' },
      activeStop: { id: 's1', routeId: 'r1' },
      route: { id: 'r1', status: 'IN_PROGRESS' },
    });
    await service.cancel('a1', { reasonCode: 'CLIENT_UNAVAILABLE' } as never);
    assert.ok(calls.stopOps.some((o) => o.op === 'update' && o.id === 's1' && o.status === 'SKIPPED'));
    assert.ok(!calls.stopOps.some((o) => o.op === 'delete'));
  });

  it('eliminar la visita también la saca de la ruta planificada', async () => {
    const { service, calls } = makeService({ item: VISIT(), activeStop: { id: 's1', routeId: 'r1' }, route: { id: 'r1', status: 'PLANNED' } });
    await service.remove('a1');
    assert.ok(calls.stopOps.some((o) => o.op === 'delete' && o.id === 's1'));
  });

  it('agendar una visita para un día en que ya hay ruta planificada la agrega como última parada', async () => {
    const { service, calls } = makeService({
      credits: [creditRow()],
      contacts: [{ id: CONTACT }],
      locations: [{ id: LOCATION, address: 'Av. 1', latitude: -16.5, longitude: -68.1 }],
      route: { id: 'r1', status: 'PLANNED' },
    });
    await service.create(createDto({ type: 'VISIT', details: { locationId: LOCATION } }));
    const added = calls.stopOps.find((o) => o.op === 'create');
    assert.ok(added, 'la visita entró a la ruta del día');
    assert.equal(added!.sequenceOrder, 1);
    assert.ok(added!.agendaItemId);
  });
});

// ── Promesas, recordatorios y resultado visible (F4/11 · E2) ───────────────────────────────────

describe('AgendaService · promesas y recordatorios (F4/11)', () => {
  const PROMISE = (over: Record<string, unknown> = {}) =>
    row({ type: 'PROMISE_TO_PAY', scheduledDate: new Date(isoUTC(10) + 'T00:00:00.000Z'), details: { amount: 300, promiseDate: isoUTC(10), paymentMethodCode: 'CASH' }, ...over });
  const dto = (date = isoUTC(20)) => ({ scheduledDate: date, timeMode: 'FIXED', scheduledTime: '10:00', reasonCode: 'CLIENT_REQUEST' }) as never;

  it('reagendar una promesa mueve su promiseDate al día nuevo (si no, el detalle y la agenda dicen cosas distintas)', async () => {
    const { service, calls } = makeService({ item: PROMISE(), catalog: { code: 'CLIENT_REQUEST' } });
    await service.reschedule('a1', dto(isoUTC(20)));
    assert.equal((calls.created!.details as { promiseDate: string }).promiseDate, isoUTC(20));
    assert.equal((calls.created!.details as { amount: number }).amount, 300, 'el resto de la promesa se copia tal cual');
  });

  it('reagendar cancela el recordatorio de la fecha vieja y crea el de la nueva, enlazado a la promesa nueva', async () => {
    const { service, calls } = makeService({ item: PROMISE(), catalog: { code: 'CLIENT_REQUEST' } });
    await service.reschedule('a1', dto(isoUTC(20)));
    const cancel = calls.reminderCancels[0]!;
    assert.deepEqual(cancel.where.details, { path: ['promiseItemId'], equals: 'a1' });
    assert.equal(cancel.data.status, 'CANCELLED');
    const reminder = calls.createdAll.find((c) => c.type === 'REMINDER')!;
    assert.ok(reminder, 'se recreó el recordatorio');
    assert.equal(reminder.scheduledDate instanceof Date && reminder.scheduledDate.toISOString().slice(0, 10), isoUTC(19));
    assert.ok((reminder.details as { promiseItemId?: string }).promiseItemId, 'el recordatorio nuevo lleva el vínculo con su promesa');
  });

  it('cancelar, eliminar y ejecutar una promesa cancelan su recordatorio', async () => {
    const a = makeService({ item: PROMISE(), catalog: { code: 'CLIENT_UNAVAILABLE' } });
    await a.service.cancel('a1', { reasonCode: 'CLIENT_UNAVAILABLE' } as never);
    const b = makeService({ item: PROMISE() });
    await b.service.remove('a1');
    const c = makeService({ item: PROMISE() });
    await c.service.complete('a1', { outcome: 'PROMISE_KEPT' } as never);
    for (const { calls } of [a, b, c]) assert.deepEqual(calls.reminderCancels[0]!.where.details, { path: ['promiseItemId'], equals: 'a1' });
  });

  it('otros tipos no tocan recordatorios al cancelarse', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL' }), catalog: { code: 'CLIENT_UNAVAILABLE' } });
    await service.cancel('a1', { reasonCode: 'CLIENT_UNAVAILABLE' } as never);
    assert.equal(calls.reminderCancels.length, 0);
  });

  it('editar una promesa no puede mover su día: AGENDA_006 (para eso está Reagendar)', async () => {
    const { service } = makeService({ item: PROMISE(), credits: [creditRow()], credit: creditRow(), catalog: { code: 'CASH' } });
    await expectError(
      () => service.update('a1', { details: { amount: 300, promiseDate: isoUTC(15), paymentMethodCode: 'CASH' } } as never),
      'AGENDA_006',
    );
  });
});

describe('AgendaService.findOne · qué pasó (F4/11)', () => {
  const CREDIT = { id: UUID, code: 'CR-001', outstandingBalance: 1000, currency: 'BOB', daysPastDue: 3, deletedAt: null };
  const DONE = { id: 'act-9', result: 'CONTACTED', notes: 'Pagará el viernes', userId: 'u1', createdAt: new Date('2026-10-05T14:00:00Z') };
  const NAMES = [{ userId: 'u1', user: { profile: { firstName: 'Carlos', lastName: 'Collector' }, email: 'c@x.com' } }];

  it('una ejecutada trae resultado, nota, quién y cuándo', async () => {
    const { service } = makeService({ item: row({ status: 'EXECUTED', resultActivityId: 'act-9' }), credit: CREDIT, activities: [DONE], userAccounts: NAMES });
    const res = await service.findOne('a1');
    assert.deepEqual(res.data!.execution, { outcome: 'CONTACTED', notes: 'Pagará el viernes', byName: 'Carlos Collector', at: DONE.createdAt });
    assert.ok(!JSON.stringify(res.data).includes('c@x.com'), 'nunca el correo');
  });

  it('una pendiente no trae ejecución', async () => {
    const { service } = makeService({ item: row(), credit: CREDIT });
    const res = await service.findOne('a1');
    assert.equal(res.data!.execution, undefined);
    assert.equal(res.data!.rescheduledTo, undefined);
  });

  it('una reagendada dice a qué gestión se movió', async () => {
    const next = { id: 'a2', scheduledDate: new Date('2026-10-20T00:00:00Z') };
    const { service } = makeService({ item: row({ status: 'RESCHEDULED' }), credit: CREDIT, successor: next });
    const res = await service.findOne('a1');
    assert.deepEqual(res.data!.rescheduledTo, { id: 'a2', scheduledDate: next.scheduledDate });
  });

  it('el historial trae el resultado de las filas ejecutadas', async () => {
    const { service } = makeService({
      item: row(),
      credit: CREDIT,
      history: [row({ id: 'h1', status: 'EXECUTED', resultActivityId: 'act-9' }), row({ id: 'h2' })],
      activities: [DONE],
    });
    const res = await service.findOne('a1');
    const byId = new Map(res.data!.history.map((h) => [h.id, h]));
    assert.equal(byId.get('h1')!.outcome, 'CONTACTED');
    assert.equal(byId.get('h2')!.outcome, undefined);
  });
});

// ── Resumen de hoy (F4/11 · E3) ────────────────────────────────────────────────────────────────

describe('AgendaService.summary (F4/11)', () => {
  it('cuenta pendientes de hoy y vencidas, y trae las próximas del día', async () => {
    const { service } = makeService({ todayCount: 3, overdueCount: 2, rows: [row({ id: 'p1', scheduledTime: '09:00' })] });
    const res = await service.summary();
    assert.equal(res.data!.pending, 3);
    assert.equal(res.data!.overdue, 2);
    assert.equal(res.data!.items.length, 1);
    assert.match(res.data!.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('contactos efectivos de hoy: ejecutadas CON gestión real, y la gestión es del día de la empresa', async () => {
    const { service, calls } = makeService({ executedActivityIds: ['a1', 'a2', 'a3'], activitiesToday: 2 });
    const res = await service.summary();
    assert.equal(res.data!.effectiveContacts, 2);
    // Solo ejecutadas con resultado real, no borradas, y del alcance de quien pregunta.
    assert.equal(calls.executedWhere!.status, 'EXECUTED');
    assert.deepEqual(calls.executedWhere!.resultActivityId, { not: null });
    assert.equal(calls.executedWhere!.assigneeId, 'u1');
    // La gestión real tiene que ser de HOY en La Paz: [04:00Z, 04:00Z del día siguiente).
    const range = (calls.activityWhere!.createdAt as { gte: Date; lt: Date });
    assert.equal(range.lt.getTime() - range.gte.getTime(), 86_400_000);
    assert.equal(range.gte.getUTCHours(), 4);
    assert.deepEqual((calls.activityWhere!.id as { in: string[] }).in, ['a1', 'a2', 'a3']);
  });

  it('sin ejecutadas con gestión real no consulta la bitácora y da 0', async () => {
    const { service, calls } = makeService({ executedActivityIds: [], activitiesToday: 99 });
    const res = await service.summary();
    assert.equal(res.data!.effectiveContacts, 0);
    assert.equal(calls.activityWhere, undefined);
  });

  it('promesas: las que vencen hoy son SCHEDULED con fecha de hoy; las tomadas hoy, por fecha de creación', async () => {
    const { service, calls } = makeService({ promisesDueCount: 3, promisesTakenCount: 5 });
    const res = await service.summary();
    assert.equal(res.data!.promisesDue, 3);
    assert.equal(res.data!.promisesTaken, 5);
    const due = calls.promiseWheres.find((w) => w.status)!;
    assert.equal(due.status, 'SCHEDULED');
    assert.ok(due.scheduledDate instanceof Date);
    const taken = calls.promiseWheres.find((w) => !w.status)!;
    assert.equal(taken.deletedAt, null);
    assert.ok((taken.createdAt as { gte: Date }).gte instanceof Date);
    // Mismo alcance que el resto del resumen: el cobrador cuenta solo lo suyo.
    assert.equal(taken.assigneeId, 'u1');
  });

  it('trae cuándo se calculó, para que quien lo guarde sepa de cuándo es', async () => {
    const { service } = makeService({});
    const before = Date.now();
    const res = await service.summary();
    const at = Date.parse(res.data!.generatedAt);
    assert.ok(at >= before - 1000 && at <= Date.now() + 1000);
  });

  it('el cobrador cuenta solo lo suyo', async () => {
    const { service, calls } = makeService({ rows: [] });
    await service.summary();
    assert.equal(calls.listWhere!.assigneeId, 'u1');
  });

  it('sin agenda:assign no hay carga por persona', async () => {
    const { service } = makeService({ todayCount: 1 });
    const res = await service.summary();
    assert.equal(res.data!.load, undefined);
  });

  it('con agenda:assign trae la carga por persona, la más vencida primero', async () => {
    const { service } = makeService({
      permissions: ['agenda:assign'],
      todayBy: [{ assigneeId: 'u2', _count: { _all: 4 } }, { assigneeId: 'u3', _count: { _all: 1 } }],
      overdueBy: [{ assigneeId: 'u3', _count: { _all: 5 } }],
      userAccounts: [{ userId: 'u3', user: { profile: { firstName: 'Rosa', lastName: 'Aliaga' }, email: 'r@x.com' } }],
    });
    const res = await service.summary();
    assert.deepEqual(
      res.data!.load!.map((l) => [l.assigneeId, l.pending, l.overdue]),
      [['u3', 1, 5], ['u2', 4, 0]],
    );
    assert.equal(res.data!.load![0]!.name, 'Rosa Aliaga');
    assert.ok(!JSON.stringify(res.data).includes('@x.com'));
  });

  it('vencida es «antes de hoy»: lo de hoy a cualquier hora no cuenta como vencido', async () => {
    const { service, calls } = makeService({});
    await service.summary();
    const [hoy, vencidas] = calls.counts as [Date, { lt: Date }];
    assert.ok(hoy instanceof Date);
    assert.ok(vencidas.lt instanceof Date);
    assert.equal(hoy.getTime(), vencidas.lt.getTime(), 'las dos comparten el mismo «hoy» del tenant');
  });
});

// ── Avisos de agenda (F4/11 · E4) ──────────────────────────────────────────────────────────────

describe('AgendaService · avisos al responsable (F4/11)', () => {
  const NAMES = [
    { userId: 'u1', user: { profile: { firstName: 'Sandra', lastName: 'Soria' }, email: 's@x.com' } },
  ];
  const OTHER = (over: Record<string, unknown> = {}) => row({ assigneeId: 'u9', createdBy: 'u1', ...over });

  it('asignarle una gestión a otra persona le avisa (AGENDA_ASSIGNED), con quién, qué y cuándo', async () => {
    const { service, calls } = makeService({
      permissions: ['agenda:write', 'agenda:assign', 'data:scope:all'],
      credits: [creditRow()],
      contacts: [{ id: CONTACT }],
      members: [{ userId: 'u9', isActive: true, branchId: 'b1', role: { name: 'COLLECTOR' } }],
      userAccounts: NAMES,
    });
    await service.create(createDto({ assigneeId: 'u9' }));
    const sent = calls.eventPayloads.find((e) => e.event === 'agenda.assigned');
    assert.ok(sent, 'salió el evento');
    assert.equal(sent!.payload.recipientId, 'u9');
    assert.equal(sent!.payload.actorId, 'u1');
    assert.equal(sent!.payload.actorName, 'Sandra Soria');
    assert.equal(sent!.payload.itemType, 'CALL');
  });

  it('agendarse una gestión a uno mismo no avisa a nadie', async () => {
    const { service, calls } = makeService({ credits: [creditRow()], contacts: [{ id: CONTACT }], permissions: ['agenda:write'] });
    await service.create(createDto());
    assert.equal(calls.eventPayloads.length, 0);
  });

  it('cancelar, eliminar, reagendar o editar lo de otro le avisa (AGENDA_CHANGED) con el tipo de cambio', async () => {
    const kinds: Record<string, string> = {};
    const a = makeService({ item: OTHER(), catalog: { code: 'CLIENT_UNAVAILABLE' }, userAccounts: NAMES, permissions: ['agenda:assign'] });
    await a.service.cancel('a1', { reasonCode: 'CLIENT_UNAVAILABLE' } as never);
    kinds.cancel = String(a.calls.eventPayloads[0]?.payload.kind);
    const b = makeService({ item: OTHER(), userAccounts: NAMES, permissions: ['agenda:assign'] });
    await b.service.remove('a1');
    kinds.remove = String(b.calls.eventPayloads[0]?.payload.kind);
    const c = makeService({ item: OTHER(), catalog: { code: 'CLIENT_REQUEST' }, userAccounts: NAMES, permissions: ['agenda:assign'] });
    await c.service.reschedule('a1', { scheduledDate: isoUTC(3), timeMode: 'FIXED', scheduledTime: '10:00', reasonCode: 'CLIENT_REQUEST' } as never);
    kinds.reschedule = String(c.calls.eventPayloads[0]?.payload.kind);
    const d = makeService({ item: OTHER(), userAccounts: NAMES, permissions: ['agenda:assign'] });
    await d.service.update('a1', { observations: 'x' } as never);
    kinds.update = String(d.calls.eventPayloads[0]?.payload.kind);
    assert.deepEqual(kinds, { cancel: 'CANCELLED', remove: 'DELETED', reschedule: 'RESCHEDULED', update: 'UPDATED' });
    for (const x of [a, b, c, d]) {
      assert.equal(x.calls.eventPayloads[0]!.event, 'agenda.changed');
      assert.equal(x.calls.eventPayloads[0]!.payload.recipientId, 'u9');
    }
  });

  it('cambiar una gestión propia no avisa a nadie', async () => {
    const { service, calls } = makeService({ item: row(), catalog: { code: 'CLIENT_UNAVAILABLE' } });
    await service.cancel('a1', { reasonCode: 'CLIENT_UNAVAILABLE' } as never);
    assert.equal(calls.eventPayloads.length, 0);
  });
});

// ── Reasignar una gestión (F4/11 · E5) ─────────────────────────────────────────────────────────

describe('AgendaService.update · reasignar (F4/11)', () => {
  const ASSIGN = ['agenda:write', 'agenda:assign', 'data:scope:all'];
  const COLLECTOR = { userId: 'u7', isActive: true, branchId: 'b1', role: { name: 'COLLECTOR' } };
  const NAMES = [{ userId: 'u1', user: { profile: { firstName: 'Sandra', lastName: 'Soria' }, email: 's@x.com' } }];

  it('quien la creó la reasigna a un cobrador de su alcance', async () => {
    const { service, calls } = makeService({ permissions: ASSIGN, item: row({ assigneeId: 'u9', createdBy: 'u1' }), members: [COLLECTOR], userAccounts: NAMES });
    await service.update('a1', { assigneeId: 'u7' } as never);
    assert.equal(calls.updated!.assigneeId, 'u7');
  });

  it('el nuevo responsable recibe la gestión y el anterior se entera de que ya no es suya (dos avisos distintos)', async () => {
    const { service, calls } = makeService({ permissions: ASSIGN, item: row({ assigneeId: 'u9', createdBy: 'u1' }), members: [COLLECTOR], userAccounts: NAMES });
    await service.update('a1', { assigneeId: 'u7' } as never);
    const sent = calls.eventPayloads.map((e) => [e.event, e.payload.recipientId, e.payload.kind]);
    assert.deepEqual(sent, [['agenda.assigned', 'u7', 'ASSIGNED'], ['agenda.changed', 'u9', 'REASSIGNED']]);
  });

  it('no es la creadora: no reasigna, ni siquiera siendo administradora (AGENDA_012)', async () => {
    const { service } = makeService({ permissions: ASSIGN, item: row({ assigneeId: 'u9', createdBy: 'u2' }), members: [COLLECTOR] });
    await expectError(() => service.update('a1', { assigneeId: 'u7' } as never), 'AGENDA_012');
  });

  it('un cobrador no puede pasarle una gestión a otro (AGENDA_010)', async () => {
    const { service } = makeService({ permissions: ['agenda:write'], item: row({ assigneeId: 'u1', createdBy: 'u1' }), members: [COLLECTOR] });
    await expectError(() => service.update('a1', { assigneeId: 'u7' } as never), 'AGENDA_010');
  });

  it('el destinatario debe ser un cobrador o supervisor activo: un gerente no (AGENDA_011)', async () => {
    const { service } = makeService({ permissions: ASSIGN, item: row({ assigneeId: 'u9', createdBy: 'u1' }), members: [{ ...COLLECTOR, role: { name: 'MANAGER' } }] });
    await expectError(() => service.update('a1', { assigneeId: 'u7' } as never), 'AGENDA_011');
  });

  it('pedir el mismo responsable no cambia nada ni avisa', async () => {
    const { service, calls } = makeService({ permissions: ASSIGN, item: row({ assigneeId: 'u9', createdBy: 'u1' }), members: [COLLECTOR] });
    await service.update('a1', { assigneeId: 'u9', observations: 'x' } as never);
    assert.equal(calls.updated!.assigneeId, undefined);
    assert.deepEqual(calls.eventPayloads.map((e) => e.payload.kind), ['UPDATED']);
  });

  it('una visita que cambia de responsable sale de la ruta del anterior', async () => {
    const { service, calls } = makeService({
      permissions: ASSIGN,
      item: row({ type: 'VISIT', details: { locationId: LOCATION }, assigneeId: 'u9', createdBy: 'u1' }),
      members: [COLLECTOR],
      activeStop: { id: 's1', routeId: 'r1' },
      route: { id: 'r1', status: 'PLANNED' },
    });
    await service.update('a1', { assigneeId: 'u7' } as never);
    assert.ok(calls.stopOps.some((o) => o.op === 'delete' && o.id === 's1'));
  });
});

describe('AgendaService.findOne · visita en ruta (F4/11)', () => {
  const CREDIT = { id: UUID, code: 'CR-001', outstandingBalance: 1000, currency: 'BOB', daysPastDue: 3, deletedAt: null };

  it('una visita pendiente que una ruta lleva dice en qué ruta y parada, para registrarla desde ahí', async () => {
    const { service } = makeService({ item: row({ type: 'VISIT', details: { locationId: LOCATION } }), credit: CREDIT, activeStop: { id: 's1', routeId: 'r1' } });
    const res = await service.findOne('a1');
    assert.deepEqual(res.data!.route, { routeId: 'r1', stopId: 's1' });
  });

  it('una visita sin parada, o cualquier otro tipo, no trae ruta', async () => {
    const sin = makeService({ item: row({ type: 'VISIT', details: { locationId: LOCATION } }), credit: CREDIT, activeStop: null });
    assert.equal((await sin.service.findOne('a1')).data!.route, undefined);
    const llamada = makeService({ item: row({ type: 'CALL' }), credit: CREDIT, activeStop: { id: 's1', routeId: 'r1' } });
    assert.equal((await llamada.service.findOne('a1')).data!.route, undefined);
  });

  it('una visita ya ejecutada no trae ruta aunque tuvo parada', async () => {
    const { service } = makeService({ item: row({ type: 'VISIT', status: 'EXECUTED', details: { locationId: LOCATION } }), credit: CREDIT, activeStop: { id: 's1', routeId: 'r1' } });
    assert.equal((await service.findOne('a1')).data!.route, undefined);
  });
});

describe('AgendaService.complete — contexto de la gestión (F4/13 · E4)', () => {
  const hoy = new Date().toISOString().slice(0, 10);

  it('deja el motivo, quién responde y el origen en la actividad', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'SCHEDULED' }) });
    await service.complete('a1', { outcome: 'CONTACTED', reasonCode: 'LATE_INCOME', expectedIncomeDate: hoy, payerParty: 'HOLDER', origin: 'DICTATION' } as never);
    assert.equal(calls.activity!.reasonCode, 'LATE_INCOME');
    assert.equal(calls.activity!.payerParty, 'HOLDER');
    assert.equal(calls.activity!.origin, 'DICTATION');
  });

  it('🔴 sin contexto no cambia nada de lo de siempre', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'SCHEDULED' }) });
    await service.complete('a1', { outcome: 'CONTACTED' } as never);
    assert.equal(calls.activity!.reasonCode, null);
    assert.equal(calls.activity!.payerParty, null);
  });

  it('un motivo inválido → AGENDA_INVALID_CONTEXT y no escribe nada', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'SCHEDULED' }) });
    await assert.rejects(
      () => service.complete('a1', { outcome: 'CONTACTED', reasonCode: 'perdio el empleo' } as never),
      (e: { getResponse: () => { code: string } }) => e.getResponse().code === 'AGENDA_INVALID_CONTEXT',
    );
    assert.equal(calls.activity, undefined);
  });

  it('un recordatorio (que deja una nota) no lleva contexto', async () => {
    const { service } = makeService({ item: row({ type: 'REMINDER', status: 'SCHEDULED' }) });
    await assert.rejects(
      () => service.complete('a1', { outcome: 'DONE', reasonCode: 'FORGOT' } as never),
      (e: { getResponse: () => { code: string } }) => e.getResponse().code === 'AGENDA_INVALID_CONTEXT',
    );
  });
});

describe('AgendaService.complete — plantilla elegida (F4/13 · E5)', () => {
  it('deja el código de la plantilla en la actividad de un mensaje', async () => {
    const { service, calls } = makeService({ item: row({ type: 'WHATSAPP', status: 'SCHEDULED' }) });
    await service.complete('a1', { outcome: 'CONTACTED', templateCode: 'LAST_NOTICE' } as never);
    assert.equal(calls.activity!.templateCode, 'LAST_NOTICE');
    assert.equal(calls.activity!.type, 'MESSAGE');
  });

  it('🔴 sin plantilla queda en NULL', async () => {
    const { service, calls } = makeService({ item: row({ type: 'WHATSAPP', status: 'SCHEDULED' }) });
    await service.complete('a1', { outcome: 'CONTACTED' } as never);
    assert.equal(calls.activity!.templateCode, null);
  });

  it('una llamada no lleva plantilla → AGENDA_INVALID_CONTEXT y no escribe', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'SCHEDULED' }) });
    await assert.rejects(
      () => service.complete('a1', { outcome: 'CONTACTED', templateCode: 'INITIAL' } as never),
      (e: { getResponse: () => { code: string } }) => e.getResponse().code === 'AGENDA_INVALID_CONTEXT',
    );
    assert.equal(calls.activity, undefined);
  });
});
