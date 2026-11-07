/**
 * F14 · F2b — la segunda barrera de RLS (alcance dentro de la empresa), de punta a punta.
 *
 * Postgres y Redis reales (base `kobrax_it`). Las consultas de la primera parte son CRUDAS, con el rol `kobrax_app` y fijando a mano
 * `app.scope` / `app.scope_mode`: no pasan por `moraAccessConditions` ni por ningún helper de la app, que es exactamente lo que la
 * barrera debe cubrir cuando una consulta olvida su filtro. La segunda parte levanta la API con `SCOPE_RLS_MODE=enforce` y comprueba
 * que lo legítimo no cambia (incluida la cuenta gratuita individual).
 *
 *   Banco › Chuquisaca › {Mesa Verde, Padilla};  La Paz › El Alto
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { addMember, API, appDb, call, db, freshDatabase, login, loginSkippingMfa, postgresLogSince, startApi, stopApi } from './harness';

interface Office {
  id: string;
  isRoot: boolean;
}
interface BranchType {
  id: string;
  code: string;
}
type Mode = 'off' | 'log' | 'enforce';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let app: PrismaClient;
let banco: { accountId: string; admin: string; root: Office };
let indiv: { accountId: string; admin: string; clientId: string };
const off: Record<string, Office> = {};
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
/** etiqueta → ids sembrados. */
const seed: Record<string, { clientId: string; creditId: string }> = {};
const paymentOf: Record<string, string> = {};
const agendaOf: Record<string, string> = {};
const routeOf: Record<string, string> = {};
let cNone = '';

async function signup(businessName: string): Promise<{ accountId: string; admin: string }> {
  const email = `${businessName.toLowerCase().replace(/\W+/g, '-')}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, firstName: 'Dueño', lastName: businessName, email, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  return { accountId: owner.userAccounts[0]!.accountId, admin: await loginSkippingMfa(email) };
}

async function member(key: string, role: string, office: Office): Promise<void> {
  const email = `${key.toLowerCase()}-${suffix}@ejemplo.com`;
  uid[key] = await addMember(prisma, banco.accountId, email, key, role);
  const r = await call(banco.admin, 'POST', `/branches/${office.id}/members`, { userIds: [uid[key]] });
  assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.error)}`);
  tok[key] = await login(email);
}

/** Un cliente con un crédito (más un pago y un ítem de agenda) en `office` a cargo de `responsible`. */
async function plant(label: string, office: Office, responsible: string): Promise<void> {
  const client = await prisma.client.create({
    data: { accountId: banco.accountId, clientType: 'PERSON', firstName: label, lastName: 'Deudor', registeredBranchId: office.id },
  });
  const credit = await prisma.credit.create({
    data: {
      accountId: banco.accountId,
      clientId: client.id,
      branchId: office.id,
      code: `C-${label}-${suffix}`,
      principalAmount: 100,
      outstandingBalance: 100,
      currency: 'BOB',
      daysPastDue: 10,
      assignedManagerId: uid[responsible]!,
    },
  });
  seed[label] = { clientId: client.id, creditId: credit.id };
  paymentOf[label] = (
    await prisma.payment.create({ data: { accountId: banco.accountId, creditId: credit.id, branchId: office.id, amount: 10, method: 'CASH', registeredBy: uid[responsible]! } })
  ).id;
  agendaOf[label] = (
    await prisma.agendaItem.create({
      data: { accountId: banco.accountId, clientId: client.id, creditId: credit.id, assigneeId: uid[responsible]!, type: 'VISIT', scheduledDate: new Date('2026-12-01') },
    })
  ).id;
}

