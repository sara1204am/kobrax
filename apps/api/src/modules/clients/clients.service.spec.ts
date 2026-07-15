import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClientsService } from './clients.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

/** Fakes en memoria de las dependencias del servicio. */
function makeService(opts: { dup?: unknown; client?: unknown; activeCredits?: number; failContact?: boolean } = {}) {
  const calls = {
    create: [] as Record<string, unknown>[],
    update: [] as { where: { id: string }; data: Record<string, unknown> }[],
    contact: [] as Record<string, unknown>[],
    location: [] as Record<string, unknown>[],
    relation: [] as Record<string, unknown>[],
    audit: [] as { entity: string; action: string }[],
  };
  const tx = {
    client: {
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

  it('alta atómica (§5.1): crea teléfono cifrado + múltiples ubicaciones + relación, y audita cada sub-recurso', async () => {
    const { service, calls } = makeService();
    await service.create({
      ...(PERSON as object),
      contacts: [{ contactType: 'WHATSAPP', value: '70000000', isPrimary: true }],
      locations: [
        { address: 'Calle Falsa 123', zone: 'Sur', latitude: -17.7, photoUrls: ['u1'] },
        { locationType: 'WORK', address: 'Oficina 5', zone: 'Centro' },
      ],
      relations: [{ relatedName: 'Carlos', relationshipType: 'GUARANTOR', phone: '71234567', isContactable: true }],
    } as never);
    assert.equal(calls.contact[0]!.value, 'enc(70000000)'); // teléfono cifrado en reposo
    assert.equal(calls.contact[0]!.contactType, 'WHATSAPP');
    assert.equal(calls.location.length, 2); // ambas ubicaciones creadas en la misma transacción
    assert.equal(calls.location[0]!.address, 'enc(Calle Falsa 123)'); // dirección cifrada
    assert.deepEqual(calls.location[0]!.photoUrls, ['u1']);
    assert.equal(calls.relation[0]!.relatedName, 'Carlos');
    assert.equal(calls.relation[0]!.phone, '71234567'); // el teléfono de la relación NO se cifra
    assert.deepEqual(
      calls.audit.map((a) => `${a.action} ${a.entity}`),
      ['CREATE client', 'CREATE client_contact', 'CREATE client_location', 'CREATE client_location', 'CREATE client_relation'],
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
