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
    /** Los permisos de quien mira. Sin esto, puede todo. */
    permissions?: string[];
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
  // `can` por defecto dice que sí a todo; los tests de la bitácora le pasan la lista que quieren.
  const tenant = { accountId: 'acc-A', can: (p: string) => opts.permissions?.includes(p) ?? true };
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

/**
 * 🔴 **El PATCH manda sólo lo que cambió**, así que la identidad hay que validarla contra lo que
 * QUEDA. `clientType` ni siquiera estaba en el DTO: el desplegable Persona/Empresa del formulario de
 * edición hacía rebotar el guardado entero con «property clientType should not exist».
 */
describe('ClientsService.update — la identidad se valida sobre el resultado', () => {
  const GUARDADO = {
    id: 'c1',
    clientType: 'PERSON',
    firstName: 'Juan',
    lastName: 'Pérez',
    businessName: null,
    nationalId: 'enc(DEMO-0001)',
    taxId: null,
    status: 'ACTIVE',
    metadata: {},
  };

  it('pasar a empresa exige la razón social, aunque no venga en este PATCH', async () => {
    const { service } = makeService({ client: GUARDADO });
    await rejectsWithCode(service.update('c1', { clientType: 'COMPANY' } as never), 'CLIENT_INVALID');
  });

  it('pasar a empresa con razón social sí se guarda', async () => {
    const { service, calls } = makeService({ client: GUARDADO });
    await service.update('c1', { clientType: 'COMPANY', businessName: 'Ferretería Sur' } as never);
    assert.equal(calls.update[0]!.data.clientType, 'COMPANY');
  });

  it('vaciar el apellido de una persona no pasa: el alta nunca lo habría aceptado', async () => {
    const { service } = makeService({ client: GUARDADO });
    await rejectsWithCode(service.update('c1', { lastName: '' } as never), 'CLIENT_INVALID');
  });

  it('corregir el documento re-cifra y re-calcula el hash de búsqueda', async () => {
    const { service, calls } = makeService({ client: GUARDADO });
    await service.update('c1', { nationalId: 'DEMO-0002' } as never);
    assert.equal(calls.update[0]!.data.nationalId, 'enc(DEMO-0002)');
    assert.equal(calls.update[0]!.data.nationalIdHash, 'h(DEMO-0002)');
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
   * 🔴 **La cartera LEE los agregados, no los calcula.**
   *
   * `total_debt`, `max_days_past_due` y `credit_count` son columnas de `clients` que mantiene un
   * trigger. Si alguien vuelve a meter acá un `JOIN` con `GROUP BY`, vuelven los dos problemas que
   * eso traía: 768 ms por página con 100.000 personas, y el riesgo de que el filtro de créditos
   * caiga en el `WHERE` —donde el `LEFT JOIN` se comporta como `INNER` y **los clientes sin créditos
   * desaparecen de la cartera**, o sea que el que acabás de dar de alta no aparece—.
   */
  it('lee los agregados de las columnas, sin JOIN ni GROUP BY', async () => {
    const { service, calls } = makeService({ rows: [fila()], clients: [cliente('c1')] });
    await service.list({ view: 'portfolio' } as never);

    const sql = pageSql(calls).sql;
    assert.match(sql, /c\.total_debt/);
    assert.doesNotMatch(sql, /\bJOIN\b/);
    assert.doesNotMatch(sql, /\bGROUP BY\b/);
    assert.doesNotMatch(sql, /\bHAVING\b/);
  });

  it('abre por mora desc, desempata por deuda, y cierra con el id', async () => {
    const { service, calls } = makeService({ rows: [fila()], clients: [cliente('c1')] });
    await service.list({ view: 'portfolio' } as never);
    // Sin `c.id` al final, dos clientes con la misma mora se intercambian entre páginas y
    // `LIMIT/OFFSET` repite o saltea filas.
    assert.match(pageSql(calls).sql, /ORDER BY c\.max_days_past_due DESC, c\.total_debt DESC, c\.id/);
  });

  it('los filtros de deuda y mora son sobre la PERSONA, no sobre un crédito suyo', async () => {
    // «Mora ≥ 90» quiere decir que la peor mora de esta persona pasa de 90 — el que tiene un crédito
    // de 400 días y otro al día entra; el que tiene tres de 30, no. Sobre la columna agregada eso
    // sale solo; sobre `credits` habría que agrupar y filtrar después.
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ view: 'portfolio', dpdMin: 90, debtMin: 10000, creditsMin: 2 } as never);

    const { sql, values } = pageSql(calls);
    assert.match(sql, /c\.max_days_past_due >= \?/);
    assert.match(sql, /c\.total_debt >= \?/);
    assert.match(sql, /c\.credit_count >= \?/);
    assert.ok([90, 10000, 2].every((v) => values.includes(v)));
  });

  it('cobrador y sucursal filtran con EXISTS, para no multiplicar la fila', async () => {
    // Con un JOIN, el cliente con dos casos —o dos créditos de la misma sucursal— saldría dos veces.
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ view: 'portfolio', collectorId: 'u1', branchId: 'b1' } as never);

    const sql = pageSql(calls).sql;
    assert.match(sql, /EXISTS \(\s*SELECT 1 FROM collection_cases k/);
    assert.match(sql, /EXISTS \(\s*SELECT 1 FROM credits k/);
    assert.doesNotMatch(sql, /\bJOIN\b/);
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
    await service.list({ view: 'portfolio', q: "ana'--" } as never);

    const { sql, values } = pageSql(calls);
    assert.doesNotMatch(sql, /ana'/, 'el texto de búsqueda nunca se interpola');
    assert.ok(values.includes("%ana'--%"));
    assert.ok(values.includes("h(ANA'--)")); // blind index del documento
  });

  /**
   * 🔴 **«Teresa Mama» tiene que encontrar a «Teresa Mamani Padilla».** Buscando la frase entera no
   * la encuentra nunca: el espacio cae justo entre el nombre y el apellido, así que ningún campo
   * contiene esa cadena. Cada palabra va por su cuenta y **todas** tienen que estar.
   */
  it('busca palabra por palabra, y las exige todas', async () => {
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ view: 'portfolio', q: 'Teresa Mama' } as never);

    const { sql, values } = pageSql(calls);
    assert.ok(values.includes('%Teresa%'), 'el nombre va suelto');
    assert.ok(values.includes('%Mama%'), 'el arranque del apellido también');
    // Unidas por AND: una palabra sola no alcanza para entrar.
    assert.match(sql, /ILIKE \?\) AND \(/);
  });

  it('cada palabra sigue viajando como parámetro, no pegada al SQL', async () => {
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ view: 'portfolio', q: "ana' OR 1=1--" } as never);
    const { sql, values } = pageSql(calls);
    assert.doesNotMatch(sql, /1=1/, 'ni partida en palabras se interpola');
    assert.ok(values.includes('%1=1--%'));
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

  it('la bitácora junta las tres fuentes y las ordena por fecha, no una detrás de otra', async () => {
    // Traer «las 20 últimas de cada fuente» y mezclarlas en memoria da una primera página que puede
    // estar bien de casualidad y una segunda que miente: falta lo que quedó afuera del corte de cada
    // una. Ordenar y paginar es trabajo de la base.
    const { service, calls } = makeService({ rows: [] });
    await service.timeline('c1', {});

    const sql = calls.sql[0]!.sql;
    assert.equal((sql.match(/UNION ALL/g) ?? []).length, 2, 'las tres fuentes en una sola consulta');
    assert.match(sql, /FROM payments p/);
    assert.match(sql, /FROM agenda_items a/);
    assert.match(sql, /FROM case_activities ac/);
    assert.match(sql, /ORDER BY t\.at DESC, t\.id/);
  });

  it('🔴 la fuente que no se puede ver no entra en la consulta', async () => {
    // La bitácora cruza tres dominios con tres permisos. Sin esta guarda, la ficha del cliente sería
    // la puerta de atrás para leer pagos sin `payment:read`.
    const { service, calls } = makeService({ rows: [], permissions: ['client:read', 'agenda:read'] });
    await service.timeline('c1', {});

    const sql = calls.sql[0]!.sql;
    assert.match(sql, /FROM agenda_items a/);
    assert.doesNotMatch(sql, /FROM payments p/);
    assert.doesNotMatch(sql, /FROM case_activities ac/);
    assert.doesNotMatch(sql, /UNION ALL/, 'con una sola fuente no hay nada que unir');
  });

  it('🔴 sin ninguno de los tres permisos no se consulta nada', async () => {
    // `UNION ALL` de cero partes no es SQL válido: sin la guarda, la ficha reventaría con un 500 en
    // vez de mostrar una bitácora vacía.
    const { service, calls } = makeService({ rows: [], permissions: ['client:read'] });
    const res = await service.timeline('c1', {});

    assert.deepEqual(calls.sql, []);
    assert.deepEqual(res.data, []);
    assert.equal(res.meta.total, 0);
  });

  it('sin `view` sigue saliendo la lista de siempre, por Prisma y sin agregados', async () => {
    const { service, calls } = makeService({ rows: [], clients: [] });
    await service.list({ q: 'ana' } as never);
    assert.deepEqual(calls.sql, [], 'la lista de siempre no toca el SQL crudo');
  });
});
