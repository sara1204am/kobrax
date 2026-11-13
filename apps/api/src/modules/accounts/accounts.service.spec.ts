import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fakePlanLimits } from '../../common/plan/plan-test-utils';
import { PLANS, TRIAL_DAYS, effectiveLimits } from '@kobrax/shared';
import { AccountsService } from './accounts.service';
import { rejectsWithCode } from '../auth/auth-test-utils';
import { AUTH_ERR } from '../auth/auth.errors';

function account(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-A',
    businessName: 'Cobranzas Pérez',
    taxId: '123456',
    accountType: 'INDEPENDENT',
    status: 'ACTIVE',
    planCode: 'PROFESSIONAL',
    countryCode: 'BO',
    currencyCode: 'BOB',
    timezone: 'America/La_Paz',
    limitsOverride: null,
    deletedAt: null,
    ...over,
  };
}

function makeService(opts: { found?: Record<string, unknown> | null; members?: number; offices?: number; routesInProgress?: number } = {}) {
  const calls = {
    findWhere: undefined as Record<string, unknown> | undefined,
    updated: undefined as Record<string, unknown> | undefined,
    audit: [] as string[],
    auditEntries: [] as { entity: string; action: string; before?: unknown; after?: unknown }[],
    locked: [] as unknown[][],
    routeWhere: undefined as Record<string, unknown> | undefined,
  };
  const tx = {
    // F15: el workspace se guarda con la fila bloqueada (`SELECT … FOR UPDATE`); el fake registra los valores de la consulta.
    $queryRaw: async (_strings: unknown, ...values: unknown[]) => void calls.locked.push(values),
    routePlan: {
      count: async (args: { where: Record<string, unknown> }) => {
        calls.routeWhere = args.where;
        return opts.routesInProgress ?? 0;
      },
    },
    account: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.findWhere = args.where;
        return opts.found === undefined ? account() : opts.found;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.updated = args.data;
        return account(args.data);
      },
    },
    userAccount: { count: async () => opts.members ?? 3 },
  };
  const prisma = {
    withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    elevated: async (_tx: unknown, fn: () => Promise<unknown>) => fn(),
  };
  const tenant = { accountId: 'acc-A', userId: 'u1' };
  const audit = {
    record: async (e: { entity: string; action: string; before?: unknown; after?: unknown }) => {
      calls.audit.push(e.action);
      calls.auditEntries.push(e);
    },
  };
  const service = new AccountsService(
    prisma as never,
    tenant as never,
    audit as never,
    fakePlanLimits({ usage: { users: opts.members ?? 3, branches: opts.offices ?? 1 } }),
  );
  return { service, calls };
}

/** Fakes del registro público (S4): además del `tx` necesita `role` fuera del contexto. */
function makeSignupService(opts: { role?: { id: string } | null; failWith?: unknown } = {}) {
  const calls = {
    tenantContext: undefined as string | undefined,
    account: undefined as Record<string, unknown> | undefined,
    user: undefined as Record<string, unknown> | undefined,
    membership: undefined as Record<string, unknown> | undefined,
    audit: undefined as Record<string, unknown> | undefined,
    categories: undefined as Record<string, unknown>[] | undefined,
    catalogs: undefined as Record<string, unknown>[] | undefined,
    types: undefined as Record<string, unknown>[] | undefined,
    branch: undefined as Record<string, unknown> | undefined,
  };
  const tx = {
    branchType: { createMany: async (a: { data: Record<string, unknown>[] }) => void (calls.types = a.data) },
    branch: { create: async (a: { data: Record<string, unknown> }) => void (calls.branch = a.data) },
    catalogItem: {
      createMany: async (a: { data: Record<string, unknown>[] }) => void (calls.catalogs = a.data),
    },
    arrearCategory: {
      createMany: async (a: { data: Record<string, unknown>[] }) => void (calls.categories = a.data),
    },
    account: {
      create: async (a: { data: Record<string, unknown> }) => {
        if (opts.failWith) throw opts.failWith;
        calls.account = a.data;
        return a.data;
      },
    },
    user: {
      create: async (a: { data: Record<string, unknown> }) => {
        calls.user = a.data;
        return { id: 'u-new', ...a.data };
      },
    },
    userAccount: {
      create: async (a: { data: Record<string, unknown> }) => void (calls.membership = a.data),
    },
    auditLog: {
      create: async (a: { data: Record<string, unknown> }) => void (calls.audit = a.data),
    },
  };
  const prisma = {
    role: { findUnique: async () => (opts.role === undefined ? { id: 'role-admin' } : opts.role) },
    withTenant: async (accountId: string, fn: (t: typeof tx) => Promise<unknown>) => {
      calls.tenantContext = accountId;
      return fn(tx);
    },
  };
  const service = new AccountsService(prisma as never, {} as never, {} as never, fakePlanLimits());
  return { service, calls };
}

