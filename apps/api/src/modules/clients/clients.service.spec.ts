import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClientsService } from './clients.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

/** Fakes en memoria de las dependencias del servicio. */
function makeService(
  opts: {
    dup?: unknown;
    client?: unknown;
    activeCredits?: number;
    failContact?: boolean;
    /** Filas crudas que devuelve la consulta de cartera (`view=portfolio`). */
    rows?: { id: string; total_debt: number; max_days_past_due: number; credit_count: number }[];
    /** Lo que Prisma trae para hidratar esas filas — a propósito en otro orden. */
    clients?: Record<string, unknown>[];
  } = {},
) {
  const calls = {
    create: [] as Record<string, unknown>[],
    update: [] as { where: { id: string }; data: Record<string, unknown> }[],
    contact: [] as Record<string, unknown>[],
    location: [] as Record<string, unknown>[],
    relation: [] as Record<string, unknown>[],
    audit: [] as { entity: string; action: string }[],
    sql: [] as { sql: string; values: unknown[] }[],
  };
  const tx = {
    // La cartera no pasa por Prisma: arma su SQL y lo manda entero (ver `listPortfolio`).
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      calls.sql.push(q);
      return q.sql.includes('COUNT(*)') ? [{ total: opts.rows?.length ?? 0 }] : (opts.rows ?? []);
    },
    client: {
      findMany: async () => opts.clients ?? [],
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const w = args.where ?? {};
        if (w.nationalIdHash !== undefined) return opts.dup ?? null;
        if (w.id !== undefined) return opts.client ?? null;
        return null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.create.push(args.data);
        return { id: 'c1', createdAt: new Date(), updatedAt: new Date(), ...args.data };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.update.push(args);
        return { id: args.where.id, createdAt: new Date(), updatedAt: new Date(), ...(opts.client as object), ...args.data };
      },
      count: async () => 0,
    },
    clientContact: {
      create: async (args: { data: Record<string, unknown> }) => {
        if (opts.failContact) throw new Error('boom'); // simula fallo del sub-recurso
        calls.contact.push(args.data);
        return { id: 'ct1', ...args.data };
      },
    },
    clientLocation: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.location.push(args.data);
        return { id: 'lo1', ...args.data };
      },
    },
    clientRelation: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.relation.push(args.data);
        return { id: 're1', ...args.data };
      },
    },
    credit: { count: async () => opts.activeCredits ?? 0 },
  };
  const prisma = { withTenant: async (_acc: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A' };
  const crypto = {
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (v: string) => {
      const m = /^enc\((.*)\)$/.exec(v);
      if (!m) throw new Error('not ciphertext');
      return m[1]!;
    },
  };
  const blind = { hash: (v?: string | null) => (v ? `h(${v.trim().toUpperCase()})` : null) };
  const audit = { record: async (e: { entity: string; action: string }) => void calls.audit.push(e) };

  const service = new ClientsService(
    prisma as never,
    tenant as never,
    crypto as never,
    blind as never,
    audit as never,
  );
  return { service, calls };
}

const PERSON = { clientType: 'PERSON', firstName: 'Juan', lastName: 'Pérez', nationalId: 'DEMO-0001' } as never;

/**
 * Alta idempotente: el móvil propone el id para que un alta encolada sin señal, si se reintenta,
 * no termine creando dos veces al mismo deudor.
 */
describe('ClientsService.create — idempotencia del alta offline', () => {
  it('con un id ya existente devuelve ese cliente y NO crea otro', async () => {
    const { service, calls } = makeService({ client: { id: 'ya-existe', clientType: 'PERSON', firstName: 'Ana' } });
    const res = await service.create({ ...(PERSON as object), id: 'ya-existe' } as never);
    assert.equal(res.id, 'ya-existe');
    assert.equal(calls.create.length, 0, 'no debe insertar de nuevo');
  });

  // Auditar dos veces la misma alta ensucia el rastro con un evento que nunca ocurrió.
  it('el reintento no vuelve a auditar', async () => {
    const { service, calls } = makeService({ client: { id: 'ya-existe', clientType: 'PERSON' } });
    await service.create({ ...(PERSON as object), id: 'ya-existe' } as never);
    assert.deepEqual(calls.audit, []);
  });

  it('con un id nuevo crea normalmente y lo usa', async () => {
    const { service, calls } = makeService();
    await service.create({ ...(PERSON as object), id: 'id-propuesto' } as never);
    assert.equal(calls.create[0]!.id, 'id-propuesto');
  });

  // El id repetido es "la misma alta"; el documento repetido es "otro deudor con ese CI", que el
  // cobrador tiene que ver como error. Confundirlos le haría creer que guardó algo que rebotó.
  it('sin id, un documento duplicado sigue siendo error', async () => {
    const { service } = makeService({ dup: { id: 'otro' } });
    await assert.rejects(() => service.create(PERSON));
  });
});

describe('ClientsService.create', () => {
  it('cifra el documento, calcula el hash y tokeniza la respuesta', async () => {
    const { service, calls } = makeService();
    const res = await service.create(PERSON);

    const stored = calls.create[0]!;
    assert.equal(stored.nationalId, 'enc(DEMO-0001)'); // ciphertext en reposo
    assert.equal(stored.nationalIdHash, 'h(DEMO-0001)'); // blind index
    assert.equal(res.nationalId, 'DEMO-***'); // tokenizado (no en claro) en la respuesta
    assert.deepEqual(
      calls.audit.map((a) => `${a.action} ${a.entity}`),
      ['CREATE client'],
    );
  });

  it('rechaza documento duplicado en el tenant (CLIENT_DUP)', async () => {
    const { service } = makeService({ dup: { id: 'other' } });
    await rejectsWithCode(service.create(PERSON), 'CLIENT_DUP');
  });

  it('exige nombre y apellido para PERSON (CLIENT_INVALID)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.create({ clientType: 'PERSON' } as never), 'CLIENT_INVALID');
  });

  it('alta atómica (§5.1): cliente con su teléfono/ubicación + un contacto con SUS propios teléfono/ubicación', async () => {
    const { service, calls } = makeService();
    await service.create({
      ...(PERSON as object),
      contacts: [{ contactType: 'WHATSAPP', value: '70000000', isPrimary: true }],
      locations: [{ address: 'Calle Falsa 123', zone: 'Sur', latitude: -17.7, photoUrls: ['u1'] }],
      relations: [
        {
          relatedName: 'Carlos',
          relationshipType: 'GUARANTOR',
          isContactable: true,
          contacts: [{ contactType: 'PHONE', value: '71234567', isPrimary: true }],
          locations: [{ address: 'Casa de Carlos', zone: 'Norte' }],
        },
      ],
    } as never);
    // Del cliente: teléfono/ubicación con relationId null.
    assert.equal(calls.contact[0]!.value, 'enc(70000000)'); // cifrado en reposo
    assert.equal(calls.contact[0]!.relationId, null);
    assert.equal(calls.location[0]!.address, 'enc(Calle Falsa 123)');
    assert.equal(calls.location[0]!.relationId, null);
    // La relación ya NO tiene phone inline.
    assert.equal(calls.relation[0]!.relatedName, 'Carlos');
    assert.equal(calls.relation[0]!.phone, undefined);
    // Del contacto/relación: mismo cifrado, con relationId apuntando a la relación (id 're1' del mock).
    assert.equal(calls.contact[1]!.value, 'enc(71234567)');
    assert.equal(calls.contact[1]!.relationId, 're1');
    assert.equal(calls.location[1]!.relationId, 're1');
    assert.deepEqual(
      calls.audit.map((a) => `${a.action} ${a.entity}`),
      ['CREATE client', 'CREATE client_contact', 'CREATE client_location', 'CREATE client_relation', 'CREATE client_contact', 'CREATE client_location'],
    );
  });

  it('si un sub-recurso falla, propaga el error y NO audita un alta a medias (rollback)', async () => {
    const { service, calls } = makeService({ failContact: true });
    await assert.rejects(
      service.create({ ...(PERSON as object), contacts: [{ contactType: 'PHONE', value: '7' }] } as never),
    );
    assert.equal(calls.audit.length, 0); // ni el cliente ni el sub-recurso quedan auditados
  });
});

