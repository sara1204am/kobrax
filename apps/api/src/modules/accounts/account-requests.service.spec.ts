import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountRequestsService } from './account-requests.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

type Row = Record<string, unknown>;

function request(over: Row = {}): Row {
  return {
    id: 'r1',
    accountId: 'acc-A',
    type: 'PLAN_CHANGE',
    status: 'PENDING',
    payload: { plan: 'BUSINESS' },
    requestedBy: 'u1',
    handledNote: null,
    createdAt: new Date('2026-10-21T12:00:00Z'),
    handledAt: null,
    ...over,
  };
}

function makeService(
  opts: { planCode?: string; pending?: boolean; createFails?: unknown; found?: Row | null; mailTo?: string | undefined; mailFails?: boolean; owner?: boolean } = {},
) {
  const calls = {
    created: undefined as Row | undefined,
    updated: undefined as Row | undefined,
    audit: [] as { entity: string; action: string }[],
    systemAudit: [] as Row[],
    mail: [] as { to: string; subject: string; text: string }[],
  };
  const tx = {
    account: { findFirst: async () => ({ businessName: 'Cobranzas Pérez', planCode: opts.planCode ?? 'PROFESSIONAL' }) },
    accountRequest: {
      findMany: async () => [request()],
      findFirst: async (args: { where: Row }) => {
        if ('accountId' in args.where) return opts.found === undefined ? request() : opts.found; // handle(): por id
        return opts.pending ? request() : null; // create(): ¿hay una pendiente del mismo tipo?
      },
      create: async (args: { data: Row }) => {
        if (opts.createFails) throw opts.createFails;
        calls.created = args.data;
        return request({ ...args.data, id: 'r-new' });
      },
      update: async (args: { data: Row }) => {
        calls.updated = args.data;
        return request({ ...args.data });
      },
    },
    userAccount: { findFirst: async () => (opts.owner === false ? null : { userId: 'owner-1' }) },
    auditLog: { create: async (args: { data: Row }) => void calls.systemAudit.push(args.data) },
  };
  const prisma = {
    withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    withSystemTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const audit = { record: async (e: { entity: string; action: string }) => void calls.audit.push(e) };
  const mail = {
    send: async (to: string, subject: string, text: string) => {
      if (opts.mailFails) throw new Error('smtp caído');
      calls.mail.push({ to, subject, text });
    },
  };
  const config = { mailFrom: 'mailTo' in opts ? opts.mailTo : 'ventas@kobrax.test', smtpUser: undefined };
  const service = new AccountRequestsService(prisma as never, { accountId: 'acc-A', userId: 'u1' } as never, audit as never, mail as never, config as never);
  return { service, calls };
}

describe('AccountRequestsService.create — cambio de plan', () => {
  it('registra el pedido con el plan, lo audita y le avisa a Kobrax', async () => {
    const { service, calls } = makeService();
    const r = await service.create({ type: 'PLAN_CHANGE', plan: 'BUSINESS', note: '  Somos 40 personas ' });
    assert.deepEqual(calls.created!.payload, { plan: 'BUSINESS', note: 'Somos 40 personas' });
    assert.equal(calls.created!.requestedBy, 'u1');
    assert.equal(calls.created!.accountId, 'acc-A');
    assert.deepEqual(calls.audit.map((a) => `${a.entity}:${a.action}`), ['account_request:CREATE']);
    assert.equal(r.status, 'PENDING');
    assert.equal(calls.mail.length, 1);
    assert.match(calls.mail[0]!.subject, /Cobranzas Pérez/);
    assert.match(calls.mail[0]!.text, /Professional a Business/);
    assert.match(calls.mail[0]!.text, /request:handle/);
  });

  it('🔴 pedir el plan que ya tiene es 400 y no escribe nada', async () => {
    const { service, calls } = makeService({ planCode: 'BUSINESS' });
    await rejectsWithCode(service.create({ type: 'PLAN_CHANGE', plan: 'BUSINESS' }), 'REQUEST_PLAN_INVALID');
    assert.equal(calls.created, undefined);
    assert.deepEqual(calls.mail, []);
  });

  it('🔴 si ya hay uno pendiente del mismo tipo es 409', async () => {
    const { service, calls } = makeService({ pending: true });
    await rejectsWithCode(service.create({ type: 'PLAN_CHANGE', plan: 'BUSINESS' }), 'REQUEST_ALREADY_PENDING');
    assert.equal(calls.created, undefined);
  });

  it('🔴 dos administradores a la vez: el único parcial de la base (P2002) también da 409, no un 500', async () => {
    const { service } = makeService({ createFails: Object.assign(new Error('unique'), { code: 'P2002' }) });
    await rejectsWithCode(service.create({ type: 'PLAN_CHANGE', plan: 'BUSINESS' }), 'REQUEST_ALREADY_PENDING');
  });

  it('un error de base que no es el único no se disfraza de 409', async () => {
    const { service } = makeService({ createFails: new Error('conexión perdida') });
    await assert.rejects(service.create({ type: 'PLAN_CHANGE', plan: 'BUSINESS' }), /conexión perdida/);
  });
});

describe('AccountRequestsService.create — baja', () => {
  it('🔴 exige escribir el nombre del negocio', async () => {
    const { service, calls } = makeService();
    await rejectsWithCode(service.create({ type: 'CLOSURE', confirmName: 'Otro nombre' }), 'REQUEST_CONFIRM_MISMATCH');
    await rejectsWithCode(service.create({ type: 'CLOSURE' }), 'REQUEST_CONFIRM_MISMATCH');
    assert.equal(calls.created, undefined);
  });

  it('el nombre vale sin importar mayúsculas ni espacios de los extremos', async () => {
    const { service, calls } = makeService();
    await service.create({ type: 'CLOSURE', confirmName: '  cobranzas PÉREZ ' });
    assert.equal(calls.created!.type, 'CLOSURE');
    assert.deepEqual(calls.created!.payload, {}, 'la baja no lleva plan ni guarda el nombre confirmado');
    assert.match(calls.mail[0]!.text, /darse de baja/);
  });
});

describe('AccountRequestsService — el aviso a Kobrax no puede tumbar el pedido', () => {
  it('si el correo falla, el pedido igual queda registrado', async () => {
    const { service, calls } = makeService({ mailFails: true });
    const r = await service.create({ type: 'PLAN_CHANGE', plan: 'BUSINESS' });
    assert.equal(r.id, 'r-new');
    assert.ok(calls.created);
  });

  it('sin casilla interna configurada no manda correo y tampoco falla', async () => {
    const { service, calls } = makeService({ mailTo: undefined });
    await service.create({ type: 'PLAN_CHANGE', plan: 'BUSINESS' });
    assert.deepEqual(calls.mail, []);
    assert.ok(calls.created);
  });
});

describe('AccountRequestsService.list', () => {
  it('devuelve plan y nota ya sacados del payload', async () => {
    const { service } = makeService();
    const [r] = await service.list();
    assert.equal(r!.plan, 'BUSINESS');
    assert.equal(r!.note, null);
    assert.equal(r!.createdAt, '2026-10-21T12:00:00.000Z');
  });
});

describe('AccountRequestsService.handle (consola de Kobrax)', () => {
  it('la marca como atendida con su nota y deja la auditoría a nombre del dueño, con via', async () => {
    const { service, calls } = makeService();
    const r = await service.handle({ accountId: 'acc-A', requestId: 'r1', status: 'HANDLED', note: ' Listo, ya es Business ' });
    assert.equal(calls.updated!.status, 'HANDLED');
    assert.equal(calls.updated!.handledNote, 'Listo, ya es Business');
    assert.ok(calls.updated!.handledAt instanceof Date);
    assert.equal(r.status, 'HANDLED');
    assert.equal(calls.systemAudit[0]!.userId, 'owner-1');
    assert.equal(calls.systemAudit[0]!.entity, 'account_request');
    assert.deepEqual(calls.systemAudit[0]!.after, { status: 'HANDLED', via: 'request:handle' });
  });

  it('🔴 una solicitud ya atendida, o que no existe, no se vuelve a tocar', async () => {
    const atendida = makeService({ found: request({ status: 'HANDLED' }) });
    await rejectsWithCode(atendida.service.handle({ accountId: 'acc-A', requestId: 'r1', status: 'REJECTED' }), 'REQUEST_NOT_FOUND');
    assert.equal(atendida.calls.updated, undefined);

    const ausente = makeService({ found: null });
    await rejectsWithCode(ausente.service.handle({ accountId: 'acc-A', requestId: 'x', status: 'HANDLED' }), 'REQUEST_NOT_FOUND');
  });

  it('sin dueño en la cuenta igual se atiende (la operación vale más que su rastro)', async () => {
    const { service, calls } = makeService({ owner: false });
    await service.handle({ accountId: 'acc-A', requestId: 'r1', status: 'HANDLED' });
    assert.equal(calls.updated!.status, 'HANDLED');
    assert.deepEqual(calls.systemAudit, []);
  });
});