const SIGNUP = {
  businessName: 'Cobranzas Pérez',
  firstName: 'Sara',
  lastName: 'Pérez',
  email: 'Sara@Ejemplo.com',
  password: 'Kobrax123!',
};

describe('AccountsService.create (registro público · S4)', () => {
  it('crea cuenta, usuario, perfil, membresía de dueño y audit', async () => {
    const { service, calls } = makeSignupService();
    const res = await service.create(SIGNUP, { ip: '1.2.3.4', userAgent: 'expo' });

    assert.equal(calls.account!.businessName, 'Cobranzas Pérez');
    assert.equal(calls.account!.accountType, 'INDEPENDENT');
    // Sin plan elegido: FREE. Y el FREE **no es una prueba**, es permanente.
    assert.equal(calls.account!.status, 'ACTIVE');
    assert.equal(calls.account!.planCode, 'FREE');
    // Sin excepción: la cuenta nueva se lleva exactamente los topes de su plan.
    assert.equal(calls.account!.limitsOverride, undefined);
    assert.deepEqual(calls.account!.settings, {});
    assert.deepEqual((calls.user!.profile as { create: unknown }).create, {
      firstName: 'Sara',
      lastName: 'Pérez',
    });
    assert.equal(calls.membership!.isOwner, true);
    assert.equal(calls.membership!.roleId, 'role-admin');
    assert.equal(calls.audit!.action, 'CREATE');
    assert.equal(calls.audit!.userId, 'u-new');
    assert.equal(calls.audit!.ip, '1.2.3.4');
    assert.equal(res.accountId, calls.account!.id);
  });

  it('F13 · la cuenta nace con sus tipos de oficina y la RAÍZ con la razón social, en la misma transacción; el dueño queda sin asignación', async () => {
    const { service, calls } = makeSignupService();
    await service.create({ businessName: 'Banco Sur', firstName: 'A', lastName: 'B', email: 'a@b.com', password: 'Kobrax123!' } as never, {});
    assert.deepEqual(calls.types!.map((t) => t.code), ['CENTRAL', 'REGIONAL', 'AGENCIA']);
    assert.ok(calls.types!.every((t) => t.accountId === calls.account!.id));
    const root = calls.branch!;
    assert.equal(root.name, 'Banco Sur');
    assert.equal(root.isRoot, true);
    assert.equal(root.depth, 0);
    assert.equal(root.accountId, calls.account!.id);
    assert.equal(root.path, `/${root.id}/`);
    assert.equal(root.typeId, calls.types!.find((t) => t.code === 'CENTRAL')!.id);
    assert.equal(root.parentId, undefined);
    // El dueño es ACCOUNT_ADMIN: sin asignación de oficina (ve todo por capacidad).
    assert.equal(calls.membership!.branchId, undefined);
  });

  it('F4/08 · D1-b: la cuenta nace con las categorías de mora A 1–30, B 31–60, C 61+, de SU cuenta', async () => {
    const { service, calls } = makeSignupService();
    const res = await service.create(SIGNUP, {});
    assert.deepEqual(
      calls.categories!.map((c) => [c.accountId, c.code, c.fromDays, c.toDays]),
      [
        [res.accountId, 'A', 1, 30],
        [res.accountId, 'B', 31, 60],
        [res.accountId, 'C', 61, null],
      ],
    );
  });

  it('F4/13 · D-01: la cuenta nace con los catálogos por defecto, todos de SU cuenta (antes nacía sin métodos de pago ni bancos)', async () => {
    const { service, calls } = makeSignupService();
    const res = await service.create(SIGNUP, {});
    const rows = calls.catalogs!;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.accountId === res.accountId));
    const tipos = new Set(rows.map((r) => r.catalog));
    for (const t of ['PAYMENT_METHOD', 'BANK', 'INCOME_SOURCE', 'OCCUPATION', 'NO_PAYMENT_REASON', 'COLLECTION_MODALITY']) {
      assert.ok(tipos.has(t), `falta ${t}`);
    }
  });

  it('🔴 el plan elegido entrega sus asientos, pero como PRUEBA de 30 días', async () => {
    const { service, calls } = makeSignupService();
    await service.create({ ...SIGNUP, planCode: 'PROFESSIONAL' }, {});

    // Los 25 asientos son de verdad desde el minuto uno: es el único tope que la API frena hoy,
    // y ahora sale del plan de la cuenta, no de un número guardado al crearla.
    assert.equal(calls.account!.planCode, 'PROFESSIONAL');
    assert.equal(PLANS.PROFESSIONAL.limits.users, 25);
    // Pero nace en prueba, que es lo que evita regalar un plan pago sin pasarela de cobro.
    assert.equal(calls.account!.status, 'TRIAL');
    const vence = new Date((calls.account!.settings as { trialEndsAt: string }).trialEndsAt);
    const dias = Math.round((vence.getTime() - Date.now()) / 86_400_000);
    assert.equal(dias, TRIAL_DAYS);
  });

  it('el plan elegido queda en la bitácora del alta', async () => {
    // Qué plan elige la gente antes de conocer el producto es la métrica que decide el precio.
    const { service, calls } = makeSignupService();
    await service.create({ ...SIGNUP, planCode: 'BUSINESS' }, {});
    assert.equal((calls.audit!.after as { planCode: string }).planCode, 'BUSINESS');
    assert.equal(calls.account!.planCode, 'BUSINESS');
  });

  it('el email se normaliza a minúsculas', async () => {
    const { service, calls } = makeSignupService();
    const res = await service.create(SIGNUP, {});
    assert.equal(calls.user!.email, 'sara@ejemplo.com');
    assert.equal(res.email, 'sara@ejemplo.com');
  });

  // S4-D2: la policy `tenant_self` exige `id = app_current_account()`. Si el contexto
  // no es el id de la cuenta nueva, PostgreSQL rechaza el INSERT y el registro muere.
  it('abre el contexto RLS con el mismo id que le pone a la cuenta', async () => {
    const { service, calls } = makeSignupService();
    await service.create(SIGNUP, {});
    assert.equal(calls.tenantContext, calls.account!.id);
    assert.equal(calls.membership!.accountId, calls.tenantContext);
    assert.equal(calls.audit!.accountId, calls.tenantContext);
  });

  // S4-D6: los defaults del schema (PENDING / true) romperían el login del recién registrado.
  it('el usuario nace ACTIVE y sin cambio de contraseña forzado', async () => {
    const { service, calls } = makeSignupService();
    await service.create(SIGNUP, {});
    assert.equal(calls.user!.status, 'ACTIVE');
    assert.equal(calls.user!.requiresPasswordChange, false);
  });

  it('la contraseña se guarda hasheada, nunca en claro', async () => {
    const { service, calls } = makeSignupService();
    await service.create(SIGNUP, {});
    assert.notEqual(calls.user!.passwordHash, SIGNUP.password);
    assert.match(calls.user!.passwordHash as string, /^\$2[aby]\$/);
  });

  it('email ya registrado → 409 (lo detecta el unique de la base, no un chequeo previo)', async () => {
    const { service } = makeSignupService({ failWith: { code: 'P2002' } });
    await rejectsWithCode(service.create(SIGNUP, {}), 'AUTH_EMAIL_TAKEN');
  });

  it('contraseña débil → 400, y no toca la base', async () => {
    const { service, calls } = makeSignupService();
    await rejectsWithCode(service.create({ ...SIGNUP, password: 'kobrax' }, {}), AUTH_ERR.WEAK_PASSWORD);
    assert.equal(calls.account, undefined);
  });

  it('sin el rol ACCOUNT_ADMIN seedeado no inventa una cuenta a medias', async () => {
    const { service, calls } = makeSignupService({ role: null });
    await rejectsWithCode(service.create(SIGNUP, {}), 'ROLE_CATALOG_MISSING');
    assert.equal(calls.account, undefined);
  });
});

