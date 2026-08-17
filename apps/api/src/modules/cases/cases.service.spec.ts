import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CasesService } from './cases.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: {
  credit?: unknown;
  openCase?: unknown;
  caseRow?: { status: string } | null;
  activityCount?: number;
  creditsInMora?: unknown[];
  openCreditIds?: string[];
  permissions?: string[];
  listRows?: Record<string, unknown>[];
  portfolioClients?: Record<string, unknown>[];
  portfolioPromises?: { clientId: string }[];
} = {}) {
  const calls = {
    create: [] as Record<string, unknown>[],
    update: [] as Record<string, unknown>[],
    activity: [] as Record<string, unknown>[],
    audit: [] as { action: string }[],
    events: [] as string[],
    agenda: [] as Record<string, unknown>[],
    listWhere: undefined as Record<string, unknown> | undefined,
    listOrderBy: undefined as Record<string, unknown>[] | undefined,
  };
  const tx = {
    account: { findUnique: async () => ({ configuration: {} }) },
    credit: {
      findFirst: async () => opts.credit ?? null,
      findMany: async () => opts.creditsInMora ?? [],
    },
    client: { findMany: async () => opts.portfolioClients ?? [] },
    agendaItem: {
      findMany: async () => opts.portfolioPromises ?? [],
      create: async (args: { data: Record<string, unknown> }) => {
        calls.agenda.push(args.data);
        return { id: 'ag1', ...args.data };
      },
    },
    collectionCase: {
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const w = args.where ?? {};
        if (w.creditId && w.status) return opts.openCase ?? null; // dup check
        if (w.id) return opts.caseRow ?? null;
        return null;
      },
      findMany: async (args: {
        where?: Record<string, unknown>;
        include?: unknown;
        orderBy?: Record<string, unknown>[];
      }) => {
        if (args?.include) {
          calls.listWhere = args.where; // list() incluye client/credit
          calls.listOrderBy = args.orderBy;
          return opts.listRows ?? [];
        }
        return (opts.openCreditIds ?? []).map((id) => ({ creditId: id })); // generate()
      },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.create.push(args.data);
        return { id: 'case1', ...args.data };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.update.push(args.data);
        return { id: args.where.id, ...(opts.caseRow as object), ...args.data };
      },
      count: async () => 0,
    },
    caseActivity: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.activity.push(args.data);
        return { id: 'act1', createdAt: new Date(), ...args.data };
      },
      count: async () => opts.activityCount ?? 0,
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const perms = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'u1', permissions: perms, can: (p: string) => perms.includes(p) };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e) };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const crypto = { decrypt: (v: string) => v }; // identidad: el documento del test ya va "en claro"
  const service = new CasesService(prisma as never, tenant as never, audit as never, events as never, crypto as never);
  return { service, calls };
}

const CREDIT = { id: 'cr1', clientId: 'cl1', branchId: null, outstandingBalance: 6000, daysPastDue: 35, client: { riskSegment: 'HIGH' } };

describe('CasesService.create', () => {
  it('crea el caso (PENDING) con prioridad calculada + SLA + audit + evento', async () => {
    const { service, calls } = makeService({ credit: CREDIT, openCase: null });
    const res = await service.create({ creditId: 'cr1' });
    assert.equal(res.status, 'PENDING');
    assert.equal(calls.create[0]!.priority, 'HIGH'); // 6 + 35 + 30 = 71
    assert.ok(calls.create[0]!.slaDueAt instanceof Date);
    assert.deepEqual(calls.audit.map((a) => a.action), ['CREATE']);
    assert.deepEqual(calls.events, ['case.updated']);
  });

  it('rechaza un segundo caso abierto para el crédito (CASE_DUP)', async () => {
    const { service } = makeService({ credit: CREDIT, openCase: { id: 'x' } });
    await rejectsWithCode(service.create({ creditId: 'cr1' }), 'CASE_DUP');
  });

  it('404 si el crédito no existe', async () => {
    const { service } = makeService({ credit: null });
    await rejectsWithCode(service.create({ creditId: 'cr1' }), 'RESOURCE_NOT_FOUND');
  });
});