/** Corre `fn` como `kobrax_app` con el alcance y el modo pedidos, exactamente como lo hace `PrismaService.runScoped`. */
async function asScope<T>(accountId: string, userId: string, scope: string, mode: Mode, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.current_account_id', ${accountId}, true), set_config('app.current_user_id', ${userId}, true),
                              set_config('app.scope', ${scope}, true), set_config('app.scope_mode', ${mode}, true)`;
    // Igual que `PrismaService.runScoped`: las policies de alcance son del rol `kobrax_scoped`, al que sólo cambia quien tiene alcance
    // restringido (o vacío) y la barrera no está apagada. `account` / `system` / `off` siguen como `kobrax_app`, sin policy.
    if (mode !== 'off' && scope !== 'account' && scope !== 'system') await tx.$executeRaw`SET LOCAL ROLE kobrax_scoped`;
    return fn(tx as unknown as PrismaClient);
  });
}

const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id).sort();
const sorted = (xs: string[]): string[] => [...xs].sort();

interface Seen {
  credits: string[];
  clients: string[];
  payments: string[];
  agenda: string[];
  routes: string[];
}
async function seen(userKey: string, scope: string, mode: Mode): Promise<Seen> {
  return asScope(banco.accountId, uid[userKey]!, scope, mode, async (tx) => ({
    credits: ids(await tx.credit.findMany({ select: { id: true } })),
    clients: ids(await tx.client.findMany({ select: { id: true } })),
    payments: ids(await tx.payment.findMany({ select: { id: true } })),
    agenda: ids(await tx.agendaItem.findMany({ select: { id: true } })),
    routes: ids(await tx.routePlan.findMany({ select: { id: true } })),
  }));
}

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', SCOPE_RLS_MODE: 'enforce' });
  prisma = db();
  app = appDb();

  const b = await signup('Banco Sur');
  await prisma.account.update({ where: { id: b.accountId }, data: { planCode: 'PROFESSIONAL', limitsOverride: { branches: 30, users: 60, credits: 500, clients: 500 } } });
  const types = (await call<BranchType[]>(b.admin, 'GET', '/branch-types')).data!;
  const agencia = types.find((t) => t.code === 'AGENCIA')!.id;
  const regional = types.find((t) => t.code === 'REGIONAL')!.id;
  const root = ((await call<Office[]>(b.admin, 'GET', '/branches')).data ?? []).find((o) => o.isRoot)!;
  banco = { accountId: b.accountId, admin: b.admin, root };
  const mk = async (name: string, parent: Office, typeId: string, code?: string): Promise<Office> => {
    const r = await call<Office>(b.admin, 'POST', '/branches', { name, parentId: parent.id, typeId, ...(code ? { code } : {}) });
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.error)}`);
    return r.data!;
  };
  off.LPZ = await mk('La Paz', root, regional);
  off.CHQ = await mk('Chuquisaca', root, regional);
  off.ALT = await mk('El Alto', off.LPZ!, agencia, 'ALT');
  off.MV = await mk('Mesa Verde', off.CHQ!, agencia, 'MV');
  off.PAD = await mk('Padilla', off.CHQ!, agencia, 'PAD');

  await member('supMV', 'SUPERVISOR', off.MV!);
  await member('colMV', 'COLLECTOR', off.MV!);
  await member('colPAD', 'COLLECTOR', off.PAD!);
  await member('colALT', 'COLLECTOR', off.ALT!);
  await member('mgrChq', 'MANAGER', off.CHQ!);
  await member('mgrRaiz', 'MANAGER', root);

  await plant('MV', off.MV!, 'colMV');
  await plant('PAD', off.PAD!, 'colPAD');
  await plant('ALT', off.ALT!, 'colALT');
  // Un cliente registrado en Mesa Verde que todavía no tiene créditos (se ve por su oficina de registro).
  cNone = (await prisma.client.create({ data: { accountId: banco.accountId, clientType: 'PERSON', firstName: 'SinCredito', lastName: 'Deudor', registeredBranchId: off.MV!.id } })).id;
  // Rutas: la de colMV y la de colPAD (la barrera sólo acota el alcance `own`, como la API).
  for (const k of ['colMV', 'colPAD']) {
    routeOf[k] = (await prisma.routePlan.create({ data: { accountId: banco.accountId, collectorId: uid[k]!, plannedDate: new Date('2026-12-01'), createdBy: uid.supMV! } })).id;
  }

  const ind = await signup('Cobranzas Don Pedro');
  const ic = await prisma.client.create({ data: { accountId: ind.accountId, clientType: 'PERSON', firstName: 'Ajeno', lastName: 'Individual' } });
  indiv = { ...ind, clientId: ic.id };
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
  await app?.$disconnect();
});