describe('AccountsService.findMine', () => {
  it('acota por id además de la RLS, y trae los miembros activos', async () => {
    const { service, calls } = makeService({ members: 3 });
    const res = await service.findMine();
    assert.equal(calls.findWhere!.id, 'acc-A');
    assert.equal(calls.findWhere!.deletedAt, null);
    assert.equal(res.usage.users, 3);
    // Los topes viajan resueltos: la pantalla no tiene que saber de planes ni de excepciones.
    assert.equal(res.limits.users, 25);
  });

  it('🔴 la excepción negociada le gana al plan, y el override no sale de la API', async () => {
    // Es lo que sostiene la promesa de «nadie pierde asientos» al estrenar los planes: una cuenta
    // vieja con 5 los conserva aunque su plan incluya otro número.
    const { service } = makeService({ found: account({ planCode: 'FREE', limitsOverride: { users: 5 } }) });
    const res = await service.findMine();
    assert.equal(res.limits.users, 5);
    assert.equal(res.limits.credits, 20, 'lo que no se negoció sigue saliendo del plan');
    assert.equal('limitsOverride' in res, false, 'lo negociado con ese cliente es interno');
  });

  it('trialEndsAt sale sólo mientras la cuenta está en prueba', async () => {
    const settings = { trialEndsAt: '2026-11-20T00:00:00.000Z' };
    const trial = makeService({ found: account({ status: 'TRIAL', settings }) });
    assert.equal((await trial.service.findMine()).trialEndsAt, '2026-11-20T00:00:00.000Z');

    // Vencida: la constancia sigue en settings, pero la pantalla no debe contar días de una prueba que ya pasó.
    const active = makeService({ found: account({ status: 'ACTIVE', settings }) });
    assert.equal((await active.service.findMine()).trialEndsAt, null);
  });

  it('trialEndsAt con basura en settings cae a null', async () => {
    const { service } = makeService({ found: account({ status: 'TRIAL', settings: { trialEndsAt: 'no-es-fecha' } }) });
    assert.equal((await service.findMine()).trialEndsAt, null);
  });

  it('404 si el tenant no existe', async () => {
    const { service } = makeService({ found: null });
    await rejectsWithCode(service.findMine(), 'ACCOUNT_NOT_FOUND');
  });
});