describe('CasesService.transition (máquina de estados)', () => {
  it('permite una transición válida (PENDING → ACTIVE)', async () => {
    const { service, calls } = makeService({ caseRow: { status: 'PENDING' } });
    await service.transition('case1', { status: 'ACTIVE' as never });
    assert.equal(calls.update[0]!.status, 'ACTIVE');
    assert.deepEqual(calls.events, ['case.updated']);
  });

  it('rechaza una transición inválida (PENDING → PAID) con CASE_002', async () => {
    const { service } = makeService({ caseRow: { status: 'PENDING' } });
    await rejectsWithCode(service.transition('case1', { status: 'PAID' as never }), 'CASE_002');
  });
});

describe('CasesService.close', () => {
  it('no cierra sin gestión registrada (CASE_001)', async () => {
    const { service } = makeService({ caseRow: { status: 'PAID' }, activityCount: 0 });
    await rejectsWithCode(service.close('case1', 'pagado'), 'CASE_001');
  });

  it('cierra un caso PAID con gestión: status CLOSED + closedAt', async () => {
    const { service, calls } = makeService({ caseRow: { status: 'PAID' }, activityCount: 2 });
    await service.close('case1', 'pagado total');
    assert.equal(calls.update[0]!.status, 'CLOSED');
    assert.ok(calls.update[0]!.closedAt instanceof Date);
    assert.equal(calls.update[0]!.closedReason, 'pagado total');
  });
});

