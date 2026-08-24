import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanUsageAlertsService } from './plan-usage-alerts.service';

/**
 * El aviso mensual (L2): al 80% un cartel al administrador, una vez por mes y por tope; al 100%
 * un correo hacia adentro. Nunca frena — acá ni siquiera hay un camino que devuelva error.
 */
function makeService(
  opts: {
    max?: number | null;
    used?: number;
    /** La marca guardada de un aviso anterior, tal como vive en `settings.planAlerts`. */
    marca?: { month: string; level: string };
    settings?: Record<string, unknown>;
  } = {},
) {
  const calls = {
    updates: [] as Record<string, unknown>[],
    notifs: [] as { userId: string; title: string }[],
    mails: [] as { to: string; subject: string }[],
  };
  const settings = {
    ...(opts.settings ?? {}),
    ...(opts.marca ? { planAlerts: { photosPerMonth: opts.marca } } : {}),
  };
  const tx = {
    account: {
      findFirst: async () => ({ settings, businessName: 'Cobranzas Sur', planCode: 'PROFESSIONAL' }),
      update: async (args: { data: Record<string, unknown> }) => {
        calls.updates.push(args.data);
        return {};
      },
    },
    userAccount: {
      findMany: async () => [{ userId: 'admin-1' }, { userId: 'admin-2' }],
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const plan = {
    limitsOf: async () => ({ photosPerMonth: opts.max === undefined ? 100 : opts.max }),
    monthlyUsage: async () => opts.used ?? 0,
  };
  const clock = { monthStart: async () => new Date('2026-08-01T00:00:00.000Z') };
  const notifications = {
    notifyUser: async (_acc: string, userId: string, data: { title: string }) =>
      void calls.notifs.push({ userId, title: data.title }),
  };
  const mail = {
    send: async (to: string, subject: string) => void calls.mails.push({ to, subject }),
  };
  const config = { mailFrom: 'ventas@kobrax.demo', smtpUser: undefined };
  const service = new PlanUsageAlertsService(
    prisma as never,
    { accountId: 'acc-A' } as never,
    clock as never,
    plan as never,
    notifications as never,
    mail as never,
    config as never,
  );
  return { service, calls };
}

describe('PlanUsageAlertsService.check', () => {
  it('debajo del 80% no pasa nada: ni marca, ni cartel, ni correo', async () => {
    const { service, calls } = makeService({ used: 79 });
    await service.check('photosPerMonth');
    assert.equal(calls.updates.length + calls.notifs.length + calls.mails.length, 0);
  });

  it('al 80% avisa a cada administrador y guarda la marca del mes', async () => {
    const { service, calls } = makeService({ used: 80 });
    await service.check('photosPerMonth');
    assert.deepEqual(
      calls.notifs.map((n) => n.userId),
      ['admin-1', 'admin-2'],
    );
    assert.match(calls.notifs[0]!.title, /Cerca del tope de fotos/);
    const guardado = calls.updates[0]!.settings as { planAlerts: Record<string, unknown> };
    assert.deepEqual(guardado.planAlerts.photosPerMonth, { month: '2026-08', level: 'near' });
    assert.equal(calls.mails.length, 0, 'el correo interno es sólo del 100%');
  });

  it('🔴 una vez por mes y por tope: con la marca puesta, el segundo cruce es silencio', async () => {
    const { service, calls } = makeService({ used: 85, marca: { month: '2026-08', level: 'near' } });
    await service.check('photosPerMonth');
    assert.equal(calls.updates.length + calls.notifs.length + calls.mails.length, 0);
  });

  it('mes nuevo, aviso nuevo: la marca de julio no calla el cartel de agosto', async () => {
    const { service, calls } = makeService({ used: 85, marca: { month: '2026-07', level: 'full' } });
    await service.check('photosPerMonth');
    assert.equal(calls.notifs.length, 2);
  });

  it('al 100% sale el correo hacia adentro, con la cuenta y el número: es una conversación de venta', async () => {
    const { service, calls } = makeService({ used: 100, marca: { month: '2026-08', level: 'near' } });
    await service.check('photosPerMonth');
    assert.equal(calls.notifs.length, 0, 'el admin ya escuchó su cartel del 80% este mes');
    assert.equal(calls.mails[0]!.to, 'ventas@kobrax.demo');
    assert.match(calls.mails[0]!.subject, /Cobranzas Sur.*100\/100/);
  });

  it('el mes que salta directo al 100% avisa a los dos lados: el admin nunca escuchó el 80%', async () => {
    const { service, calls } = makeService({ used: 120 });
    await service.check('photosPerMonth');
    assert.equal(calls.notifs.length, 2);
    assert.match(calls.notifs[0]!.title, /Se llegó al tope/);
    assert.equal(calls.mails.length, 1);
  });

  it('sin tope no hay nada que medir', async () => {
    const { service, calls } = makeService({ max: null, used: 10_000 });
    await service.check('photosPerMonth');
    assert.equal(calls.updates.length + calls.notifs.length + calls.mails.length, 0);
  });

  it('la marca no pisa el resto de settings: trialEndsAt sobrevive al aviso', async () => {
    const { service, calls } = makeService({ used: 90, settings: { trialEndsAt: '2026-09-01' } });
    await service.check('photosPerMonth');
    const guardado = calls.updates[0]!.settings as Record<string, unknown>;
    assert.equal(guardado.trialEndsAt, '2026-09-01');
  });
});