const all = (): Seen => ({
  credits: sorted(['MV', 'PAD', 'ALT'].map((k) => seed[k]!.creditId)),
  clients: sorted([...['MV', 'PAD', 'ALT'].map((k) => seed[k]!.clientId), cNone]),
  payments: sorted(['MV', 'PAD', 'ALT'].map((k) => paymentOf[k]!)),
  agenda: sorted(['MV', 'PAD', 'ALT'].map((k) => agendaOf[k]!)),
  routes: sorted([routeOf.colMV!, routeOf.colPAD!]),
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F2b · consulta CRUDA como kobrax_app: la base acota por alcance en `enforce`', () => {
  it('🔴 cobrador (own): sólo lo suyo; de las rutas, las suyas', async () => {
    const s = await seen('colMV', 'own', 'enforce');
    assert.deepEqual(s, {
      credits: [seed.MV!.creditId],
      clients: [seed.MV!.clientId],
      payments: [paymentOf.MV!],
      agenda: [agendaOf.MV!],
      routes: [routeOf.colMV!],
    });
  });

  it('🔴 supervisor (branch): su oficina (créditos, pagos, agenda y clientes por oficina de registro); las rutas, como la API: todas', async () => {
    const s = await seen('supMV', 'branch', 'enforce');
    assert.deepEqual(s.credits, [seed.MV!.creditId]);
    assert.deepEqual(s.clients, sorted([seed.MV!.clientId, cNone]));
    assert.deepEqual(s.payments, [paymentOf.MV!]);
    assert.deepEqual(s.agenda, [agendaOf.MV!]);
    assert.deepEqual(s.routes, all().routes);
  });

  it('🔴 gerente regional (subtree): su subárbol, no el de otra regional', async () => {
    const s = await seen('mgrChq', 'subtree', 'enforce');
    assert.deepEqual(s.credits, sorted([seed.MV!.creditId, seed.PAD!.creditId]));
    assert.deepEqual(s.clients, sorted([seed.MV!.clientId, seed.PAD!.clientId, cNone]));
    assert.deepEqual(s.payments, sorted([paymentOf.MV!, paymentOf.PAD!]));
    assert.ok(!s.credits.includes(seed.ALT!.creditId), 'El Alto es de La Paz, no del subárbol de Chuquisaca');
  });

  it('el gerente de la raíz (subtree), el administrador (account) y el sistema ven todo', async () => {
    assert.deepEqual(await seen('mgrRaiz', 'subtree', 'enforce'), all());
    assert.deepEqual(await seen('mgrRaiz', 'account', 'enforce'), all());
    assert.deepEqual(await seen('mgrRaiz', 'system', 'enforce'), all());
  });

  it('🔴 fail-closed: sin alcance (variable vacía) no se ve NADA de las cinco tablas', async () => {
    const s = await seen('colMV', '', 'enforce');
    assert.deepEqual(s, { credits: [], clients: [], payments: [], agenda: [], routes: [] });
  });

  it('🔴 una consulta que OLVIDA el filtro (SELECT sin WHERE) no filtra datos de otra oficina ni de otra empresa', async () => {
    const s = await seen('colPAD', 'own', 'enforce');
    assert.ok(!s.credits.includes(seed.MV!.creditId), 'el crédito de Mesa Verde no se filtra');
    // otra empresa: el tenant lo corta aunque el alcance sea `system`
    const otra = await asScope(indiv.accountId, uid.mgrRaiz!, 'system', 'enforce', (tx) => tx.client.findMany({ select: { id: true } }));
    assert.deepEqual(ids(otra), [indiv.clientId]);
  });

  it('🔴 UPDATE y DELETE sobre filas fuera del alcance afectan 0 filas', async () => {
    const r = await asScope(banco.accountId, uid.colMV!, 'own', 'enforce', async (tx) => ({
      upd: await tx.credit.updateMany({ where: { id: seed.PAD!.creditId }, data: { daysPastDue: 99 } }),
      del: await tx.agendaItem.deleteMany({ where: { id: agendaOf.PAD! } }),
    }));
    assert.equal(r.upd.count, 0);
    assert.equal(r.del.count, 0);
    const still = await prisma.credit.findUniqueOrThrow({ where: { id: seed.PAD!.creditId } });
    assert.equal(still.daysPastDue, 10);
  });

  it('un INSERT … RETURNING de lo propio se lee de vuelta (la fila nueva es visible para quien la crea)', async () => {
    const made = await asScope(banco.accountId, uid.colMV!, 'own', 'enforce', (tx) =>
      tx.credit.create({
        data: { accountId: banco.accountId, clientId: seed.MV!.clientId, branchId: off.MV!.id, code: `C-RET-${suffix}`, principalAmount: 5, outstandingBalance: 5, currency: 'BOB', assignedManagerId: uid.colMV! },
        select: { id: true },
      }),
    );
    assert.ok(made.id);
    await prisma.credit.delete({ where: { id: made.id } });
  });

  it('🔴 R-2: los totales del cliente NO cambian cuando un cobrador toca su crédito (los triggers SECURITY DEFINER ven la cuenta entera)', async () => {
    // Un segundo crédito del MISMO cliente, de otra persona (colPAD) que colMV no ve.
    const hidden = await prisma.credit.create({
      data: { accountId: banco.accountId, clientId: seed.MV!.clientId, branchId: off.PAD!.id, code: `C-R2-${suffix}`, principalAmount: 300, outstandingBalance: 300, currency: 'BOB', assignedManagerId: uid.colPAD! },
    });
    const antes = await prisma.client.findUniqueOrThrow({ where: { id: seed.MV!.clientId } });
    await asScope(banco.accountId, uid.colMV!, 'own', 'enforce', (tx) => tx.credit.updateMany({ where: { id: seed.MV!.creditId }, data: { outstandingBalance: 120 } }));
    const despues = await prisma.client.findUniqueOrThrow({ where: { id: seed.MV!.clientId } });
    assert.equal(Number(despues.creditCount), Number(antes.creditCount), 'la cantidad de créditos no se recorta al alcance de quien toca');
    assert.equal(Number(despues.creditCount), 2);
    await asScope(banco.accountId, uid.colMV!, 'own', 'enforce', (tx) => tx.credit.updateMany({ where: { id: seed.MV!.creditId }, data: { outstandingBalance: 100 } }));
    await prisma.credit.delete({ where: { id: hidden.id } });
  });
});