describe('AccountsService.update', () => {
  it('escribe sólo los campos configurables y audita', async () => {
    const { service, calls } = makeService();
    await service.update({ businessName: 'Nuevo Nombre', currencyCode: 'PEN' });
    assert.deepEqual(Object.keys(calls.updated!).sort(), [
      'address',
      'businessName',
      'city',
      'countryCode',
      'currencyCode',
      'email',
      'logoUrl',
      'phone',
      'taxId',
      'timezone',
      'website',
    ]);
    assert.equal(calls.updated!.businessName, 'Nuevo Nombre');
    assert.deepEqual(calls.audit, ['UPDATE']);
  });

  it('identidad y contacto: se escriben tal cual y null los quita', async () => {
    const { service, calls } = makeService();
    await service.update({ phone: '+591 70000000', city: 'La Paz', website: null });
    assert.equal(calls.updated!.phone, '+591 70000000');
    assert.equal(calls.updated!.city, 'La Paz');
    assert.equal(calls.updated!.website, null, 'null = quitarlo');
    assert.equal(calls.updated!.email, undefined, 'ausente = no tocarlo');
  });

  it('findMine expone identidad y contacto, null si no los cargó', async () => {
    const lleno = makeService({ found: account({ logoUrl: '/api/uploads/x.png', phone: '70000000', email: 'a@b.co', website: 'https://b.co', address: 'Calle 1', city: 'Sucre' }) });
    const res = await lleno.service.findMine();
    assert.equal(res.logoUrl, '/api/uploads/x.png');
    assert.equal(res.city, 'Sucre');
    const vacio = makeService();
    const sin = await vacio.service.findMine();
    assert.equal(sin.logoUrl ?? null, null);
    assert.equal(sin.phone ?? null, null);
  });

  it('preferencias: se mezclan con lo guardado y NO pisan el resto de configuration', async () => {
    const { service, calls } = makeService({
      found: account({ configuration: { importConfig: { staleAfterDays: 30 }, preferences: { workEnd: '17:00', weekStart: 'SUN' } } }),
    });
    await service.update({ preferences: { workStart: '07:30' } } as never);
    const cfg = calls.updated!.configuration as Record<string, unknown>;
    assert.deepEqual(cfg.importConfig, { staleAfterDays: 30 }, 'lo que ya vivía en configuration se conserva');
    assert.deepEqual(cfg.preferences, {
      workDays: [1, 2, 3, 4, 5, 6],
      workStart: '07:30',
      workEnd: '17:00',
      weekStart: 'SUN',
      defaultLocale: 'es',
    });
  });

  it('🔴 un parche válido por campo pero incoherente en conjunto se rechaza y no escribe nada', async () => {
    // Guardado: jornada 08:00–18:00. Un parche con inicio 19:00 deja el fin antes que el inicio.
    const { service, calls } = makeService();
    await rejectsWithCode(service.update({ preferences: { workStart: '19:00' } } as never), 'PREFERENCES_INVALID');
    assert.equal(calls.updated, undefined);
    assert.deepEqual(calls.audit, []);
  });

  it('sin preferencias en el parche, configuration no se toca', async () => {
    const { service, calls } = makeService();
    await service.update({ businessName: 'X' });
    assert.equal('configuration' in calls.updated!, false);
  });

  it('findMine siempre entrega preferencias completas, con los valores de fábrica si nunca se configuraron', async () => {
    const { service } = makeService();
    const res = await service.findMine();
    assert.deepEqual(res.preferences, { workDays: [1, 2, 3, 4, 5, 6], workStart: '08:00', workEnd: '18:00', weekStart: 'MON', defaultLocale: 'es' });
  });

  it('facturación: se mezcla campo a campo, null quita, y conserva preferencias y el resto de configuration', async () => {
    const { service, calls } = makeService({
      found: account({
        configuration: {
          importConfig: { staleAfterDays: 30 },
          preferences: { workEnd: '17:00' },
          billing: { legalName: 'Pérez SRL', taxId: '123', address: 'Calle 1', email: 'f@pe.co' },
        },
      }),
    });
    await service.update({ billing: { taxId: null, email: 'facturas@pe.co' } } as never);
    const cfg = calls.updated!.configuration as Record<string, unknown>;
    assert.deepEqual(cfg.billing, { legalName: 'Pérez SRL', taxId: null, address: 'Calle 1', email: 'facturas@pe.co' });
    assert.deepEqual(cfg.importConfig, { staleAfterDays: 30 });
    assert.deepEqual(cfg.preferences, { workEnd: '17:00' }, 'sin parche de preferencias, no se tocan');
  });

  it('findMine entrega la facturación completa, con null en lo no cargado', async () => {
    const { service } = makeService();
    assert.deepEqual((await service.findMine()).billing, { legalName: null, taxId: null, address: null, email: null });
  });

  it('nunca escribe plan, topes negociados, tipo ni estado', async () => {
    const { service, calls } = makeService();
    await service.update({ businessName: 'X' });
    for (const prohibido of ['planCode', 'limitsOverride', 'accountType', 'status']) {
      assert.equal(prohibido in calls.updated!, false, `${prohibido} no se puede escribir desde el producto`);
    }
  });

  it('los decimales van a settings numerizados y SIN pisar lo que ya vivía ahí', async () => {
    // `settings` también guarda trialEndsAt y planAlerts: pisarlo entero borraría la prueba.
    const { service, calls } = makeService({ found: account({ settings: { trialEndsAt: '2026-09-01' } }) });
    await service.update({ currencyDecimals: '0' } as never);
    assert.deepEqual(calls.updated!.settings, { trialEndsAt: '2026-09-01', currencyDecimals: 0 });
  });

  it('sin la preferencia guardada, la cuenta dice 2: el default es el comportamiento de siempre', async () => {
    const { service } = makeService();
    assert.equal((await service.findMine()).currencyDecimals, 2);
  });
});