describe('CasesService.list (scope por capacidad + enriquecimiento)', () => {
  it('cobrador (CASE_WRITE sin CASE_ASSIGN) queda acotado a su propio assigneeId (ignora el pedido)', async () => {
    const { service, calls } = makeService({ permissions: ['case:read', 'case:write'] });
    await service.list({ assigneeId: 'otro-cobrador' } as never);
    assert.equal(calls.listWhere!.assigneeId, 'u1');
  });

  it('observador de cuenta (CASE_READ sin write ni assign = auditor) ve toda la cuenta', async () => {
    const { service, calls } = makeService({ permissions: ['case:read'] });
    await service.list({} as never);
    assert.equal(calls.listWhere!.assigneeId, undefined); // no se acota: un auditor audita todo el tenant
  });

  it('con CASE_ASSIGN respeta el assigneeId pedido', async () => {
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({ assigneeId: 'otro-cobrador' } as never);
    assert.equal(calls.listWhere!.assigneeId, 'otro-cobrador');
  });

  it('open=true excluye los casos terminales', async () => {
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({ open: 'true' } as never);
    assert.deepEqual(calls.listWhere!.status, { notIn: ['CLOSED', 'WRITTEN_OFF'] });
  });

  it('sin sort ordena como siempre: prioridad, después el más viejo', async () => {
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({} as never);
    assert.deepEqual(calls.listOrderBy!.slice(0, 2), [{ priority: 'desc' }, { createdAt: 'asc' }]);
  });

  it('ordena por mora y por saldo a través de la relación con el crédito', async () => {
    // Los dos viven en `credit`, no en el caso: si se ordenara por una columna del caso, el orden
    // saldría de un dato que no es el que la pantalla muestra.
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({ sort: 'daysPastDue' } as never);
    assert.deepEqual(calls.listOrderBy![0], { credit: { daysPastDue: 'desc' } });

    await service.list({ sort: 'balance', dir: 'asc' } as never);
    assert.deepEqual(calls.listOrderBy![0], { credit: { outstandingBalance: 'asc' } });
  });

  it('una clave de orden desconocida cae al default y NO revienta', async () => {
    // Viaja en la URL: una vieja que alguien guardó no tiene por qué dejar la pantalla en error.
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({ sort: 'inventado', dir: 'raro' } as never);
    assert.deepEqual(calls.listOrderBy![0], { priority: 'desc' });
  });

  it('🔴 una clave heredada de Object.prototype tampoco cuela', async () => {
    // `CASE_ORDER['hasOwnProperty']` existe por herencia: con un lookup simple el `??` no dispara
    // y el orderBy termina con una función adentro → Prisma lo rechaza y el listado da 500.
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    for (const sort of ['hasOwnProperty', 'toString', 'valueOf', 'constructor', '__proto__']) {
      await service.list({ sort } as never);
      assert.deepEqual(calls.listOrderBy![0], { priority: 'desc' }, `sort=${sort} se coló`);
    }
  });

  it('«sólo vencidos» NO pisa el estado pedido a mano', async () => {
    // Son dos controles independientes en la pantalla, así que la combinación está a un clic: el
    // filtro de estado se perdía sin decirlo y la tabla mostraba vencidos de cualquier estado.
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({ status: 'PROMISE_TO_PAY', overdue: 'true' } as never);
    assert.equal(calls.listWhere!.status, 'PROMISE_TO_PAY');
    assert.ok(calls.listWhere!.slaDueAt, 'se perdió el filtro de vencidos');
  });

  it('sin estado pedido, vencidos y abiertos siguen excluyendo los terminales', async () => {
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({ overdue: 'true' } as never);
    assert.deepEqual(calls.listWhere!.status, { notIn: ['CLOSED', 'WRITTEN_OFF'] });
  });

  it('🔴 el orden SIEMPRE termina en id, con cualquier sort', async () => {
    // Sin desempate único, LIMIT/OFFSET repite y saltea filas entre páginas — y ordenando por
    // prioridad los empates son la regla, no la excepción.
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    for (const sort of [undefined, 'priority', 'daysPastDue', 'balance', 'slaDueAt', 'createdAt']) {
      await service.list({ sort } as never);
      assert.deepEqual(calls.listOrderBy!.at(-1), { id: 'asc' }, `sort=${sort} quedó sin desempate`);
    }
  });

  it('ordenando por antigüedad no se pide createdAt dos veces', async () => {
    const { service, calls } = makeService({ permissions: ['case:assign'] });
    await service.list({ sort: 'createdAt', dir: 'asc' } as never);
    assert.deepEqual(calls.listOrderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('enriquece nombre de deudor + monto + mora desde client/credit', async () => {
    const row = {
      id: 'c1', creditId: 'cr1', clientId: 'cl1', status: 'ACTIVE', priority: 'HIGH',
      createdAt: new Date(), updatedAt: new Date(),
      client: { firstName: 'Ana', lastName: 'Ruiz', businessName: null },
      credit: { outstandingBalance: 5000, currency: 'BOB', daysPastDue: 12 },
    };
    const { service } = makeService({ permissions: ['case:assign'], listRows: [row] });
    const res = await service.list({} as never);
    assert.equal(res.data![0]!.clientName, 'Ana Ruiz');
    assert.equal(res.data![0]!.amount, 5000);
    assert.equal(res.data![0]!.currency, 'BOB');
    assert.equal(res.data![0]!.daysPastDue, 12);
    // Sin view=portfolio no se enriquece: nada de zona/documento/promesa (Home no cambia).
    assert.equal(res.data![0]!.zone, undefined);
    assert.equal(res.data![0]!.documentMasked, undefined);
    assert.equal(res.data![0]!.hasActivePromise, undefined);
  });

  it('view=portfolio agrega zona + documento ENMASCARADO + promesa vigente (§5.3)', async () => {
    const rows = [
      { id: 'c1', creditId: 'cr1', clientId: 'cl1', status: 'ACTIVE', priority: 'HIGH', createdAt: new Date(), updatedAt: new Date(), client: { firstName: 'Ana', lastName: 'Ruiz', businessName: null }, credit: null },
      { id: 'c2', creditId: 'cr2', clientId: 'cl2', status: 'ACTIVE', priority: 'LOW', createdAt: new Date(), updatedAt: new Date(), client: { firstName: 'Beto', lastName: 'Diaz', businessName: null }, credit: null },
    ];
    const { service } = makeService({
      permissions: ['case:assign'],
      listRows: rows,
      portfolioClients: [
        { id: 'cl1', nationalId: '12345678', locations: [{ zone: 'Zona Sur' }] },
        { id: 'cl2', nationalId: '87654321', locations: [] },
      ],
      portfolioPromises: [{ clientId: 'cl1' }], // solo cl1 tiene promesa vigente
    });
    const res = await service.list({ view: 'portfolio' } as never);
    const [a, b] = res.data!;
    assert.equal(a!.zone, 'Zona Sur');
    assert.ok(a!.documentMasked && a!.documentMasked !== '12345678'); // enmascarado, no en claro
    assert.ok(!a!.documentMasked!.includes('5678')); // los últimos dígitos no se filtran
    assert.equal(a!.hasActivePromise, true);
    assert.equal(b!.zone, undefined); // sin ubicación
    assert.equal(b!.hasActivePromise, false);
  });

  it('view=portfolio devuelve TODAS las ubicaciones dibujables, incluidas las del garante', async () => {
    const rows = [
      { id: 'c1', creditId: 'cr1', clientId: 'cl1', status: 'ACTIVE', priority: 'HIGH', createdAt: new Date(), updatedAt: new Date(), client: { firstName: 'Ana', lastName: 'Ruiz', businessName: null }, credit: null },
    ];
    const { service } = makeService({
      permissions: ['case:assign'],
      listRows: rows,
      portfolioClients: [
        {
          id: 'cl1',
          nationalId: '12345678',
          locations: [
            { id: 'l1', locationType: 'HOME', zone: 'Sur', address: 'Villa Fátima', latitude: -17.8, longitude: -63.2, relationId: null, relation: null },
            { id: 'l2', locationType: 'WORK', zone: 'Mercado', address: 'Puesto 12', latitude: -17.7, longitude: -63.1, relationId: null, relation: null },
            { id: 'l3', locationType: 'GUARANTOR', address: 'Calle 5', latitude: -17.6, longitude: -63.0, relationId: 'g1', relation: { relatedName: 'Luis Vargas', relationshipType: 'GUARANTOR' } },
            // Sin coordenadas: existe, pero el mapa no la puede pintar.
            { id: 'l4', locationType: 'OTHER', address: 'Sin punto', latitude: null, longitude: null, relationId: null, relation: null },
          ],
        },
      ],
    });
    const res = await service.list({ view: 'portfolio' } as never);
    const locs = res.data![0]!.locations!;
    assert.deepEqual(locs.map((l) => l.id), ['l1', 'l2', 'l3']);
    assert.equal(locs[2]!.ownerName, 'Luis Vargas'); // la del garante dice de quién es
    assert.equal(res.data![0]!.zone, 'Sur'); // la zona de la tarjeta sigue siendo la del cliente
  });

  it('view=portfolio agrega el punto del mapa: la casa gana sobre el negocio (S2)', async () => {
    const rows = [
      { id: 'c1', creditId: 'cr1', clientId: 'cl1', status: 'ACTIVE', priority: 'HIGH', createdAt: new Date(), updatedAt: new Date(), client: { firstName: 'Ana', lastName: 'Ruiz', businessName: null }, credit: null },
      { id: 'c2', creditId: 'cr2', clientId: 'cl2', status: 'ACTIVE', priority: 'LOW', createdAt: new Date(), updatedAt: new Date(), client: { firstName: 'Beto', lastName: 'Diaz', businessName: null }, credit: null },
    ];
    const { service, calls } = makeService({
      permissions: ['case:assign'],
      listRows: rows,
      portfolioClients: [
        {
          id: 'cl1',
          nationalId: '12345678',
          // El negocio está cargado primero: igual manda la casa para la zona de la tarjeta.
          locations: [
            { id: 'l1', locationType: 'WORK', zone: 'Mercado', latitude: -17.1, longitude: -63.1, relationId: null, relation: null },
            { id: 'l2', locationType: 'HOME', zone: 'Zona Sur', latitude: -17.8, longitude: -63.2, relationId: null, relation: null },
          ],
        },
        { id: 'cl2', nationalId: '87654321', locations: [] },
      ],
    });
    const res = await service.list({ view: 'portfolio' } as never);
    const [a, b] = res.data!;
    assert.equal(a!.zone, 'Zona Sur');
    assert.equal(a!.locations!.length, 2);
    // Sin ubicación cargada el cliente existe igual: no se puede pintar, no desaparece.
    assert.deepEqual(b!.locations, []);
    // El domicilio es PII: se registra el revelado, una vez por consulta.
    assert.equal(calls.audit.filter((a2) => a2.action === 'PII_REVEAL').length, 1);
  });
});

describe('CasesService.addActivity (gestión + promesa §5.4)', () => {
  const CASE = { id: 'case1', status: 'ACTIVE', clientId: 'cl1', creditId: 'cr1' };

  it('gestión simple: crea el CaseActivity y NO toca la agenda', async () => {
    const { service, calls } = makeService({ caseRow: CASE as never });
    await service.addActivity('case1', { type: 'CALL', result: 'NO_CONTACT', notes: 'no atendió' } as never);
    assert.equal(calls.activity[0]!.type, 'CALL');
    assert.equal(calls.activity[0]!.result, 'NO_CONTACT');
    assert.equal(calls.agenda.length, 0);
  });

  it('promesa: crea el CaseActivity Y un agenda_item PROMISE_TO_PAY con la fecha/monto (§5.4)', async () => {
    const { service, calls } = makeService({ caseRow: CASE as never });
    await service.addActivity('case1', {
      type: 'NOTE',
      result: 'PROMISE_TO_PAY',
      promise: { amount: 300, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' },
    } as never);
    assert.equal(calls.activity.length, 1); // sigue quedando en el historial
    const ag = calls.agenda[0]!;
    assert.equal(ag.type, 'PROMISE_TO_PAY');
    assert.equal(ag.status, 'SCHEDULED');
    assert.equal(ag.clientId, 'cl1'); // derivado del caso, no del body
    assert.equal(ag.creditId, 'cr1');
    assert.equal(ag.assigneeId, 'u1');
    assert.equal((ag.scheduledDate as Date).toISOString().slice(0, 10), '2026-08-01');
    assert.deepEqual(ag.details, { amount: 300, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' });
    assert.deepEqual(calls.audit.map((a) => `${a.action} ${a.entity}`), ['CREATE agenda_item']);
  });

  it('404 si el caso no existe / es de otro tenant', async () => {
    const { service } = makeService({ caseRow: null });
    await rejectsWithCode(service.addActivity('case1', { type: 'NOTE' } as never), 'RESOURCE_NOT_FOUND');
  });
});

describe('CasesService.generate', () => {
  it('genera casos desde mora, idempotente (omite créditos con caso abierto)', async () => {
    const credits = [
      { id: 'c1', clientId: 'cl1', branchId: null, outstandingBalance: 1000, daysPastDue: 10, client: { riskSegment: 'LOW' } },
      { id: 'c2', clientId: 'cl2', branchId: null, outstandingBalance: 2000, daysPastDue: 20, client: { riskSegment: 'MEDIUM' } },
    ];
    const { service, calls } = makeService({ creditsInMora: credits, openCreditIds: ['c1'] });
    const r = await service.generate({});
    assert.equal(r.created, 1); // c1 ya tiene caso → omitido
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0]!.creditId, 'c2');
  });
});

/**
 * Subir o bajar la prioridad a mano.
 *
 * 🔴 **Existe porque el cálculo no puede saber todo.** Sale del saldo, la mora y el riesgo: buena
 * regla en general, equivocada justo cuando más importa — un deudor con dos días de atraso cae en
 * baja aunque quien lo conoce sepa que es moroso frecuente y hay que ir hoy.
 */
describe('CasesService.setPriority', () => {
  const abierta = { id: 'k1', priority: 'LOW', priorityPinnedAt: null };

  it('fijarla guarda la prioridad Y la marca: sin la marca, el job la pisa a la noche', async () => {
    const { service, calls } = makeService({ caseRow: abierta as never });
    await service.setPriority('k1', { priority: 'CRITICAL' } as never);
    assert.equal(calls.update[0]!.priority, 'CRITICAL');
    assert.ok(calls.update[0]!.priorityPinnedAt, 'queda fijada');
    assert.deepEqual(calls.audit.map((a) => a.action), ['PRIORITY_PIN']);
  });

  /**
   * Soltar **no fija «la automática de hoy»**: borra la marca y deja el valor que había. Calcularla
   * acá la dejaría clavada en el número de este instante, que es lo que se quería dejar de hacer.
   */
  it('soltarla borra la marca y deja que el trabajo diario la recalcule', async () => {
    const { service, calls } = makeService({ caseRow: { ...abierta, priority: 'CRITICAL' } as never });
    await service.setPriority('k1', { auto: true } as never);
    assert.equal(calls.update[0]!.priorityPinnedAt, null);
    assert.equal(calls.update[0]!.priority, undefined, 'no toca el valor: lo recalcula el job');
    assert.deepEqual(calls.audit.map((a) => a.action), ['PRIORITY_AUTO']);
  });

  it('404 si la cobranza no existe o es de otro tenant', async () => {
    const { service } = makeService({ caseRow: null });
    await rejectsWithCode(service.setPriority('k1', { priority: 'HIGH' } as never), 'RESOURCE_NOT_FOUND');
  });
});