describe('F2b · los tres modos', () => {
  it('`off` y `log` devuelven TODO (la barrera no filtra); sin alcance también', async () => {
    assert.deepEqual(await seen('colMV', 'own', 'off'), all());
    assert.deepEqual(await seen('colMV', 'own', 'log'), all());
    assert.deepEqual((await seen('colMV', '', 'off')).credits, all().credits);
  });

  it('`log` deja pasar pero REGISTRA lo que habría negado; `off` no registra nada', async () => {
    await new Promise((r) => setTimeout(r, 1500)); // el --since de docker es de 1 s: se aleja de las consultas anteriores
    const t0 = new Date().toISOString();
    await seen('colMV', 'own', 'off');
    assert.ok(!postgresLogSince(t0).includes('scope_rls would_deny'), 'en off no se registra');
    await seen('colMV', 'own', 'log');
    const loud = postgresLogSince(t0);
    assert.ok(loud.includes('scope_rls would_deny table=credits'), `en log se registra:\n${loud.slice(-600)}`);
  });
});

describe('F2b · la API con SCOPE_RLS_MODE=enforce no cambia lo legítimo', () => {
  const list = async (t: string): Promise<string[]> => {
    const r = await call<unknown>(t, 'GET', '/credits?limit=100');
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const d = r.data as { items?: { id: string }[] } | { id: string }[];
    return sorted((Array.isArray(d) ? d : (d.items ?? [])).map((c) => c.id));
  };

  it('cada rol ve por la API exactamente lo que le corresponde (cobrador, supervisor, gerente, administrador)', async () => {
    assert.deepEqual(await list(tok.colMV!), [seed.MV!.creditId]);
    assert.deepEqual(await list(tok.supMV!), [seed.MV!.creditId]);
    assert.deepEqual(await list(tok.mgrChq!), sorted([seed.MV!.creditId, seed.PAD!.creditId]));
    assert.deepEqual(await list(banco.admin), all().credits);
  });

  it('🔴 regresión de la cuenta gratuita individual: crea cliente y crédito, los lista, y no ve nada de otra empresa', async () => {
    const c = await call<{ id: string }>(indiv.admin, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Pedro', lastName: 'Cliente' });
    assert.equal(c.status, 201, JSON.stringify(c.error));
    const cr = await call<{ id: string }>(indiv.admin, 'POST', '/credits', { clientId: c.data!.id, principalAmount: 1200, installmentsCount: 12 });
    assert.equal(cr.status, 201, JSON.stringify(cr.error));
    const got = await call<unknown>(indiv.admin, 'GET', '/clients?limit=100');
    assert.equal(got.status, 200);
    const text = JSON.stringify(got.data);
    assert.ok(text.includes(c.data!.id));
    assert.ok(!text.includes(seed.MV!.clientId), 'nada de Banco Sur');
  });

  it('los topes del plan cuentan TODA la cuenta, no lo que ve quien pide (elevated)', async () => {
    const n = await prisma.credit.count({ where: { accountId: banco.accountId, deletedAt: null } });
    assert.ok(n >= 3);
    // Tope = lo que ya hay: aunque el cobrador sólo ve su crédito, el alta debe toparse con el total de la cuenta.
    await prisma.account.update({ where: { id: banco.accountId }, data: { limitsOverride: { branches: 30, users: 60, credits: n, clients: 500 } } });
    const r = await call<{ id: string }>(tok.colMV!, 'POST', '/credits', { clientId: seed.MV!.clientId, principalAmount: 500, installmentsCount: 5 });
    assert.ok(r.status >= 400, `el tope de la cuenta debe frenar el alta (status ${r.status})`);
    await prisma.account.update({ where: { id: banco.accountId }, data: { limitsOverride: { branches: 30, users: 60, credits: 500, clients: 500 } } });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F2b · las copias de oficina y responsable del crédito (triggers) y lo que la barrera hace con ellas', () => {
  interface Copy {
    credit_branch_id: string | null;
    credit_manager_id: string | null;
  }
  const payCopy = async (id: string): Promise<Copy> => (await prisma.$queryRaw<Copy[]>`SELECT credit_branch_id, credit_manager_id FROM payments WHERE id = ${id}`)[0]!;
  const agendaCopy = async (id: string): Promise<Copy> => (await prisma.$queryRaw<Copy[]>`SELECT credit_branch_id, credit_manager_id FROM agenda_items WHERE id = ${id}`)[0]!;
  const clientCopy = async (id: string) =>
    (await prisma.$queryRaw<{ m: string[]; b: string[]; n: number }[]>`SELECT scope_manager_ids m, scope_branch_ids b, credit_count n FROM clients WHERE id = ${id}`)[0]!;

  it('al nacer, el pago y la agenda copian la oficina y el responsable de su crédito (aunque el INSERT traiga otra cosa)', async () => {
    assert.deepEqual(await payCopy(paymentOf.MV!), { credit_branch_id: off.MV!.id, credit_manager_id: uid.colMV! });
    assert.deepEqual(await agendaCopy(agendaOf.MV!), { credit_branch_id: off.MV!.id, credit_manager_id: uid.colMV! });
    const p = await prisma.payment.create({
      data: { accountId: banco.accountId, creditId: seed.MV!.creditId, branchId: off.PAD!.id, amount: 5, method: 'CASH', registeredBy: uid.colMV!, creditBranchId: 'trucho', creditManagerId: 'trucho' },
    });
    assert.deepEqual(await payCopy(p.id), { credit_branch_id: off.MV!.id, credit_manager_id: uid.colMV! }, 'el trigger pisa lo que traiga el INSERT: la copia no se puede falsear');
    await prisma.payment.delete({ where: { id: p.id } });
  });

  it('🔴 al reasignar el crédito (oficina y responsable), se mueven sus pagos, su agenda y el cliente, y la barrera lo refleja', async () => {
    assert.deepEqual(await clientCopy(seed.MV!.clientId), { m: [uid.colMV!], b: [off.MV!.id], n: 1 });
    await prisma.credit.update({ where: { id: seed.MV!.creditId }, data: { branchId: off.PAD!.id, assignedManagerId: uid.colPAD! } });
    try {
      assert.deepEqual(await payCopy(paymentOf.MV!), { credit_branch_id: off.PAD!.id, credit_manager_id: uid.colPAD! });
      assert.deepEqual(await agendaCopy(agendaOf.MV!), { credit_branch_id: off.PAD!.id, credit_manager_id: uid.colPAD! });
      assert.deepEqual(await clientCopy(seed.MV!.clientId), { m: [uid.colPAD!], b: [off.PAD!.id], n: 1 });
      // La barrera (enforce, cruda): colPAD (own) ahora ve ese pago y ese cliente; colMV (own) ya no.
      const pad = await seen('colPAD', 'own', 'enforce');
      const mv = await seen('colMV', 'own', 'enforce');
      assert.ok(pad.payments.includes(paymentOf.MV!) && pad.clients.includes(seed.MV!.clientId) && pad.agenda.includes(agendaOf.MV!));
      assert.ok(!mv.payments.includes(paymentOf.MV!) && !mv.clients.includes(seed.MV!.clientId));
      assert.ok(mv.agenda.includes(agendaOf.MV!), 'la tarea sigue ASIGNADA a colMV: se ve por eso, no por el crédito (igual que la API)');
      // El supervisor de Mesa Verde (branch) pierde el crédito, su pago y su agenda; sigue viendo al cliente por su oficina de registro.
      const sup = await seen('supMV', 'branch', 'enforce');
      assert.ok(!sup.credits.includes(seed.MV!.creditId) && !sup.payments.includes(paymentOf.MV!) && !sup.agenda.includes(agendaOf.MV!));
      assert.ok(sup.clients.includes(seed.MV!.clientId), 'el cliente sigue registrado en Mesa Verde');
    } finally {
      await prisma.credit.update({ where: { id: seed.MV!.creditId }, data: { branchId: off.MV!.id, assignedManagerId: uid.colMV! } });
    }
    assert.deepEqual(await payCopy(paymentOf.MV!), { credit_branch_id: off.MV!.id, credit_manager_id: uid.colMV! }, 'y al volver, vuelve');
    assert.deepEqual(await clientCopy(seed.MV!.clientId), { m: [uid.colMV!], b: [off.MV!.id], n: 1 });
  });

  it('dar de baja el crédito saca al cliente de las copias (y de la vista del cobrador); restaurarlo lo devuelve', async () => {
    await prisma.credit.update({ where: { id: seed.PAD!.creditId }, data: { deletedAt: new Date() } });
    try {
      assert.deepEqual(await clientCopy(seed.PAD!.clientId), { m: [], b: [], n: 0 });
      // Los pagos y la agenda de un crédito dado de baja quedan sin copia: dejan de verse por el crédito (como con la barrera anterior).
      assert.deepEqual(await payCopy(paymentOf.PAD!), { credit_branch_id: null, credit_manager_id: null });
      assert.deepEqual(await agendaCopy(agendaOf.PAD!), { credit_branch_id: null, credit_manager_id: null });
      const pad = await seen('colPAD', 'own', 'enforce');
      assert.ok(!pad.clients.includes(seed.PAD!.clientId), 'sin crédito vivo y sin ser quien lo dio de alta, el cobrador ya no lo ve');
      assert.ok(!pad.payments.includes(paymentOf.PAD!), 'el pago de un crédito dado de baja deja de verse');
      const supPad = await seen('mgrChq', 'subtree', 'enforce');
      assert.ok(!supPad.payments.includes(paymentOf.PAD!), 'tampoco por oficina / subárbol');
    } finally {
      await prisma.credit.update({ where: { id: seed.PAD!.creditId }, data: { deletedAt: null } });
    }
    assert.deepEqual(await clientCopy(seed.PAD!.clientId), { m: [uid.colPAD!], b: [off.PAD!.id], n: 1 });
    assert.deepEqual(await payCopy(paymentOf.PAD!), { credit_branch_id: off.PAD!.id, credit_manager_id: uid.colPAD! }, 'al restaurar, vuelve la copia');
    assert.ok((await seen('colPAD', 'own', 'enforce')).payments.includes(paymentOf.PAD!));
  });

  it('🔴 R-2: si un SUPERVISOR reasigna un crédito de su oficina, las copias del cliente cuentan también los créditos que él NO ve (SECURITY DEFINER)', async () => {
    // Un segundo crédito del mismo cliente, a cargo de colPAD en Padilla: colMV (own) no lo ve.
    const extra = await prisma.credit.create({
      data: {
        accountId: banco.accountId, clientId: seed.MV!.clientId, branchId: off.PAD!.id, code: `X-${suffix}`, principalAmount: 50, outstandingBalance: 50, currency: 'BOB', assignedManagerId: uid.colPAD!,
      },
    });
    try {
      assert.deepEqual((await clientCopy(seed.MV!.clientId)).m, sorted([uid.colMV!, uid.colPAD!]));
      // supMV (alcance branch, enforce) pasa el crédito de su oficina a colALT: el UPDATE corre con su alcance chico y no ve el crédito de Padilla.
      // (Reasignar a alguien fuera del propio alcance sería rechazado por la base: la fila nueva tampoco sería visible. Es lo esperado.)
      await asScope(banco.accountId, uid.supMV!, 'branch', 'enforce', (tx) => tx.credit.update({ where: { id: seed.MV!.creditId }, data: { assignedManagerId: uid.colALT! } }));
      const c = await clientCopy(seed.MV!.clientId);
      assert.deepEqual(c.m, sorted([uid.colALT!, uid.colPAD!]), 'el recálculo vio el crédito de colPAD aunque quien disparó el trigger no lo ve');
      assert.equal(c.n, 2);
    } finally {
      await prisma.credit.update({ where: { id: seed.MV!.creditId }, data: { assignedManagerId: uid.colMV! } });
      await prisma.credit.delete({ where: { id: extra.id } });
    }
    assert.deepEqual(await clientCopy(seed.MV!.clientId), { m: [uid.colMV!], b: [off.MV!.id], n: 1 });
  });

  it('las copias coinciden con la verdad en toda la base (lo mismo que comprueba `verify_scope.sql`)', async () => {
    const bad = await prisma.$queryRaw<{ t: string; n: bigint }[]>`
      SELECT 'payments' t, count(*) n FROM payments p JOIN credits c ON c.id = p.credit_id
        WHERE p.credit_branch_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.branch_id END)
           OR p.credit_manager_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.assigned_manager_id END)
      UNION ALL
      SELECT 'agenda_items', count(*) FROM agenda_items a JOIN credits c ON c.id = a.credit_id
        WHERE a.credit_branch_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.branch_id END)
           OR a.credit_manager_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.assigned_manager_id END)
      UNION ALL
      SELECT 'clients', count(*) FROM clients cl
        WHERE cl.scope_manager_ids IS DISTINCT FROM COALESCE((SELECT array_agg(DISTINCT assigned_manager_id ORDER BY assigned_manager_id) FROM credits c WHERE c.client_id = cl.id AND c.deleted_at IS NULL AND c.assigned_manager_id IS NOT NULL), '{}')
           OR cl.scope_branch_ids IS DISTINCT FROM COALESCE((SELECT array_agg(DISTINCT branch_id ORDER BY branch_id) FROM credits c WHERE c.client_id = cl.id AND c.deleted_at IS NULL AND c.branch_id IS NOT NULL), '{}')`;
    for (const r of bad) assert.equal(Number(r.n), 0, `${r.t}: copias desalineadas`);
  });
});

describe('F2b · mora a mano: un cobrador sólo marca / pone al día lo que ve (F2b-H1)', () => {
  it('🔴 el cobrador de Padilla no puede marcar ni poner al día un crédito de Mesa Verde (404)', async () => {
    const mark = await call(tok.colPAD!, 'POST', `/credits/${seed.MV!.creditId}/arrears`, { days: 5 });
    assert.equal(mark.status, 404, JSON.stringify(mark.error));
    const clear = await call(tok.colPAD!, 'POST', `/credits/${seed.MV!.creditId}/arrears/clear`, { mode: 'none' });
    assert.equal(clear.status, 404, JSON.stringify(clear.error));
  });
});

describe('F2b · la barrera vive en el rol `kobrax_scoped`', () => {
  it('🔴 `kobrax_app` NO hereda el rol: sin cambiar de rol no hay policy de alcance (costo cero para cuenta / sistema / off); con SET ROLE sí', async () => {
    const count = (role: boolean) =>
      app.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.current_account_id', ${banco.accountId}, true), set_config('app.current_user_id', ${uid.colMV!}, true),
                                  set_config('app.scope', 'own', true), set_config('app.scope_mode', 'enforce', true)`;
        if (role) await tx.$executeRaw`SET LOCAL ROLE kobrax_scoped`;
        return Number((await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM credits`)[0]!.n);
      });
    assert.equal(await count(false), 3, 'sin SET ROLE, kobrax_app ve toda la cuenta aunque la variable diga own: la policy no le aplica');
    assert.equal(await count(true), 1, 'con SET ROLE kobrax_scoped, sólo lo suyo');
    const inherits = await prisma.$queryRaw<{ i: boolean }[]>`SELECT pg_has_role('kobrax_app', 'kobrax_scoped', 'USAGE') AS i`;
    assert.equal(inherits[0]!.i, false, 'kobrax_app debe ser NOINHERIT respecto de kobrax_scoped');
  });
});