// ── F15 · P1 · espacio de trabajo ────────────────────────────────────────────────────────────────────────────────────

/** Un documento `workspace` tal como lo manda la web: la `rev` que leyó y lo que quiere. */
const wsInput = (rev: number, hiddenModules: string[] = [], options: Record<string, unknown> = {}) => ({ version: 1, rev, hiddenModules, options });
const stored = (rev: number, hiddenModules: string[] = [], options: Record<string, unknown> = {}) => ({ workspace: { version: 1, rev, hiddenModules, options } });

describe('AccountsService.update · espacio de trabajo (F15 · P1)', () => {
  it('🔴 C-12: un PATCH con SOLO `workspace` se guarda (no se descarta en silencio) y sube el `rev`', async () => {
    const { service, calls } = makeService({ members: 1 });
    await service.update({ workspace: wsInput(0, ['routes'], { 'client.income': false }) } as never);
    const cfg = calls.updated!.configuration as Record<string, unknown>;
    assert.deepEqual(cfg.workspace, { version: 1, rev: 1, hiddenModules: ['routes'], options: { 'client.income': false } });
  });

  it('no pisa el resto de `configuration` (importación, preferencias, facturación)', async () => {
    const { service, calls } = makeService({
      members: 1,
      found: account({ configuration: { importConfig: { staleAfterDays: 30 }, preferences: { workEnd: '17:00' }, billing: { legalName: 'Pérez SRL' } } }),
    });
    await service.update({ workspace: wsInput(0, ['export']) } as never);
    const cfg = calls.updated!.configuration as Record<string, unknown>;
    assert.deepEqual(cfg.importConfig, { staleAfterDays: 30 });
    assert.deepEqual(cfg.preferences, { workEnd: '17:00' });
    assert.deepEqual(cfg.billing, { legalName: 'Pérez SRL' });
    assert.deepEqual((cfg.workspace as { hiddenModules: string[] }).hiddenModules, ['export']);
  });

  it('reemplaza el subárbol completo: lo que no viene en el documento nuevo desaparece', async () => {
    const { service, calls } = makeService({ members: 1, found: account({ configuration: stored(3, ['routes', 'export'], { 'client.gender': false }) }) });
    await service.update({ workspace: wsInput(3, ['routes']) } as never);
    const cfg = calls.updated!.configuration as { workspace: unknown };
    assert.deepEqual(cfg.workspace, { version: 1, rev: 4, hiddenModules: ['routes'], options: {} });
  });

  it('🔴 A-16: dos guardados con el mismo `rev` → el segundo recibe 409 y no escribe nada', async () => {
    const { service, calls } = makeService({ members: 1, found: account({ configuration: stored(1, ['routes']) }) });
    await rejectsWithCode(service.update({ workspace: wsInput(0, ['export']) } as never), 'WORKSPACE_CONFLICT');
    assert.equal(calls.updated, undefined);
    assert.deepEqual(calls.audit, []);
  });

  it('el documento se lee y se escribe con la fila de ESTA cuenta bloqueada (A-8)', async () => {
    const { service, calls } = makeService({ members: 1 });
    await service.update({ workspace: wsInput(0) } as never);
    assert.deepEqual(calls.locked, [['acc-A']]);
  });

  it('un parche que no toca `configuration` (datos del negocio) no bloquea la fila', async () => {
    const { service, calls } = makeService();
    await service.update({ businessName: 'X' });
    assert.deepEqual(calls.locked, []);
  });

  it('🔴 G6 · hallazgo 1: guardar preferencias o facturación (que reescriben `configuration` entera) también bloquea la fila, para no pisar un workspace guardado en paralelo', async () => {
    const a = makeService();
    await a.service.update({ preferences: { workStart: '07:30' } } as never);
    assert.deepEqual(a.calls.locked, [['acc-A']]);
    const b = makeService();
    await b.service.update({ billing: { legalName: 'Pérez SRL' } } as never);
    assert.deepEqual(b.calls.locked, [['acc-A']]);
  });

  it('una versión guardada MÁS NUEVA que la que esta API entiende no se pisa (409), y el aviso dice que recargar no lo arregla', async () => {
    const { service, calls } = makeService({ members: 1, found: account({ configuration: { workspace: { version: 2, rev: 5, hiddenModules: [], options: {} } } }) });
    await assert.rejects(service.update({ workspace: wsInput(0) } as never), (err: unknown) => {
      const body = (err as { getResponse: () => { code: string; details: { reason: string; currentRev: number | null; storedVersion: number } } }).getResponse();
      assert.equal(body.code, 'WORKSPACE_CONFLICT');
      assert.deepEqual(body.details, { currentRev: null, reason: 'VERSION', storedVersion: 2 });
      return true;
    });
    assert.equal(calls.updated, undefined);
  });

  it('un conflicto por `rev` informa el rev vigente para que la pantalla recargue', async () => {
    const { service } = makeService({ members: 1, found: account({ configuration: stored(4) }) });
    await assert.rejects(service.update({ workspace: wsInput(1) } as never), (err: unknown) => {
      const body = (err as { getResponse: () => { details: { reason: string; currentRev: number } } }).getResponse();
      assert.deepEqual(body.details, { currentRev: 4, reason: 'REV', storedVersion: null });
      return true;
    });
  });

  it('G6 · hallazgo 6: un documento con demasiados módulos u opciones se rechaza (422) sin recorrerlo', async () => {
    const muchas = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, false]));
    await rejectsWithCode(makeService({ members: 1 }).service.update({ workspace: wsInput(0, [], muchas) } as never), 'WORKSPACE_INVALID');
  });

  it('🔴 A-3: lo que no cumple el contrato → 422 y no se guarda nada', async () => {
    for (const bad of [
      wsInput(0, ['portfolio']), // troncal
      wsInput(0, ['accessSecurity']), // D-8: Seguridad es troncal
      wsInput(0, ['inventado']),
      wsInput(0, [], { 'client.phone': false }),
      wsInput(0, [], { 'client.income': true }),
      wsInput(0, [], { 'credit.frequencies': [] }),
      { ...wsInput(0), version: 2 },
    ]) {
      const { service, calls } = makeService({ members: 1 });
      await rejectsWithCode(service.update({ workspace: bad } as never), 'WORKSPACE_INVALID');
      assert.equal(calls.updated, undefined, JSON.stringify(bad));
      assert.deepEqual(calls.audit, []);
    }
  });

  it('S-1: Equipo no se oculta con más de una persona (cuenta también las invitaciones pendientes)', async () => {
    const { service, calls } = makeService({ members: 3 });
    await rejectsWithCode(service.update({ workspace: wsInput(0, ['team']) } as never), 'WORKSPACE_BLOCKED');
    assert.equal(calls.updated, undefined);
  });

  it('S-1: con una sola persona, Equipo sí se oculta', async () => {
    const { service, calls } = makeService({ members: 1 });
    await service.update({ workspace: wsInput(0, ['team']) } as never);
    assert.deepEqual((calls.updated!.configuration as { workspace: { hiddenModules: string[] } }).workspace.hiddenModules, ['team']);
  });

  it('S-7 (D-9): Actividad solo se oculta con una única persona', async () => {
    await rejectsWithCode(makeService({ members: 2 }).service.update({ workspace: wsInput(0, ['activity']) } as never), 'WORKSPACE_BLOCKED');
    const ok = makeService({ members: 1 });
    await ok.service.update({ workspace: wsInput(0, ['activity']) } as never);
    assert.ok(ok.calls.updated);
  });

  it('S-2: Organización no se oculta con más de una oficina activa', async () => {
    await rejectsWithCode(makeService({ members: 1, offices: 2 }).service.update({ workspace: wsInput(0, ['organization']) } as never), 'WORKSPACE_BLOCKED');
    const ok = makeService({ members: 1, offices: 1 });
    await ok.service.update({ workspace: wsInput(0, ['organization']) } as never);
    assert.ok(ok.calls.updated);
  });

  it('S-3: Rutas no se oculta con rutas en curso (el conteo es de la CUENTA)', async () => {
    const blocked = makeService({ members: 1, routesInProgress: 2 });
    await rejectsWithCode(blocked.service.update({ workspace: wsInput(0, ['routes']) } as never), 'WORKSPACE_BLOCKED');
    assert.deepEqual(blocked.calls.routeWhere, { accountId: 'acc-A', status: 'IN_PROGRESS' });
    const ok = makeService({ members: 1, routesInProgress: 0 });
    await ok.service.update({ workspace: wsInput(0, ['routes']) } as never);
    assert.ok(ok.calls.updated);
  });

  it('las salvaguardas miran solo lo que se oculta AHORA: lo que ya estaba oculto no bloquea otro cambio', async () => {
    const { service, calls } = makeService({ members: 3, found: account({ configuration: stored(2, ['team']) }) });
    await service.update({ workspace: wsInput(2, ['team', 'export']) } as never);
    assert.deepEqual((calls.updated!.configuration as { workspace: { hiddenModules: string[] } }).workspace.hiddenModules, ['export', 'team']);
  });

  it('volver a mostrar un módulo nunca lo bloquea', async () => {
    const { service, calls } = makeService({ members: 5, offices: 4, routesInProgress: 9, found: account({ configuration: stored(1, ['team', 'organization', 'routes']) }) });
    await service.update({ workspace: wsInput(1) } as never);
    assert.deepEqual((calls.updated!.configuration as { workspace: { hiddenModules: string[] } }).workspace.hiddenModules, []);
  });

  it('el motivo del bloqueo trae el conteo (solo lo recibe quien tiene account:write)', async () => {
    const { service } = makeService({ members: 4 });
    await assert.rejects(service.update({ workspace: wsInput(0, ['team']) } as never), (err: unknown) => {
      const body = (err as { getResponse: () => { details: { blocks: { module: string; reason: string; count: number }[] } } }).getResponse();
      assert.deepEqual(body.details.blocks, [{ module: 'team', reason: 'MEMBERS', count: 4 }]);
      return true;
    });
  });

  it('🔴 A-7 / C-13: se audita SOLO el subárbol `workspace` (quién, cuándo y qué), no la fila de la cuenta', async () => {
    const { service, calls } = makeService({ members: 1, found: account({ taxId: '999', configuration: { billing: { legalName: 'Pérez SRL' }, ...stored(0) } }) });
    await service.update({ workspace: wsInput(0, ['routes']) } as never);
    assert.equal(calls.auditEntries.length, 1);
    const [entry] = calls.auditEntries;
    assert.equal(entry.entity, 'account');
    assert.equal(entry.action, 'UPDATE');
    assert.deepEqual(entry.before, { workspace: { version: 1, rev: 0, hiddenModules: [], options: {} } });
    assert.deepEqual(entry.after, { workspace: { version: 1, rev: 1, hiddenModules: ['routes'], options: {} } });
    assert.ok(!JSON.stringify(entry).includes('Pérez SRL'), 'la facturación no se copia a la bitácora');
    assert.ok(!JSON.stringify(entry).includes('999'), 'el NIT tampoco');
  });

  it('un parche mixto (datos del negocio + workspace) deja las dos entradas de auditoría', async () => {
    const { service, calls } = makeService({ members: 1 });
    await service.update({ businessName: 'Nuevo nombre', workspace: wsInput(0, ['export']) } as never);
    assert.equal(calls.auditEntries.length, 2);
  });

  it('S-6: ocultar módulos no cambia los topes del plan', async () => {
    const { service } = makeService({ members: 1 });
    const res = await service.update({ workspace: wsInput(0, ['routes', 'team']) } as never);
    assert.deepEqual(res.limits, effectiveLimits('PROFESSIONAL', null));
  });

  it('findMine entrega el workspace con su `rev` (para el siguiente guardado) y «Completo» si nunca se configuró', async () => {
    const nunca = await makeService().service.findMine();
    assert.deepEqual(nunca.workspace, { version: 1, rev: 0, hiddenModules: [], options: {} });
    const con = await makeService({ found: account({ configuration: stored(7, ['export'], { 'client.taxId': false }) }) }).service.findMine();
    assert.deepEqual(con.workspace, { version: 1, rev: 7, hiddenModules: ['export'], options: { 'client.taxId': false } });
  });

  it('H-15: un workspace malformado guardado a mano se sirve como «Completo», sin romper la lectura', async () => {
    const res = await makeService({ found: account({ configuration: { workspace: { version: 1, rev: 'x', hiddenModules: 'routes', options: 5 } } }) }).service.findMine();
    assert.deepEqual(res.workspace, { version: 1, rev: 0, hiddenModules: [], options: {} });
  });
});
