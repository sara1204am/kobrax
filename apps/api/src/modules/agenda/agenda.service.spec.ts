import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgendaService } from './agenda.service';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CONTACT = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';

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
}

function makeService(opts: Opts = {}) {
  const calls = {
    listWhere: undefined as Record<string, unknown> | undefined,
    caseWhere: undefined as Record<string, unknown> | undefined,
    created: undefined as Record<string, unknown> | undefined,
    audits: [] as { entity: string; action: string }[],
    reveals: [] as { id: string; reveal: boolean }[],
    addedContacts: [] as Record<string, unknown>[],
    addedLocations: [] as Record<string, unknown>[],
  };
  const first = <T>(list: T[] | undefined) => (list && list.length > 0 ? list[0] : null);
  const tx = {
    agendaItem: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        calls.listWhere = args.where;
        return opts.rows ?? [];
      },
      count: async () => (opts.rows ?? []).length,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.created = args.data;
        return row(args.data);
      },
    },
    client: { findMany: async () => opts.clients ?? [] },
    collectionCase: {
      findMany: async () => opts.cases ?? [],
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        calls.caseWhere = args.where;
        return first(opts.cases as Record<string, unknown>[] | undefined);
      },
    },
    clientContact: { findFirst: async () => first(opts.contacts as unknown[]) },
    clientLocation: { findFirst: async () => first(opts.locations as unknown[]) },
    catalogItem: { findFirst: async () => opts.catalog ?? null },
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
        contacts: [{ id: CONTACT, contactType: 'PHONE', value: '78012345', isPrimary: true }],
        locations: [{ id: LOCATION, locationType: 'HOME', address: 'Av. Siempre Viva 742' }],
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
  const service = new AgendaService(prisma as never, tenant as never, audit as never, clientsService as never);
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
