import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanLifecycleService } from './plan-lifecycle.service';

const HOY = new Date('2026-08-23T12:00:00.000Z');

function makeService(
  opts: {
    account?: Record<string, unknown> | null;
    /** miembros activos: [{ isOwner, email, lastLoginAt }] */
    members?: { isOwner?: boolean; email?: string; lastLoginAt?: Date | null }[];
  } = {},
) {
  const calls = {
    updates: [] as Record<string, unknown>[],
    audits: [] as Record<string, unknown>[],
    notifs: [] as { userId: string; title: string }[],
    mails: [] as { to: string; subject: string }[],
  };
  const members = opts.members ?? [{ isOwner: true, email: 'owner@x.demo', lastLoginAt: HOY }];
  const tx = {
    account: {
      findFirst: async () =>
        'account' in opts
          ? opts.account
          : {
              status: 'ACTIVE',
              planCode: 'FREE',
              settings: {},
              businessName: 'Cobranzas Sur',
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
      update: async (args: { data: Record<string, unknown> }) => void calls.updates.push(args.data),
    },
    userAccount: {
      findMany: async (args: { select: Record<string, unknown> }) =>
        'user' in args.select
          ? members.map((m) => ({
              isOwner: m.isOwner ?? false,
              user: { email: m.email ?? 'x@x.demo', lastLoginAt: m.lastLoginAt ?? null },
            }))
          : members.map((_, i) => ({ userId: `admin-${i}` })),
      findFirst: async () => ({ userId: 'owner-1' }),
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => void calls.audits.push(args.data),
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const notifications = {
    notifyUser: async (_acc: string, userId: string, data: { title: string }) =>
      void calls.notifs.push({ userId, title: data.title }),
  };
  const mail = { send: async (to: string, subject: string) => void calls.mails.push({ to, subject }) };
  const config = { mailFrom: 'ventas@kobrax.demo', smtpUser: undefined };
  const service = new PlanLifecycleService(
    prisma as never,
    notifications as never,
    mail as never,
    config as never,
  );
  return { service, calls };
}

describe('PlanLifecycleService — la prueba vencida', () => {
  const TRIAL_VENCIDO = {
    status: 'TRIAL',
    planCode: 'PROFESSIONAL',
    settings: { trialEndsAt: '2026-08-20T00:00:00.000Z' },
    businessName: 'Cobranzas Sur',
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
  };

  it('🔴 cae a FREE y queda ACTIVE: no se bloquea, se congela (Preguntas 34 y 31)', async () => {
    const { service, calls } = makeService({ account: TRIAL_VENCIDO });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.trialsExpired, 1);
    assert.deepEqual(calls.updates[0], { planCode: 'FREE', status: 'ACTIVE' });
    assert.equal((calls.audits[0]!.after as Record<string, unknown>).via, 'plan:lifecycle');
  });

  it('el dueño se entera por notificación y ventas por correo: es la llamada más caliente', async () => {
    const { service, calls } = makeService({ account: TRIAL_VENCIDO });
    await service.scanAccount('acc-A', HOY);
    assert.match(calls.notifs[0]!.title, /Terminó la prueba de Professional/);
    assert.equal(calls.mails[0]!.to, 'ventas@kobrax.demo');
    assert.match(calls.mails[0]!.subject, /Cobranzas Sur.*Professional/);
  });

  it('la prueba vigente no se toca', async () => {
    const { service, calls } = makeService({
      account: { ...TRIAL_VENCIDO, settings: { trialEndsAt: '2026-09-20T00:00:00.000Z' } },
    });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.trialsExpired, 0);
    assert.equal(calls.updates.length, 0);
  });

  it('correr dos veces no hace caer dos veces: el guard es status, que dejó de ser TRIAL', async () => {
    const { service, calls } = makeService({
      account: { ...TRIAL_VENCIDO, status: 'ACTIVE', planCode: 'FREE' },
    });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.trialsExpired, 0);
    assert.equal(calls.notifs.length + calls.mails.length, 0);
  });
});

describe('PlanLifecycleService — la FREE dormida', () => {
  const HACE_7_MESES = new Date('2026-01-15T00:00:00.000Z');
  const AYER = new Date('2026-08-22T00:00:00.000Z');

  it('a los 6 meses sin que nadie entre, un correo al dueño y la marca del aviso', async () => {
    const { service, calls } = makeService({
      members: [{ isOwner: true, email: 'owner@x.demo', lastLoginAt: HACE_7_MESES }],
    });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.dormantWarned, 1);
    assert.equal(calls.mails[0]!.to, 'owner@x.demo');
    const settings = calls.updates[0]!.settings as Record<string, unknown>;
    assert.equal(typeof settings.dormantWarnedAt, 'string');
  });

  it('avisada una vez, no se repite en cada corrida diaria', async () => {
    const { service, calls } = makeService({
      account: {
        status: 'ACTIVE',
        planCode: 'FREE',
        settings: { dormantWarnedAt: '2026-08-01T00:00:00.000Z' },
        businessName: 'X',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      members: [{ isOwner: true, lastLoginAt: HACE_7_MESES }],
    });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.dormantWarned, 0);
    assert.equal(calls.mails.length, 0);
  });

  it('cuando alguien vuelve a entrar, la marca se limpia sola: la próxima siesta avisa de nuevo', async () => {
    const { service, calls } = makeService({
      account: {
        status: 'ACTIVE',
        planCode: 'FREE',
        settings: { dormantWarnedAt: '2026-08-01T00:00:00.000Z', trialEndsAt: 'queda' },
        businessName: 'X',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      members: [{ isOwner: true, lastLoginAt: AYER }],
    });
    await service.scanAccount('acc-A', HOY);
    const settings = calls.updates[0]!.settings as Record<string, unknown>;
    assert.equal(settings.dormantWarnedAt, undefined);
    assert.equal(settings.trialEndsAt, 'queda', 'limpia SU marca, no el resto de settings');
  });

  it('la cuenta con actividad reciente ni se marca ni se escribe', async () => {
    const { service, calls } = makeService({
      members: [{ isOwner: true, lastLoginAt: AYER }],
    });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.dormantWarned, 0);
    assert.equal(calls.updates.length, 0);
  });

  it('sin ningún login jamás cuenta la creación: una cuenta recién nacida no está dormida', async () => {
    const { service, calls } = makeService({
      account: {
        status: 'ACTIVE',
        planCode: 'FREE',
        settings: {},
        businessName: 'X',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      members: [{ isOwner: true, lastLoginAt: null }],
    });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.dormantWarned, 0);
    assert.equal(calls.updates.length, 0);
  });

  it('la cuenta paga dormida no recibe este aviso: la regla es de las FREE (Pregunta 20)', async () => {
    const { service, calls } = makeService({
      account: {
        status: 'ACTIVE',
        planCode: 'BUSINESS',
        settings: {},
        businessName: 'X',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      members: [{ isOwner: true, lastLoginAt: HACE_7_MESES }],
    });
    const r = await service.scanAccount('acc-A', HOY);
    assert.equal(r.dormantWarned, 0);
    assert.equal(calls.mails.length, 0);
  });
});
