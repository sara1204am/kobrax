import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashSync } from 'bcryptjs';
import { OwnershipService } from './ownership.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

type Row = Record<string, unknown>;

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'Secreto-123!';

function member(userId: string, over: Row = {}, userOver: Row = {}): Row {
  return {
    id: `ua-${userId.slice(0, 2)}`,
    userId,
    isOwner: userId === ME,
    isActive: true,
    user: {
      email: `${userId.slice(0, 2)}@kobrax.demo`,
      passwordHash: hashSync(PASSWORD, 4),
      mfaEnabled: false,
      profile: { firstName: userId === ME ? 'Sara' : 'Luis', lastName: 'Admin' },
      ...userOver,
    },
    ...over,
  };
}

function makeService(opts: { me?: Row | null; target?: Row | null; mfaOk?: boolean; notifyFails?: boolean } = {}) {
  const calls = {
    targetWhere: undefined as Row | undefined,
    updates: [] as { id: string; isOwner: boolean }[],
    audit: [] as { action: string; before?: unknown; after?: unknown }[],
    notified: [] as { userId: string; body: string }[],
    challenged: [] as string[],
  };
  const tx = {
    userAccount: {
      findFirst: async (args: { where: Row }) => {
        if (args.where.userId === ME) return opts.me === undefined ? member(ME) : opts.me;
        calls.targetWhere = args.where;
        return opts.target === undefined ? member(OTHER) : opts.target;
      },
      update: async (args: { where: { id: string }; data: { isOwner: boolean } }) => void calls.updates.push({ id: args.where.id, isOwner: args.data.isOwner }),
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const audit = { record: async (e: { action: string; before?: unknown; after?: unknown }) => void calls.audit.push(e) };
  const mfa = {
    challenge: async (_u: string, code: string) => {
      calls.challenged.push(code);
      return opts.mfaOk ?? true;
    },
  };
  const notifications = {
    notifyUser: async (_a: string, userId: string, data: { body: string }) => {
      if (opts.notifyFails) throw new Error('ws caído');
      calls.notified.push({ userId, body: data.body });
    },
  };
  const service = new OwnershipService(prisma as never, { accountId: 'acc-A', userId: ME } as never, audit as never, mfa as never, notifications as never);
  return { service, calls };
}

describe('OwnershipService.transfer', () => {
  it('pasa la propiedad: el dueño deja de serlo, el otro lo es, se audita y se avisa a los dos', async () => {
    const { service, calls } = makeService();
    await service.transfer({ userId: OTHER, password: PASSWORD });

    assert.deepEqual(calls.updates, [
      { id: `ua-${ME.slice(0, 2)}`, isOwner: false },
      { id: `ua-${OTHER.slice(0, 2)}`, isOwner: true },
    ]);
    assert.deepEqual(calls.audit.map((a) => a.action), ['OWNERSHIP_TRANSFER']);
    assert.deepEqual(calls.audit[0]!.before, { ownerUserId: ME, ownerName: 'Sara Admin' });
    assert.deepEqual(calls.audit[0]!.after, { ownerUserId: OTHER, ownerName: 'Luis Admin' });
    assert.deepEqual(calls.notified.map((n) => n.userId).sort(), [ME, OTHER].sort());
  });

  it('🔴 sólo el dueño actual puede transferir', async () => {
    const { service, calls } = makeService({ me: member(ME, { isOwner: false }) });
    await rejectsWithCode(service.transfer({ userId: OTHER, password: PASSWORD }), 'OWNER_NOT_OWNER');
    assert.deepEqual(calls.updates, []);
  });

  it('no se transfiere a uno mismo', async () => {
    const { service, calls } = makeService();
    await rejectsWithCode(service.transfer({ userId: ME, password: PASSWORD }), 'OWNER_TARGET_INVALID');
    assert.deepEqual(calls.updates, []);
  });

  it('🔴 el destinatario tiene que ser un ADMINISTRADOR ACTIVO de la cuenta; si la búsqueda no lo encuentra, se rechaza', async () => {
    const { service, calls } = makeService({ target: null });
    await rejectsWithCode(service.transfer({ userId: OTHER, password: PASSWORD }), 'OWNER_TARGET_INVALID');
    assert.deepEqual(calls.updates, []);
    assert.equal(calls.targetWhere!.isActive, true);
    assert.deepEqual(calls.targetWhere!.role, { name: 'ACCOUNT_ADMIN' });
    assert.deepEqual(calls.targetWhere!.user, { status: 'ACTIVE' });
  });

  it('🔴 con la contraseña equivocada no cambia nada ni gasta un código de verificación', async () => {
    const { service, calls } = makeService({ me: member(ME, {}, { mfaEnabled: true }) });
    await rejectsWithCode(service.transfer({ userId: OTHER, password: 'otra', code: '123456' }), 'OWNER_PASSWORD_INVALID');
    assert.deepEqual(calls.updates, []);
    assert.deepEqual(calls.challenged, []);
  });

  it('🔴 con verificación en dos pasos activa, exige un código válido en el mismo pedido', async () => {
    const sinCodigo = makeService({ me: member(ME, {}, { mfaEnabled: true }), mfaOk: false });
    await rejectsWithCode(sinCodigo.service.transfer({ userId: OTHER, password: PASSWORD }), 'OWNER_CODE_INVALID');
    assert.deepEqual(sinCodigo.calls.updates, []);

    const malo = makeService({ me: member(ME, {}, { mfaEnabled: true }), mfaOk: false });
    await rejectsWithCode(malo.service.transfer({ userId: OTHER, password: PASSWORD, code: '000000' }), 'OWNER_CODE_INVALID');
    assert.deepEqual(malo.calls.updates, []);

    const bueno = makeService({ me: member(ME, {}, { mfaEnabled: true }), mfaOk: true });
    await bueno.service.transfer({ userId: OTHER, password: PASSWORD, code: '123456' });
    assert.equal(bueno.calls.updates.length, 2);
    assert.deepEqual(bueno.calls.challenged, ['123456']);
  });

  it('sin MFA activo (período de gracia) basta la contraseña y no se consulta el segundo factor', async () => {
    const { service, calls } = makeService();
    await service.transfer({ userId: OTHER, password: PASSWORD });
    assert.deepEqual(calls.challenged, []);
  });

  it('si el aviso falla, el traspaso ya está hecho y auditado', async () => {
    const { service, calls } = makeService({ notifyFails: true });
    const r = await service.transfer({ userId: OTHER, password: PASSWORD });
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.updates.length, 2);
    assert.deepEqual(calls.audit.map((a) => a.action), ['OWNERSHIP_TRANSFER']);
  });
});
