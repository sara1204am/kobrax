import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanToolsService, parseOverride } from './plan-tools.service';

function makeService(opts: { account?: unknown; owner?: unknown } = {}) {
  const calls = {
    updates: [] as Record<string, unknown>[],
    audits: [] as Record<string, unknown>[],
  };
  const cuenta =
    'account' in opts
      ? opts.account
      : { planCode: 'FREE', limitsOverride: null, status: 'ACTIVE', businessName: 'Cobranzas Sur' };
  const tx = {
    account: {
      findFirst: async () => cuenta,
      update: async (args: { data: Record<string, unknown> }) => {
        calls.updates.push(args.data);
        return { ...(cuenta as Record<string, unknown>), ...args.data };
      },
    },
    userAccount: { findFirst: async () => ('owner' in opts ? opts.owner : { userId: 'owner-1' }) },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => void calls.audits.push(args.data),
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const service = new PlanToolsService(prisma as never);
  return { service, calls };
}

describe('parseOverride (entrada de teclado del operador)', () => {
  it('acepta el objeto con topes y la palabra null', () => {
    assert.deepEqual(parseOverride('{"users":40}'), { users: 40 });
    assert.equal(parseOverride('null'), null);
  });

  it('🔴 una clave con typo rebota: si effectiveLimits la ignorara en silencio, el operador creería que negoció 40 usuarios', () => {
    assert.throws(() => parseOverride('{"user":40}'), /clave desconocida/);
  });

  it('rechaza lo que no es JSON, lo que no es objeto y los valores inválidos', () => {
    assert.throws(() => parseOverride('{users:40}'), /no es JSON/);
    assert.throws(() => parseOverride('[1,2]'), /objeto/);
    assert.throws(() => parseOverride('{"users":-1}'), /número/);
    assert.throws(() => parseOverride('{"users":"muchos"}'), /número/);
  });
});

describe('PlanToolsService.setPlan', () => {
  it('cambia el plan y deja la entrada de auditoría a nombre del dueño, con via adentro', async () => {
    const { service, calls } = makeService();
    const r = await service.setPlan({ accountId: 'acc-A', plan: 'BUSINESS' });
    assert.equal(calls.updates[0]!.planCode, 'BUSINESS');
    assert.equal(r.limits.users, 100, 'devuelve los topes ya resueltos, para verificar de un vistazo');
    assert.equal(calls.audits[0]!.userId, 'owner-1');
    assert.equal((calls.audits[0]!.after as Record<string, unknown>).via, 'plan:set');
  });

  it('un plan inventado rebota con la lista de los válidos', async () => {
    const { service, calls } = makeService();
    await assert.rejects(service.setPlan({ accountId: 'acc-A', plan: 'GOLD' }), /Plan desconocido/);
    assert.equal(calls.updates.length, 0);
  });

  it('sin --plan ni --override no escribe nada: no hay no-op mudo', async () => {
    const { service } = makeService();
    await assert.rejects(service.setPlan({ accountId: 'acc-A' }), /Nada que cambiar/);
  });

  it('el override reemplaza entero, y null lo borra (DbNull, no el null ambiguo de Json)', async () => {
    const { service, calls } = makeService();
    await service.setPlan({ accountId: 'acc-A', override: '{"users":40}' });
    assert.deepEqual(calls.updates[0]!.limitsOverride, { users: 40 });

    await service.setPlan({ accountId: 'acc-A', override: 'null' });
    // Prisma.DbNull es un objeto marcador; alcanza con que no sea el null literal ni undefined.
    assert.ok(calls.updates[1]!.limitsOverride != null);
  });

  it('la cuenta inexistente o borrada rebota antes de tocar nada', async () => {
    const { service, calls } = makeService({ account: null });
    await assert.rejects(service.setPlan({ accountId: 'nope', plan: 'FREE' }), /No existe/);
    assert.equal(calls.updates.length, 0);
  });
});

describe('PlanToolsService.suspend', () => {
  it('suspende, y con lift vuelve a ACTIVE — cada una con su rastro', async () => {
    const { service, calls } = makeService();
    const r = await service.suspend('acc-A');
    assert.equal(r.status, 'SUSPENDED');
    assert.equal((calls.audits[0]!.after as Record<string, unknown>).via, 'account:suspend');

    const { service: s2, calls: c2 } = makeService({
      account: { planCode: 'FREE', limitsOverride: null, status: 'SUSPENDED', businessName: 'X' },
    });
    const r2 = await s2.suspend('acc-A', { lift: true });
    assert.equal(r2.status, 'ACTIVE');
    assert.equal((c2.audits[0]!.after as Record<string, unknown>).via, 'account:suspend --lift');
  });

  it('suspender lo ya suspendido es un no-op dicho en voz alta, no una segunda entrada de audit', async () => {
    const { service, calls } = makeService({
      account: { planCode: 'FREE', limitsOverride: null, status: 'SUSPENDED', businessName: 'X' },
    });
    const r = await service.suspend('acc-A');
    assert.equal(r.status, 'SUSPENDED');
    assert.equal(calls.updates.length + calls.audits.length, 0);
  });
});