describe('ClientsService.findOne', () => {
  it('404 genérico si no existe / es de otro tenant', async () => {
    const { service } = makeService({ client: null });
    await rejectsWithCode(service.findOne('c1', false), 'RESOURCE_NOT_FOUND');
  });

  it('tokeniza por defecto y revela con auditoría cuando reveal=true', async () => {
    const client = {
      id: 'c1',
      clientType: 'PERSON',
      firstName: 'Juan',
      nationalId: 'enc(DEMO-0001)',
      taxId: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      contacts: [],
      locations: [],
      relations: [],
      attachments: [],
    };
    const masked = makeService({ client });
    const r1 = await masked.service.findOne('c1', false);
    assert.equal(r1.nationalId, 'DEMO-***');
    assert.equal(masked.calls.audit.length, 0); // sin reveal no audita acceso

    const revealed = makeService({ client });
    const r2 = await revealed.service.findOne('c1', true);
    assert.equal(r2.nationalId, 'DEMO-0001'); // en claro
    assert.deepEqual(revealed.calls.audit.map((a) => a.action), ['PII_REVEAL']);
  });
});

describe('ClientsService.remove', () => {
  it('bloquea la baja si el cliente tiene créditos activos', async () => {
    const { service } = makeService({ client: { id: 'c1' }, activeCredits: 2 });
    await rejectsWithCode(service.remove('c1'), 'CLIENT_HAS_CREDITS');
  });

  it('baja lógica + audit DELETE cuando no hay créditos activos', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' }, activeCredits: 0 });
    await service.remove('c1');
    assert.equal(calls.update[0]!.data.status, 'INACTIVE');
    assert.ok(calls.update[0]!.data.deletedAt instanceof Date);
    assert.deepEqual(calls.audit.map((a) => `${a.action} ${a.entity}`), ['DELETE client']);
  });
});

