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
    id: 'a1', caseId: 'ca1', clientId: 'cl1', creditId: 'cr1', assigneeId: 'u1',
    type: 'CALL', status: 'SCHEDULED', priorityCode: null, expectedResultCode: null,
    scheduledDate: new Date('2026-07-08'), timeMode: 'FIXED', scheduledTime: '09:00',
    timeSlot: null, observations: null, details: {}, resultActivityId: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

/** Caso abierto de `cl1` con su crédito (saldo 1000, moneda BOB). */
function openCase(over: Record<string, unknown> = {}) {
  return {
    id: UUID, clientId: 'cl1', creditId: UUID, status: 'ACTIVE', deletedAt: null, assigneeId: 'u1',
    credit: { id: UUID, code: 'CR-001', principalAmount: 1500, outstandingBalance: 1000, currency: 'BOB', daysPastDue: 12, deletedAt: null },
    ...over,
  };
}

interface Opts {
  permissions?: string[];
  rows?: unknown[];
  clients?: unknown[];
  cases?: unknown[];
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
}

function makeService(opts: Opts = {}) {
  const calls = {
    listWhere: undefined as Record<string, unknown> | undefined,
    itemWhere: undefined as Record<string, unknown> | undefined,
    historyWhere: undefined as Record<string, unknown> | undefined,
    caseWhere: undefined as Record<string, unknown> | undefined,
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
  };
  const first = <T>(list: T[] | undefined) => (list && list.length > 0 ? list[0] : null);
  const tx = {
    agendaItem: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        // `findOne` pide el historial por `caseId`; el resto de las lecturas listan por día/vencidos.
        if (args.where?.caseId) {
          calls.historyWhere = args.where;
          return opts.history ?? [];
        }
        calls.listWhere = args.where;
        return opts.rows ?? [];
      },
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        calls.itemWhere = args.where;
        return opts.item ?? null;
      },
      count: async () => (opts.rows ?? []).length,
      create: async (args: { data: Record<string, unknown> }) => {
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
    },
    caseActivity: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.activity = args.data;
        return { id: 'act-1', ...args.data };
      },
    },
    credit: { findFirst: async () => opts.credit ?? null },
    client: { findMany: async () => opts.clients ?? [] },
    collectionCase: {
      findMany: async () => opts.cases ?? [],
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        calls.caseWhere = args.where;
        return first(opts.cases as Record<string, unknown>[] | undefined);
      },
      update: async () => ({}),
    },
    clientContact: { findFirst: async () => first(opts.contacts as unknown[]) },
    clientLocation: { findFirst: async () => first(opts.locations as unknown[]) },
    catalogItem: {
      findFirst: async () => opts.catalog ?? null,
      findMany: async () => opts.catalogRows ?? [],
    },
    creditInstallment: { groupBy: async () => opts.installments ?? [] },
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
  const events = { emit: (e: string) => void calls.events.push(e) };
  // El reloj del tenant, fijado en UTC: los tests arman sus fechas con `isoUTC`, que es la misma vara.
  const clock = { today: async () => new Date(`${isoUTC(0)}T00:00:00.000Z`) };
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
    caseId: UUID, creditId: UUID, type: 'CALL', scheduledDate: isoUTC(1),
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

  it('el historial es del mismo caso, excluye el ítem abierto y los borrados', async () => {
    const { service, calls } = makeService({
      item: row(),
      credit: CREDIT,
      history: [row({ id: 'a2', status: 'EXECUTED', scheduledDate: new Date('2026-06-21') })],
    });
    const res = await service.findOne('a1');
    assert.equal(calls.historyWhere!.caseId, 'ca1');
    assert.deepEqual(calls.historyWhere!.id, { not: 'a1' });
    assert.equal(calls.historyWhere!.deletedAt, null);
    // El historial es del caso, no del cobrador: un supervisor y su cobrador ven lo mismo.
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
  it('deja un CaseActivity con el outcome, apunta el agendado y lo pasa a EXECUTED', async () => {
    const { service, calls } = makeService({ item: row({ type: 'CALL', status: 'SCHEDULED' }) });
    const res = await service.complete('a1', { outcome: 'CONTACTED' } as never);
    assert.equal(calls.activity!.type, 'CALL'); // mapType CALL -> CALL
    assert.equal(calls.activity!.result, 'CONTACTED');
    assert.equal(calls.activity!.caseId, 'ca1');
    assert.equal(calls.updated!.status, 'EXECUTED');
    assert.equal(calls.updated!.resultActivityId, 'act-1');
    assert.equal(res.data!.status, 'EXECUTED');
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'EXECUTE' }]);
    assert.equal(calls.events.length, 1); // CASE_UPDATED
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

describe('AgendaService.postpone (S4)', () => {
  it('corre la hora AGENDADA (naive) +30, sigue SCHEDULED y fija a hora exacta', async () => {
    const { service, calls } = makeService({ item: row({ status: 'SCHEDULED', scheduledDate: new Date('2026-07-12'), scheduledTime: '09:00' }) });
    const res = await service.postpone('a1', { minutes: 30 } as never);
    assert.equal(calls.updated!.scheduledTime, '09:30'); // +30 sobre la hora agendada, no sobre el reloj del server
    assert.equal(calls.updated!.timeMode, 'FIXED');
    assert.equal(calls.updated!.timeSlot, null);
    assert.notEqual(res.data!.status, 'EXECUTED');
    assert.deepEqual(calls.audits, [{ entity: 'agenda_item', action: 'POSTPONE' }]);
  });

  it('cruza la medianoche: +60 sobre 23:50 → 00:50 del día siguiente', async () => {
    const { service, calls } = makeService({ item: row({ status: 'SCHEDULED', scheduledDate: new Date('2026-07-12'), scheduledTime: '23:50' }) });
    await service.postpone('a1', { minutes: 60 } as never);
    assert.equal(calls.updated!.scheduledTime, '00:50');
    assert.equal((calls.updated!.scheduledDate as Date).toISOString().slice(0, 10), '2026-07-13');
  });

  it('un agendado por franja parte del inicio de la franja (MORNING = 08:00)', async () => {
    const { service, calls } = makeService({ item: row({ status: 'SCHEDULED', scheduledTime: null, timeSlot: 'MORNING', timeMode: 'LAPSE' }) });
    await service.postpone('a1', { minutes: 15 } as never);
    assert.equal(calls.updated!.scheduledTime, '08:15'); // no 00:15
  });

  it('posponer una gestión ya ejecutada → AGENDA_008', async () => {
    const { service } = makeService({ item: row({ status: 'EXECUTED' }) });
    await expectError(() => service.postpone('a1', { minutes: 15 } as never), 'AGENDA_008');
  });
});

describe('AgendaService.clientContext', () => {
  it('devuelve créditos agendables y revela la PII con auditoría', async () => {
    const { service, calls } = makeService({ cases: [openCase()] });
    const res = await service.clientContext('cl1');
    assert.equal(res.data!.credits.length, 1);
    assert.equal(res.data!.credits[0]!.outstandingBalance, 1000);
    assert.equal(res.data!.client.displayName, 'Ana Ruiz');
    assert.equal(res.data!.contacts[0]!.value, '78012345'); // en claro
    assert.deepEqual(calls.reveals, [{ id: 'cl1', reveal: true }]);
    // Doble rastro: el de ClientsService (entity `client`) + el propio del módulo, que identifica la puerta.
    assert.deepEqual(calls.audits, [{ entity: 'agenda_client_context', action: 'PII_REVEAL' }]);
  });

  it('trae el capital y el saldo de las cuotas vencidas (impago, no el monto original)', async () => {
    const { service } = makeService({
      cases: [openCase()],
      installments: [{ creditId: UUID, _sum: { amount: 400, paidAmount: 150 } }],
    });
    const res = await service.clientContext('cl1');
    assert.equal(res.data!.credits[0]!.principalAmount, 1500);
    assert.equal(res.data!.credits[0]!.overdueAmount, 250); // 400 - 150 ya pagados
  });

  it('crédito sin cronograma cargado → mora 0, no undefined', async () => {
    const { service } = makeService({ cases: [openCase()], installments: [] });
    const res = await service.clientContext('cl1');
    assert.equal(res.data!.credits[0]!.overdueAmount, 0);
  });

  it('excluye casos terminales → sin casos abiertos corta con AGENDA_002 y NO revela PII', async () => {
    const { service, calls } = makeService({ cases: [openCase({ status: 'CLOSED' })] });
    await expectError(() => service.clientContext('cl1'), 'AGENDA_002');
    assert.deepEqual(calls.reveals, []);
    assert.deepEqual(calls.audits, []);
  });
});

describe('AgendaService.addClientContact', () => {
  const phone = { contactType: 'PHONE' as const, value: '78099999', notes: 'Celular nuevo' };

  it('delega el cifrado y el audit en ClientsService, y no filtra el ciphertext', async () => {
    const { service, calls } = makeService({ cases: [openCase()] });
    const res = await service.addClientContact('cl1', phone);
    assert.deepEqual(calls.addedContacts, [{ clientId: 'cl1', ...phone }]);
    assert.equal(res.data!.value, '78099999'); // el valor que mandó el cliente, no `enc(...)`
    assert.equal(res.data!.id, 'new-contact');
  });

  it('respeta el scope: cliente sin casos propios → AGENDA_002 y no escribe nada', async () => {
    const { service, calls } = makeService({ cases: [] });
    await expectError(() => service.addClientContact('cl1', phone), 'AGENDA_002');
    assert.deepEqual(calls.addedContacts, []);
  });
});

describe('AgendaService.addClientLocation', () => {
  const place = { locationType: 'HOME' as const, address: 'Calle Falsa 123', zone: 'Sur', latitude: -17.78, longitude: -63.18 };

  it('guarda la dirección con sus coordenadas y devuelve el texto en claro', async () => {
    const { service, calls } = makeService({ cases: [openCase()] });
    const res = await service.addClientLocation('cl1', place);
    assert.deepEqual(calls.addedLocations, [{ clientId: 'cl1', ...place }]);
    assert.equal(res.data!.address, 'Calle Falsa 123'); // no `enc(...)`
    assert.equal(res.data!.latitude, -17.78);
    assert.equal(res.data!.longitude, -63.18);
  });

  it('las coordenadas son opcionales: se puede cargar sólo la dirección', async () => {
    const { service } = makeService({ cases: [openCase()] });
    const res = await service.addClientLocation('cl1', { locationType: 'WORK', address: 'Av. Siempre Viva 742' });
    assert.equal(res.data!.latitude, undefined);
    assert.equal(res.data!.longitude, undefined);
  });

  it('respeta el scope: cliente sin casos propios → AGENDA_002 y no escribe nada', async () => {
    const { service, calls } = makeService({ cases: [] });
    await expectError(() => service.addClientLocation('cl1', place), 'AGENDA_002');
    assert.deepEqual(calls.addedLocations, []);
  });
});

describe('AgendaService.create', () => {
  it('crea y deriva clientId/assigneeId del caso (nunca del body)', async () => {
    const { service, calls } = makeService({ cases: [openCase()], contacts: [{ id: CONTACT }] });
    const res = await service.create(createDto());
    assert.equal(calls.created!.clientId, 'cl1');
    assert.equal(calls.created!.assigneeId, 'u1');
    assert.equal(calls.created!.timeSlot, null); // FIXED no persiste franja
    assert.equal(calls.caseWhere!.assigneeId, 'u1'); // scope del cobrador
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
      cases: [openCase()],
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
    assert.equal(recordatorio!.caseId, promesa!.caseId);
    // Y queda auditado como cualquier alta.
    assert.deepEqual(calls.audits, [
      { entity: 'agenda_item', action: 'CREATE' },
      { entity: 'agenda_item', action: 'CREATE' },
    ]);
  });

  it('una promesa para MAÑANA no crea recordatorio: caería hoy y no recuerda nada', async () => {
    const { service, calls } = makeService({
      cases: [openCase()],
      catalog: { code: 'CASH', label: 'Efectivo' }, // el medio de pago que valida `assertPaymentMethod`
    });
    await service.create(promiseDto(1));
    assert.equal(calls.createdAll.length, 1);
    assert.equal(calls.createdAll[0]!.type, 'PROMISE_TO_PAY');
  });

  it('el resto de los tipos no crean recordatorio', async () => {
    const { service, calls } = makeService({ cases: [openCase()], contacts: [{ id: CONTACT }] });
    await service.create(createDto());
    assert.equal(calls.createdAll.length, 1);
  });

  it('un supervisor agendando sobre un caso ajeno lo asigna al cobrador del caso, no a sí mismo', async () => {
    const { service, calls } = makeService({
      permissions: ['agenda:assign'],
      cases: [openCase({ assigneeId: 'cobrador-2' })],
      contacts: [{ id: CONTACT }],
    });
    await service.create(createDto());
    assert.equal(calls.created!.assigneeId, 'cobrador-2'); // si no, el cobrador nunca lo vería en su agenda
    assert.equal(calls.caseWhere!.assigneeId, undefined); // AGENDA_ASSIGN ve todo el tenant
  });

  it('caso sin cobrador asignado → el agendado queda para quien lo crea', async () => {
    const { service, calls } = makeService({ cases: [openCase({ assigneeId: null })], contacts: [{ id: CONTACT }] });
    await service.create(createDto());
    assert.equal(calls.created!.assigneeId, 'u1');
  });

  it('caso ajeno / inexistente → AGENDA_001', async () => {
    const { service } = makeService({ cases: [] });
    await expectError(() => service.create(createDto()), 'AGENDA_001');
  });

  it('caso terminal → AGENDA_001', async () => {
    const { service } = makeService({ cases: [openCase({ status: 'WRITTEN_OFF' })] });
    await expectError(() => service.create(createDto()), 'AGENDA_001');
  });

  it('creditId que no es el del caso → AGENDA_001', async () => {
    const { service } = makeService({ cases: [openCase({ creditId: 'otro' })] });
    await expectError(() => service.create(createDto()), 'AGENDA_001');
  });

  it('fecha pasada → AGENDA_003', async () => {
    const { service } = makeService({ cases: [openCase()] });
    await expectError(() => service.create(createDto({ scheduledDate: isoUTC(-1) })), 'AGENDA_003');
  });

  it('hoy sí se puede agendar (el borde no es pasado)', async () => {
    const { service } = makeService({ cases: [openCase()], contacts: [{ id: CONTACT }] });
    await service.create(createDto({ scheduledDate: isoUTC(0) }));
  });

  it('FIXED sin hora → AGENDA_004; LAPSE sin franja → AGENDA_004', async () => {
    const { service } = makeService({ cases: [openCase()], contacts: [{ id: CONTACT }] });
    await expectError(() => service.create(createDto({ scheduledTime: undefined })), 'AGENDA_004');
    await expectError(() => service.create(createDto({ timeMode: 'LAPSE', scheduledTime: undefined })), 'AGENDA_004');
  });

  it('details inválido para el tipo → AGENDA_005 con la lista de errores', async () => {
    const { service } = makeService({ cases: [openCase()] });
    await expectError(() => service.create(createDto({ details: {} })), 'AGENDA_005');
  });

  it('contactId de otro cliente → AGENDA_006', async () => {
    const { service } = makeService({ cases: [openCase()], contacts: [] });
    await expectError(() => service.create(createDto()), 'AGENDA_006');
  });

  it('VISIT con dirección libre no cruza contra la DB', async () => {
    const { service } = makeService({ cases: [openCase()], locations: [] });
    await service.create(createDto({ type: 'VISIT', details: { customAddress: { address: 'Calle 1' } } }));
  });

  it('VISIT con locationId ajeno → AGENDA_006', async () => {
    const { service } = makeService({ cases: [openCase()], locations: [] });
    await expectError(() => service.create(createDto({ type: 'VISIT', details: { locationId: LOCATION } })), 'AGENDA_006');
  });

  const promise = (over: Record<string, unknown> = {}) =>
    createDto({
      type: 'PROMISE_TO_PAY',
      details: { amount: 500, promiseDate: isoUTC(3), paymentMethodCode: 'CASH', ...over },
    });

  it('promesa por encima del saldo → AGENDA_006', async () => {
    const { service } = makeService({ cases: [openCase()], catalog: { code: 'CASH', metadata: {} } });
    await expectError(() => service.create(promise({ amount: 1000.01 })), 'AGENDA_006');
  });

  it('medio de pago inexistente o inactivo → AGENDA_006', async () => {
    const { service } = makeService({ cases: [openCase()], catalog: null });
    await expectError(() => service.create(promise()), 'AGENDA_006');
  });

  it('medio con requiresBank y sin banco → AGENDA_006', async () => {
    const { service } = makeService({ cases: [openCase()], catalog: { code: 'TRANSFER', metadata: { requiresBank: true } } });
    await expectError(() => service.create(promise({ paymentMethodCode: 'TRANSFER' })), 'AGENDA_006');
  });

  it('promesa con fecha de pago pasada → AGENDA_003', async () => {
    const { service } = makeService({ cases: [openCase()], catalog: { code: 'CASH', metadata: {} } });
    await expectError(() => service.create(promise({ promiseDate: isoUTC(-1) })), 'AGENDA_003');
  });

  it('promesa válida persiste los details normalizados', async () => {
    const { service, calls } = makeService({ cases: [openCase()], catalog: { code: 'CASH', metadata: {} } });
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