// ── Cartera del panel web (F9 · W3) ──────────────────────────────────────────
const fila = (over: Partial<{ id: string; total_debt: number; max_days_past_due: number; credit_count: number }> = {}) => ({
  id: 'c1',
  total_debt: 1000,
  max_days_past_due: 12,
  credit_count: 2,
  ...over,
});

const cliente = (id: string) => ({
  id,
  clientType: 'PERSON',
  firstName: 'Ana',
  lastName: 'Ruiz',
  nationalId: null,
  taxId: null,
  status: 'ACTIVE',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

/** El SQL de la página (el primero); el segundo es el COUNT. */
const pageSql = (calls: { sql: { sql: string; values: unknown[] }[] }) => calls.sql[0]!;

describe('ClientsService.list — cartera (view=portfolio)', () => {
  /**
   * El bug que este spec existe para evitar: con `cr.deleted_at IS NULL` en el WHERE, el LEFT JOIN
   * se comporta como INNER y **los clientes sin créditos desaparecen** — o sea, el que acabás de dar
   * de alta no aparece en la cartera. El síntoma no se parece en nada a su causa.
   */
  it('el filtro de créditos va en el ON del LEFT JOIN, nunca en el WHERE', async () => {
    const { service, calls } = makeService({ rows: [fila()], clients: [cliente('c1')] });
    await service.list({ view: 'portfolio' } as never);

    const sql = pageSql(calls).sql;
    const [join, resto] = sql.split(/\bWHERE\b/);
    assert.match(join!, /LEFT JOIN credits cr ON cr\.client_id = c\.id AND cr\.deleted_at IS NULL/);
    const filtro = resto!.split(/\bGROUP BY\b/)[0]!;
    assert.doesNotMatch(filtro, /cr\.deleted_at/, 'el LEFT JOIN se volvería INNER');
  });

  it('abre por mora desc, desempata por deuda, y cierra con el id', async () => {
    const { service, calls } = makeService({ rows: [fila()], clients: [cliente('c1')] });
    await service.list({ view: 'portfolio' } as never);
    // Sin `c.id` al final, dos clientes con la misma mora se intercambian entre páginas y
    // `LIMIT/OFFSET` repite o saltea filas.
    assert.match(pageSql(calls).sql, /ORDER BY max_days_past_due DESC, total_debt DESC, c\.id/);
  });

  it('ordena por nombre con la misma regla que el nombre visible (empresa antes que persona)', async () => {
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ view: 'portfolio', sort: 'name', dir: 'asc' } as never);
    assert.match(pageSql(calls).sql, /ORDER BY COALESCE\(c\.business_name, c\.last_name, c\.first_name\) ASC, c\.id/);
  });

  it('filtra por el estado del cliente usando su columna real (`client_status`)', async () => {
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ view: 'portfolio', status: 'ACTIVE' } as never);
    assert.match(pageSql(calls).sql, /c\.client_status = \?::"ClientStatus"/);
    assert.ok(pageSql(calls).values.includes('ACTIVE'));
  });

  it('la búsqueda viaja parametrizada: el documento exacto por hash, el nombre como ILIKE', async () => {
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ view: 'portfolio', q: "ana' OR 1=1--" } as never);

    const { sql, values } = pageSql(calls);
    assert.doesNotMatch(sql, /OR 1=1/, 'el texto de búsqueda nunca se interpola');
    assert.ok(values.includes("%ana' OR 1=1--%"));
    assert.ok(values.includes("h(ANA' OR 1=1--)")); // blind index del documento
  });

  it('un cliente sin créditos entra igual, con deuda y mora en cero', async () => {
    const { service } = makeService({
      rows: [fila({ id: 'nuevo', total_debt: 0, max_days_past_due: 0, credit_count: 0 })],
      clients: [cliente('nuevo')],
    });
    const res = await service.list({ view: 'portfolio' } as never);
    assert.equal(res.data!.length, 1);
    assert.deepEqual(
      { d: res.data![0]!.totalDebt, m: res.data![0]!.maxDaysPastDue, n: res.data![0]!.creditCount },
      { d: 0, m: 0, n: 0 },
    );
  });

  // Prisma no garantiza el orden del `IN`, y el orden es justamente lo que se le pidió a la consulta.
  it('respeta el orden de la consulta aunque Prisma devuelva las filas al revés', async () => {
    const { service } = makeService({
      rows: [fila({ id: 'a', max_days_past_due: 30 }), fila({ id: 'b', max_days_past_due: 5 })],
      clients: [cliente('b'), cliente('a')],
    });
    const res = await service.list({ view: 'portfolio' } as never);
    assert.deepEqual(res.data!.map((c) => c.id), ['a', 'b']);
  });

  it('la deuda vuelve redondeada a dos decimales', async () => {
    const { service } = makeService({ rows: [fila({ total_debt: 1234.5600000000001 })], clients: [cliente('c1')] });
    const res = await service.list({ view: 'portfolio' } as never);
    assert.equal(res.data![0]!.totalDebt, 1234.56);
  });

  it('sin `view` sigue saliendo la lista de siempre, por Prisma y sin agregados', async () => {
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ q: 'ana' } as never);
    assert.deepEqual(calls.sql, [], 'la lista de siempre no toca el SQL crudo');
  });
});
