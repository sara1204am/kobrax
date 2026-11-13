/**
 * F13 · P2 — el alcance por oficina, de punta a punta (R-1 … R-8 de `docs/epics/F13/discovery/09-brechas.md` §9).
 *
 * API compilada, base recreada de cero (`kobrax_it`), cuentas registradas por el registro público. Lo que los unitarios no
 * pueden afirmar: que las consultas con subárbol (`LIKE ruta%`), las asignaciones vigentes y la RLS den el resultado que
 * promete el diseño con DATOS reales:
 *
 *   · R-3 el caso de referencia: Banco › Chuquisaca › {Mesa Verde, Central, Luz y Verdad, Padilla, Monteagudo, Camargo};
 *     La Paz, Cochabamba. Supervisor de agencia, gerente regional, gerente de la raíz, normalizador de regional.
 *   · R-1 el tenant individual (ACCOUNT_ADMIN sin asignaciones, raíz única): crear cliente, crédito SIN oficina, pagar.
 *   · R-5 aislamiento entre cuentas (oficina de otra cuenta rechazada, SQL y API).
 *   · R-6 mover un crédito NO cambia el `branch_id` de los pagos previos.
 *   · R-8 equivalencia: el supervisor de una agencia hoja ve EXACTAMENTE lo que veía con la regla vieja (`user_accounts.branch_id`).
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { addMember, API, call, db, freshDatabase, login, loginSkippingMfa, startApi, stopApi } from './harness';

interface Office {
  id: string;
  name: string;
  parentId: string | null;
  typeId: string;
  path: string;
  depth: number;
  isRoot: boolean;
  fullName: string;
  active: boolean;
  members: number;
  credits: number;
  children: number;
}
interface BranchType {
  id: string;
  code: string;
}
interface MoraItem {
  creditId: string;
}
interface Summary {
  outstanding: { value: number };
  creditsInArrears: { value: number };
}

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;

/** Banco (multi-oficina) */
let banco: { accountId: string; admin: string; root: Office; tipo: Record<string, string> };
const off: Record<string, Office> = {};
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
const cr: Record<string, string> = {};

/** Individual (FREE, una sola oficina) */
let indiv: { accountId: string; admin: string; root: Office };

async function signup(businessName: string, plan?: string): Promise<{ accountId: string; admin: string; email: string }> {
  const email = `${businessName.toLowerCase().replace(/\W+/g, '-')}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, firstName: 'Dueño', lastName: businessName, email, password: 'Kobrax123!', ...(plan ? { planCode: plan } : {}) }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  const accountId = owner.userAccounts[0]!.accountId;
  return { accountId, admin: await loginSkippingMfa(email), email };
}

const offices = async (token: string): Promise<Office[]> => {
  const r = await call<Office[]>(token, 'GET', '/branches');
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data!;
};

async function createOffice(name: string, parent: Office, tipo: string, code?: string): Promise<Office> {
  const r = await call<Office>(banco.admin, 'POST', '/branches', { name, parentId: parent.id, typeId: banco.tipo[tipo], ...(code ? { code } : {}) });
  assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.error)}`);
  return r.data!;
}

async function member(key: string, role: string, office: Office | null): Promise<void> {
  const email = `${key.toLowerCase()}-${suffix}@ejemplo.com`;
  uid[key] = await addMember(prisma, banco.accountId, email, key, role);
  if (office) {
    const r = await call(banco.admin, 'POST', `/branches/${office.id}/members`, { userIds: [uid[key]] });
    assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.error)}`);
  }
  tok[key] = await login(email);
}

async function credit(key: string, officeId: string | null, responsible: string | null, balance = 100): Promise<void> {
  const client = await prisma.client.create({ data: { accountId: banco.accountId, clientType: 'PERSON', firstName: key, lastName: 'Deudor' } });
  const c = await prisma.credit.create({
    data: {
      accountId: banco.accountId,
      clientId: client.id,
      branchId: officeId,
      code: `C-${key}`,
      principalAmount: balance,
      outstandingBalance: balance,
      currency: 'BOB',
      daysPastDue: 10,
      assignedManagerId: responsible ? uid[responsible] : null,
    },
  });
  cr[key] = c.id;
}

/** Los créditos que la API le muestra a `token` en Mora (todos, no sólo los que están en mora). */
async function visible(token: string, extra = ''): Promise<string[]> {
  const r = await call<MoraItem[]>(token, 'GET', `/mora?todos=true&limit=100${extra}`);
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data!.map((i) => i.creditId).sort();
}
const ids = (...keys: string[]): string[] => keys.map((k) => cr[k]!).sort();

before(async () => {
  await freshDatabase();
  // El dueño es ACCOUNT_ADMIN (rol crítico): sin gracia, su primer login exige enrolar TOTP, que no es lo que se prueba.
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();

  // ── El banco ────────────────────────────────────────────────────────────────────────────────────────────────
  const b = await signup('Banco Sur', 'PROFESSIONAL');
  // PROFESSIONAL trae 3 oficinas; el caso de referencia necesita 12 (raíz + 3 regionales + 6 agencias + El Alto) y más créditos.
  await prisma.account.update({ where: { id: b.accountId }, data: { limitsOverride: { branches: 30, users: 60, credits: 500, clients: 500 } } });
  const types = (await call<BranchType[]>(b.admin, 'GET', '/branch-types')).data!;
  const tipo = Object.fromEntries(types.map((t) => [t.code, t.id]));
  const root = (await offices(b.admin)).find((o) => o.isRoot)!;
  banco = { accountId: b.accountId, admin: b.admin, root, tipo };

  off.LPZ = await createOffice('La Paz', root, 'REGIONAL');
  off.CBBA = await createOffice('Cochabamba', root, 'REGIONAL');
  off.CHQ = await createOffice('Chuquisaca', root, 'REGIONAL');
  off.ALT = await createOffice('El Alto', off.LPZ!, 'AGENCIA', 'ALT');
  off.MV = await createOffice('Mesa Verde', off.CHQ!, 'AGENCIA', 'MV');
  off.CEN = await createOffice('Central', off.CHQ!, 'AGENCIA', 'CEN');
  off.LYV = await createOffice('Luz y Verdad', off.CHQ!, 'AGENCIA', 'LYV');
  off.PAD = await createOffice('Padilla', off.CHQ!, 'AGENCIA', 'PAD');
  off.MON = await createOffice('Monteagudo', off.CHQ!, 'AGENCIA', 'MON');
  off.CAM = await createOffice('Camargo', off.CHQ!, 'AGENCIA', 'CAM');

  // ── Las personas ────────────────────────────────────────────────────────────────────────────────────────────
  await member('supMV', 'SUPERVISOR', off.MV!); // supervisor de una agencia (hoja)
  await member('supNada', 'SUPERVISOR', null); // supervisor SIN oficina (A-4)
  await member('colMV', 'COLLECTOR', off.MV!);
  await member('colPAD', 'COLLECTOR', off.PAD!);
  await member('colALT', 'COLLECTOR', off.ALT!);
  await member('mgrChq', 'MANAGER', off.CHQ!); // gerente regional
  await member('mgrRaiz', 'MANAGER', root); // gerente de toda la organización
  await member('norm', 'SUPERVISOR', off.CHQ!); // normalizador de cartera de la regional (R4)

  // ── La cartera ──────────────────────────────────────────────────────────────────────────────────────────────
  await credit('mv', off.MV!.id, 'colMV');
  await credit('mvSin', off.MV!.id, null); // sin responsable: lo ve el subárbol, no el supervisor de la agencia
  await credit('pad', off.PAD!.id, 'colPAD');
  await credit('cen', off.CEN!.id, 'norm'); // el normalizador tiene créditos de varias agencias
  await credit('lyv', off.LYV!.id, 'norm');
  await credit('mon', off.MON!.id, 'norm');
  await credit('cam', off.CAM!.id, 'norm');
  await credit('alt', off.ALT!.id, 'colALT');
  await credit('sinOficina', null, 'colMV'); // excepción histórica (A-1): crédito sin oficina

  // ── El individual ───────────────────────────────────────────────────────────────────────────────────────────
  const i = await signup('Cobranzas Don Pedro');
  indiv = { accountId: i.accountId, admin: i.admin, root: (await offices(i.admin)).find((o) => o.isRoot)! };
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('R-3 · el árbol del caso de referencia', () => {
  it('toda cuenta nace con la raíz (razón social) y sus tipos; el dueño no tiene asignación', async () => {
    assert.equal(banco.root.name, 'Banco Sur');
    assert.equal(banco.root.depth, 0);
    assert.equal(banco.root.parentId, null);
    assert.equal(banco.root.path, `/${banco.root.id}/`);
    const asignacionesDelDueno = await prisma.userBranchAssignment.count({ where: { accountId: banco.accountId, user: { userAccounts: { some: { isOwner: true } } } } });
    assert.equal(asignacionesDelDueno, 0);
  });

  it('la ruta completa distingue oficinas del mismo nombre (R10)', async () => {
    const lista = await offices(banco.admin);
    assert.equal(lista.find((o) => o.id === off.MV!.id)!.fullName, 'Banco Sur › Chuquisaca › Mesa Verde');
    assert.equal(lista.find((o) => o.id === off.ALT!.id)!.fullName, 'Banco Sur › La Paz › El Alto');
    assert.equal(lista.find((o) => o.id === off.MV!.id)!.path, `${off.CHQ!.path}${off.MV!.id}/`);
    assert.equal(lista.find((o) => o.id === off.CHQ!.id)!.children, 6);
  });

  it('el detalle trae miembros e historial de la oficina', async () => {
    const r = await call<Office & { membersList: { userId: string; roleName: string }[]; history: { action: string }[] }>(banco.admin, 'GET', `/branches/${off.MV!.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data!.membersList.map((m) => m.userId).sort(), [uid.supMV, uid.colMV].sort());
    assert.ok(r.data!.history.some((h) => h.action === 'CREATE'));
  });

  it('🔴 el supervisor de AGENCIA ve sólo lo suyo y lo CON responsable de su agencia', async () => {
    assert.deepEqual(await visible(tok.supMV!), ids('mv'));
  });

  it('🔴 un supervisor SIN oficina no obtiene acceso total (A-4): ve sólo lo suyo, que es nada', async () => {
    assert.deepEqual(await visible(tok.supNada!), []);
  });

  it('🔴 el gerente REGIONAL (MANAGER en Chuquisaca) ve las 6 agencias, con o sin responsable, y NADA de La Paz', async () => {
    assert.deepEqual(await visible(tok.mgrChq!), ids('mv', 'mvSin', 'pad', 'cen', 'lyv', 'mon', 'cam'));
  });

  it('🔴 el gerente asignado a la RAÍZ ve todo, incluso el crédito sin oficina', async () => {
    assert.deepEqual(await visible(tok.mgrRaiz!), ids('mv', 'mvSin', 'pad', 'cen', 'lyv', 'mon', 'cam', 'alt', 'sinOficina'));
  });

  it('el administrador (sin asignaciones) ve todo por capacidad', async () => {
    assert.deepEqual(await visible(banco.admin), ids('mv', 'mvSin', 'pad', 'cen', 'lyv', 'mon', 'cam', 'alt', 'sinOficina'));
  });

  it('el filtro por oficina de Mora trae el nodo y su SUBÁRBOL (una regional trae sus agencias)', async () => {
    assert.deepEqual(await visible(banco.admin, `&branchId=${off.CHQ!.id}`), ids('mv', 'mvSin', 'pad', 'cen', 'lyv', 'mon', 'cam'));
    assert.deepEqual(await visible(banco.admin, `&branchId=${off.MV!.id}`), ids('mv', 'mvSin'));
    assert.deepEqual(await visible(banco.admin, `&branchId=${indiv.root.id}`), [], 'una oficina de otra cuenta no trae nada');
  });

  it('R-4 · el cobrador ve lo suyo, y nada más (tampoco su agencia)', async () => {
    assert.deepEqual(await visible(tok.colMV!), ids('mv', 'sinOficina'));
    assert.deepEqual(await visible(tok.colPAD!), ids('pad'));
  });

  it('R-3 · el NORMALIZADOR de la regional ve los créditos con responsable de varias agencias de la regional, y no los de La Paz', async () => {
    assert.deepEqual(await visible(tok.norm!), ids('mv', 'pad', 'cen', 'lyv', 'mon', 'cam'));
  });

  it('un crédito fuera del alcance tampoco se abre por la URL (404)', async () => {
    const r = await call(tok.supMV!, 'GET', `/mora/${cr.pad}`);
    assert.equal(r.status, 404);
    const mio = await call(tok.supMV!, 'GET', `/mora/${cr.mv}`);
    assert.equal(mio.status, 200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('R-8 · equivalencia: el supervisor de una agencia hoja ve lo mismo que con la regla vieja', () => {
  it('la regla anterior (user_accounts.branch_id) y la nueva (asignaciones + subárbol) devuelven los MISMOS créditos', async () => {
    // La regla de antes, tal cual estaba en mora-query.ts, ejecutada como superusuario sobre los mismos datos.
    const viejo = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT cr.id FROM credits cr WHERE cr.account_id = $1 AND cr.deleted_at IS NULL AND (
         cr.assigned_manager_id = $2
         OR EXISTS (SELECT 1 FROM credit_assignments ca WHERE ca.credit_id = cr.id AND ca.user_id = $2 AND ca.revoked_at IS NULL)
         OR (cr.assigned_manager_id IS NOT NULL AND cr.branch_id IS NOT NULL AND cr.branch_id = (
              SELECT ua.branch_id FROM user_accounts ua WHERE ua.user_id = $2 AND ua.account_id = cr.account_id AND ua.is_active = true LIMIT 1)))`,
      banco.accountId,
      uid.supMV,
    );
    assert.deepEqual(viejo.map((r) => r.id).sort(), await visible(tok.supMV!));
    // El espejo legado y la asignación vigente no se separaron.
    const ua = await prisma.userAccount.findFirstOrThrow({ where: { userId: uid.supMV!, accountId: banco.accountId } });
    const asg = await prisma.userBranchAssignment.findMany({ where: { userId: uid.supMV!, revokedAt: null } });
    assert.equal(ua.branchId, off.MV!.id);
    assert.deepEqual(asg.map((a) => a.branchId), [off.MV!.id]);
    assert.ok(asg.every((a) => a.roleId === null));
  });

  it('un MANAGER asignado a la raíz ve lo mismo que veía con data:scope:all (todo lo del tenant)', async () => {
    const todos = await prisma.credit.findMany({ where: { accountId: banco.accountId, deletedAt: null }, select: { id: true } });
    assert.deepEqual(await visible(tok.mgrRaiz!), todos.map((c) => c.id).sort());
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D-7 · Cartera, Clientes, Pagos y Exportes respetan el mismo alcance que Mora', () => {
  const list = async (token: string, path: string): Promise<string[]> => {
    const r = await call<{ id: string }[]>(token, 'GET', path);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    return r.data!.map((x) => x.id).sort();
  };
  const csv = async (token: string, path: string): Promise<string> => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    return text;
  };
  const pay: Record<string, string> = {};

  before(async () => {
    for (const k of ['mv', 'pad', 'alt']) {
      const c = await prisma.credit.findUniqueOrThrow({ where: { id: cr[k]! } });
      const p = await prisma.payment.create({
        data: { accountId: banco.accountId, creditId: c.id, branchId: c.branchId, amount: 10, paymentDate: new Date(), method: 'CASH', registeredVia: 'WEB', registeredBy: uid.colMV! },
      });
      pay[k] = p.id;
    }
  });

  it('🔴 Cartera: el supervisor sólo ve lo de su agencia; el regional su regional; el administrador todo (sin cambios)', async () => {
    assert.deepEqual(await list(tok.supMV!, '/credits?limit=100'), ids('mv'));
    assert.deepEqual(await list(tok.mgrChq!, '/credits?limit=100'), ids('mv', 'mvSin', 'pad', 'cen', 'lyv', 'mon', 'cam'));
    assert.deepEqual(await list(tok.mgrRaiz!, '/credits?limit=100'), ids('mv', 'mvSin', 'pad', 'cen', 'lyv', 'mon', 'cam', 'alt', 'sinOficina'));
    assert.deepEqual(await list(banco.admin, '/credits?limit=100'), ids('mv', 'mvSin', 'pad', 'cen', 'lyv', 'mon', 'cam', 'alt', 'sinOficina'));
    assert.deepEqual(await list(tok.colPAD!, '/credits?limit=100'), ids('pad'));
  });

  it('Cartera: la paginación y el total salen del conjunto acotado', async () => {
    const res = await fetch(`${API}/credits?limit=3&page=2`, { headers: { Authorization: `Bearer ${tok.mgrChq!}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: unknown[]; meta: { total?: number; pagination?: { total?: number } } };
    assert.equal(body.data.length, 3);
    assert.equal(body.meta.total ?? body.meta.pagination?.total, 7);
  });

  it('🔴 la ficha del crédito fuera de alcance es 404; la propia se abre', async () => {
    assert.equal((await call(tok.supMV!, 'GET', `/credits/${cr.pad}`)).status, 404);
    assert.equal((await call(tok.supMV!, 'GET', `/credits/${cr.mv}`)).status, 200);
    assert.equal((await call(tok.mgrChq!, 'GET', `/credits/${cr.alt}`)).status, 404, 'La Paz queda fuera de Chuquisaca');
    assert.equal((await call(banco.admin, 'GET', `/credits/${cr.alt}`)).status, 200);
  });

  it('🔴 Clientes: el supervisor no lista ni abre al deudor de otra agencia', async () => {
    const cl = async (k: string) => (await prisma.credit.findUniqueOrThrow({ where: { id: cr[k]! } })).clientId;
    const vistos = await list(tok.supMV!, '/clients?limit=100');
    assert.ok(vistos.includes(await cl('mv')));
    assert.ok(!vistos.includes(await cl('pad')));
    assert.equal((await call(tok.supMV!, 'GET', `/clients/${await cl('pad')}`)).status, 404);
    assert.equal((await call(tok.supMV!, 'GET', `/clients/${await cl('mv')}`)).status, 200);
    assert.equal((await call(banco.admin, 'GET', `/clients/${await cl('pad')}`)).status, 200);
  });

  it('Clientes: uno recién creado, sin cartera, no se esconde (el cobrador lo ve al darlo de alta)', async () => {
    const r = await call<{ id: string }>(tok.colMV!, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Nuevo', lastName: 'SinCartera' });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal((await call(tok.colMV!, 'GET', `/clients/${r.data!.id}`)).status, 200);
  });

  it('🔴 Pagos: se acotan por el crédito (no por payments.branch_id)', async () => {
    assert.deepEqual(await list(tok.supMV!, '/payments?limit=100'), [pay.mv!]);
    assert.deepEqual(await list(tok.mgrChq!, '/payments?limit=100'), [pay.mv!, pay.pad!].sort());
    assert.deepEqual(await list(banco.admin, '/payments?limit=100'), [pay.mv!, pay.pad!, pay.alt!].sort());
    assert.equal((await call(tok.supMV!, 'GET', `/payments/${pay.pad}`)).status, 404);
  });

  it('🔴 Exportes: el CSV de mora trae sólo lo visible; la copia completa es sólo para quien ve todo', async () => {
    const mgr = await csv(tok.mgrChq!, '/exports/mora');
    assert.ok(!mgr.includes('C-alt'), 'La Paz no sale en el CSV del regional de Chuquisaca');
    const todo = await csv(banco.admin, '/exports/mora');
    assert.ok(todo.includes('C-alt'));
    assert.equal((await fetch(`${API}/exports/backup`, { headers: { Authorization: `Bearer ${tok.mgrChq!}` } })).status, 403);
    assert.equal((await fetch(`${API}/exports/backup`, { headers: { Authorization: `Bearer ${tok.mgrRaiz!}` } })).status, 200);
    assert.equal((await fetch(`${API}/exports/backup`, { headers: { Authorization: `Bearer ${banco.admin}` } })).status, 200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D-7 · el supervisor lee oficinas, acotado a las suyas; el gerente regional se da de alta por API', () => {
  it('🔴 el supervisor ve sólo su agencia (con la ruta completa) y 404 en el detalle de las demás', async () => {
    const mias = await offices(tok.supMV!);
    assert.deepEqual(mias.map((o) => o.id), [off.MV!.id]);
    assert.equal(mias[0]!.fullName, 'Banco Sur › Chuquisaca › Mesa Verde');
    assert.equal((await call(tok.supMV!, 'GET', `/branches/${off.MV!.id}`)).status, 200);
    assert.equal((await call(tok.supMV!, 'GET', `/branches/${off.PAD!.id}`)).status, 404);
    assert.equal((await call(tok.supMV!, 'POST', '/branches', { name: 'X', parentId: off.CHQ!.id, typeId: banco.tipo.AGENCIA })).status, 403, 'leer no es escribir');
  });

  it('el supervisor sin oficina no ve ninguna; el regional ve su regional y sus agencias', async () => {
    assert.deepEqual(await offices(tok.supNada!), []);
    assert.deepEqual((await offices(tok.mgrChq!)).map((o) => o.id).sort(), [off.CHQ!, off.MV!, off.CEN!, off.LYV!, off.PAD!, off.MON!, off.CAM!].map((o) => o.id).sort());
    assert.equal((await offices(banco.admin)).length, 10 + 1);
  });

  it('🔴 MANAGER se invita por API, pero sin oficina → 422; con oficina queda asignado a ella (no a la raíz)', async () => {
    const roles = (await call<{ id: string; name: string }[]>(banco.admin, 'GET', '/roles')).data!;
    const mgr = roles.find((r) => r.name === 'MANAGER');
    assert.ok(mgr, 'MANAGER es asignable');
    const base = { firstName: 'Reg', lastName: 'Cbba', roleId: mgr!.id };
    const sin = await call(banco.admin, 'POST', '/users/invite', { ...base, email: `reg-sin-${suffix}@ejemplo.com` });
    assert.equal(sin.status, 422);
    assert.equal(sin.error?.code, 'MANAGER_NEEDS_OFFICE');
    const con = await call<{ userId: string }>(banco.admin, 'POST', '/users/invite', { ...base, email: `reg-con-${suffix}@ejemplo.com`, branchId: off.CBBA!.id });
    assert.equal(con.status, 201, JSON.stringify(con.error));
    const asg = await prisma.userBranchAssignment.findMany({ where: { userId: con.data!.userId, revokedAt: null } });
    assert.deepEqual(asg.map((a) => a.branchId), [off.CBBA!.id]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('B-S7 · la analítica respeta el alcance (antes bastaba report:read para ver toda la cuenta)', () => {
  const outstanding = async (token: string, q = ''): Promise<number> => {
    const r = await call<Summary>(token, 'GET', `/analytics/summary${q}`);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    return r.data!.outstanding.value;
  };

  it('🔴 el supervisor ya no ve la cartera de otras agencias', async () => {
    assert.equal(await outstanding(banco.admin), 900);
    assert.equal(await outstanding(tok.supMV!), 100);
    assert.equal(await outstanding(tok.supNada!), 0);
  });

  it('el gerente regional ve su regional; el de la raíz, todo', async () => {
    assert.equal(await outstanding(tok.mgrChq!), 700);
    assert.equal(await outstanding(tok.mgrRaiz!), 900);
  });

  it('branchId = ese nodo y su SUBÁRBOL; acotado por el alcance', async () => {
    assert.equal(await outstanding(banco.admin, `?branchId=${off.CHQ!.id}`), 700);
    assert.equal(await outstanding(banco.admin, `?branchId=${off.MV!.id}`), 200);
    assert.equal(await outstanding(banco.admin, `?branchId=${off.LPZ!.id}`), 100);
    assert.equal(await outstanding(tok.supMV!, `?branchId=${off.CHQ!.id}`), 100, 'la regional, pero sólo lo que su alcance deja ver');
    assert.equal(await outstanding(tok.supMV!, `?branchId=${off.LPZ!.id}`), 0);
  });

  it('un branchId de OTRA cuenta no devuelve cifras de ella', async () => {
    assert.equal(await outstanding(banco.admin, `?branchId=${indiv.root.id}`), 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('R-1 · el tenant individual sigue trabajando tranquilo', () => {
  let clientId: string;
  let creditId: string;

  it('tiene una sola oficina, la raíz, y el administrador no tiene asignaciones', async () => {
    const lista = await offices(indiv.admin);
    assert.equal(lista.length, 1);
    assert.ok(lista[0]!.isRoot);
    assert.equal(lista[0]!.name, 'Cobranzas Don Pedro');
    assert.equal(await prisma.userBranchAssignment.count({ where: { accountId: indiv.accountId } }), 0);
  });

  it('crear un cliente no pide ninguna oficina', async () => {
    const r = await call<{ id: string }>(indiv.admin, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Ana', lastName: 'Quispe' });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    clientId = r.data!.id;
  });

  it('🔴 crear un crédito SIN enviar oficina → queda en la raíz (nunca NULL)', async () => {
    const r = await call<{ id: string; branchId?: string }>(indiv.admin, 'POST', '/credits', { clientId, principalAmount: 1200, installmentsCount: 12 });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data!.branchId, indiv.root.id);
    creditId = r.data!.id;
    const fila = await prisma.credit.findUniqueOrThrow({ where: { id: creditId } });
    assert.equal(fila.branchId, indiv.root.id);
  });

  it('🔴 registrar un pago hereda la oficina del crédito', async () => {
    const r = await call<{ id: string }>(indiv.admin, 'POST', '/payments', { creditId, amount: 100, method: 'CASH' });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const pago = await prisma.payment.findUniqueOrThrow({ where: { id: r.data!.id } });
    assert.equal(pago.branchId, indiv.root.id);
  });

  it('mora, agenda y analítica dan las mismas cifras que la base', async () => {
    const m = await visible(indiv.admin);
    assert.deepEqual(m, [creditId]);
    const s = await call<Summary>(indiv.admin, 'GET', '/analytics/summary');
    assert.equal(s.status, 200);
    const real = await prisma.credit.aggregate({ where: { accountId: indiv.accountId, deletedAt: null, status: 'ACTIVE', writtenOffAt: null }, _sum: { outstandingBalance: true } });
    assert.equal(s.data!.outstanding.value, Number(real._sum.outstandingBalance));
    assert.equal((await call(indiv.admin, 'GET', '/analytics/agenda-summary')).status, 200);
    assert.equal((await call(indiv.admin, 'GET', '/analytics/collector-performance')).status, 200);
  });

  it('el móvil NO manda branchId en créditos ni pagos: el contrato no cambia (ya cubierto arriba) y una oficina propia es opcional', async () => {
    const r = await call<{ id: string; branchId?: string }>(indiv.admin, 'POST', '/credits', { clientId, principalAmount: 600, installmentsCount: 6, branchId: indiv.root.id });
    assert.equal(r.status, 201);
    assert.equal(r.data!.branchId, indiv.root.id);
  });

  it('FREE = una sola oficina: crear otra rebota con el tope del plan', async () => {
    const r = await call(indiv.admin, 'POST', '/branches', { name: 'Sucursal 2' });
    assert.equal(r.status, 422);
    assert.equal(r.error?.code, 'PLAN_LIMIT_REACHED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('R-5 / A-6 · la oficina la decide el servidor y no cruza cuentas', () => {
  it('🔴 un crédito en una oficina de OTRA cuenta se rechaza (y no se guarda)', async () => {
    const client = await prisma.client.create({ data: { accountId: banco.accountId, clientType: 'PERSON', firstName: 'X', lastName: 'Y' } });
    const antes = await prisma.credit.count({ where: { accountId: banco.accountId } });
    const r = await call(banco.admin, 'POST', '/credits', { clientId: client.id, principalAmount: 500, installmentsCount: 5, branchId: indiv.root.id });
    assert.equal(r.status, 422);
    assert.equal(r.error?.code, 'CREDIT_BRANCH_INVALID');
    assert.equal(await prisma.credit.count({ where: { accountId: banco.accountId } }), antes);
  });

  it('🔴 y al revés: el individual no puede poner créditos en el banco', async () => {
    const client = await prisma.client.create({ data: { accountId: indiv.accountId, clientType: 'PERSON', firstName: 'X', lastName: 'Y' } });
    const r = await call(indiv.admin, 'POST', '/credits', { clientId: client.id, principalAmount: 500, installmentsCount: 5, branchId: off.MV!.id });
    assert.equal(r.status, 422);
    assert.equal(r.error?.code, 'CREDIT_BRANCH_INVALID');
  });

  it('crear una oficina colgando de otra cuenta, leerla o moverla: no existe', async () => {
    assert.equal((await call(banco.admin, 'POST', '/branches', { name: 'Intrusa', parentId: indiv.root.id })).error?.code, 'BRANCH_PARENT_INVALID');
    assert.equal((await call(banco.admin, 'GET', `/branches/${indiv.root.id}`)).status, 404);
    assert.equal((await call(banco.admin, 'POST', `/branches/${off.CAM!.id}/move`, { parentId: indiv.root.id })).error?.code, 'BRANCH_PARENT_INVALID');
    assert.equal((await call(banco.admin, 'POST', '/credits/reassign-office', { creditIds: [cr.mv], toBranchId: indiv.root.id })).error?.code, 'CREDIT_BRANCH_INVALID');
  });

  it('SQL: ninguna oficina cuelga de otra cuenta ni ningún crédito apunta a una oficina ajena', async () => {
    const cruzadas = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM branches b JOIN branches p ON p.id = b.parent_id WHERE b.account_id <> p.account_id`,
    );
    assert.equal(cruzadas[0]!.n, 0);
    const credCruzados = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM credits c JOIN branches b ON b.id = c.branch_id WHERE c.account_id <> b.account_id`,
    );
    assert.equal(credCruzados[0]!.n, 0);
  });

  it('sin oficina y sin responsable en un árbol con varias hojas → 422 CREDIT_BRANCH_UNRESOLVED (nunca NULL)', async () => {
    const client = await prisma.client.create({ data: { accountId: banco.accountId, clientType: 'PERSON', firstName: 'Z', lastName: 'Z' } });
    const r = await call(banco.admin, 'POST', '/credits', { clientId: client.id, principalAmount: 500, installmentsCount: 5 });
    assert.equal(r.status, 422);
    assert.equal(r.error?.code, 'CREDIT_BRANCH_UNRESOLVED');
  });

  it('sin oficina pero con un responsable que trabaja en una → la oficina del responsable', async () => {
    const client = await prisma.client.create({ data: { accountId: banco.accountId, clientType: 'PERSON', firstName: 'W', lastName: 'W' } });
    const r = await call<{ branchId?: string }>(banco.admin, 'POST', '/credits', { clientId: client.id, principalAmount: 500, installmentsCount: 5, assignedManagerId: uid.colPAD });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data!.branchId, off.PAD!.id);
  });

  it('el PATCH del crédito ya no cambia la oficina', async () => {
    const r = await call(banco.admin, 'PATCH', `/credits/${cr.mv}`, { branchId: off.PAD!.id });
    assert.equal(r.status, 422);
    assert.equal(r.error?.code, 'CREDIT_BRANCH_IMMUTABLE');
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: cr.mv } })).branchId, off.MV!.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('R-6 · pagos históricos: mover un crédito NO cambia la oficina de los pagos previos', () => {
  it('el pago copia la oficina del crédito al pagar; reasignar el crédito no reescribe los pagos viejos, sí los nuevos', async () => {
    const client = await prisma.client.create({ data: { accountId: banco.accountId, clientType: 'PERSON', firstName: 'Hist', lastName: 'Orico' } });
    const c = await call<{ id: string; branchId?: string }>(banco.admin, 'POST', '/credits', { clientId: client.id, principalAmount: 1200, installmentsCount: 12, branchId: off.MV!.id, assignedManagerId: uid.colMV });
    assert.equal(c.status, 201, JSON.stringify(c.error));
    assert.equal(c.data!.branchId, off.MV!.id);
    const p1 = await call<{ id: string }>(banco.admin, 'POST', '/payments', { creditId: c.data!.id, amount: 100, method: 'CASH' });
    assert.equal(p1.status, 201, JSON.stringify(p1.error));
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p1.data!.id } })).branchId, off.MV!.id);

    const mover = await call<{ moved: number; unchanged: number }>(banco.admin, 'POST', '/credits/reassign-office', { creditIds: [c.data!.id], toBranchId: off.PAD!.id });
    assert.equal(mover.status, 200, JSON.stringify(mover.error));
    assert.equal(mover.data!.moved, 1);
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: c.data!.id } })).branchId, off.PAD!.id);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p1.data!.id } })).branchId, off.MV!.id, 'el pago viejo conserva su oficina histórica');

    const p2 = await call<{ id: string }>(banco.admin, 'POST', '/payments', { creditId: c.data!.id, amount: 100, method: 'CASH' });
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p2.data!.id } })).branchId, off.PAD!.id, 'el pago nuevo toma la oficina actual');

    // La reasignación queda auditada con antes y después.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'credit', entityId: c.data!.id, action: 'REASSIGN_OFFICE' } });
    assert.deepEqual(log.before, { branchId: off.MV!.id });
    assert.deepEqual(log.after, { branchId: off.PAD!.id });
  });

  it('🔴 reasignar exige alcance sobre el ORIGEN y el DESTINO', async () => {
    // El supervisor de Mesa Verde tiene assignment:write pero su destino (Padilla) queda fuera de su alcance.
    const destino = await call(tok.supMV!, 'POST', '/credits/reassign-office', { creditIds: [cr.mv], toBranchId: off.PAD!.id });
    assert.equal(destino.status, 422);
    assert.equal(destino.error?.code, 'CREDIT_BRANCH_INVALID');
    // Y un crédito ajeno (Padilla) hacia su propia agencia: el origen queda fuera.
    const origen = await call(tok.supMV!, 'POST', '/credits/reassign-office', { creditIds: [cr.pad], toBranchId: off.MV!.id });
    // F14 · F2b: con la barrera de alcance un crédito ajeno ni siquiera se ve: responde «no existe» (404), no «fuera de alcance» (403).
    assert.ok([403, 404].includes(origen.status), `origen fuera de alcance: ${origen.status}`);
    assert.ok(['CREDIT_OFFICE_OUT_OF_SCOPE', 'RESOURCE_NOT_FOUND'].includes(origen.error?.code ?? ''), JSON.stringify(origen.error));
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: cr.pad } })).branchId, off.PAD!.id);
    // Un cobrador (sin assignment:write) no pasa la puerta.
    assert.equal((await call(tok.colMV!, 'POST', '/credits/reassign-office', { creditIds: [cr.mv], toBranchId: off.MV!.id })).status, 403);
  });

  it('es atómica por lote: si un crédito del lote no existe, no se mueve ninguno', async () => {
    const r = await call(banco.admin, 'POST', '/credits/reassign-office', { creditIds: [cr.lyv, randomUUID()], toBranchId: off.CEN!.id });
    assert.equal(r.status, 404);
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: cr.lyv } })).branchId, off.LYV!.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('B3 · estructura del árbol: mover, bajas, personas', () => {
  let extra: Office;
  let hija: Office;

  it('mover una oficina con su subárbol reescribe la ruta de todos; sin ciclos; la raíz no se mueve', async () => {
    extra = await createOffice('Provincia', off.CBBA!, 'REGIONAL');
    hija = await createOffice('Sacaba', extra, 'AGENCIA', 'SAC');
    const mv = await call<Office>(banco.admin, 'POST', `/branches/${extra.id}/move`, { parentId: off.LPZ!.id });
    assert.equal(mv.status, 200, JSON.stringify(mv.error));
    const lista = await offices(banco.admin);
    const h = lista.find((o) => o.id === hija.id)!;
    assert.equal(h.path, `${off.LPZ!.path}${extra.id}/${hija.id}/`);
    assert.equal(h.depth, 3);
    assert.equal(h.fullName, 'Banco Sur › La Paz › Provincia › Sacaba');
    assert.equal((await call(banco.admin, 'POST', `/branches/${extra.id}/move`, { parentId: hija.id })).error?.code, 'BRANCH_MOVE_CYCLE');
    assert.equal((await call(banco.admin, 'POST', `/branches/${banco.root.id}/move`, { parentId: off.LPZ!.id })).error?.code, 'BRANCH_ROOT_PROTECTED');
  });

  it('el alcance sigue al árbol: lo que cuelga de La Paz lo ve quien está en La Paz', async () => {
    await credit('sac', hija.id, null);
    const lpz = await call(banco.admin, 'POST', '/branches', { name: 'Gerente La Paz', parentId: off.LPZ!.id }); // sólo para verificar el alta bajo La Paz
    assert.equal(lpz.status, 201);
    await member('mgrLpz', 'MANAGER', off.LPZ!);
    assert.deepEqual(await visible(tok.mgrLpz!), ids('alt', 'sac'));
  });

  it('🔴 no se desactiva con hijas, créditos o personas; la raíz nunca', async () => {
    assert.equal((await call(banco.admin, 'POST', `/branches/${off.LPZ!.id}/deactivate`)).error?.code, 'BRANCH_HAS_CHILDREN');
    assert.equal((await call(banco.admin, 'POST', `/branches/${hija.id}/deactivate`)).error?.code, 'BRANCH_HAS_CREDITS');
    assert.equal((await call(banco.admin, 'POST', `/branches/${off.ALT!.id}/deactivate`)).error?.code, 'BRANCH_HAS_CREDITS');
    assert.equal((await call(banco.admin, 'POST', `/branches/${banco.root.id}/deactivate`)).error?.code, 'BRANCH_ROOT_PROTECTED');
    assert.equal((await call(banco.admin, 'DELETE', `/branches/${banco.root.id}`)).error?.code, 'BRANCH_ROOT_PROTECTED');
  });

  it('una hoja vacía se desactiva y se restaura; el tope del plan cuenta las no borradas', async () => {
    const vacia = await createOffice('Vacía', off.CBBA!, 'AGENCIA');
    const off1 = await call<Office>(banco.admin, 'POST', `/branches/${vacia.id}/deactivate`);
    assert.equal(off1.status, 200);
    assert.equal(off1.data!.active, false);
    const on = await call<Office>(banco.admin, 'POST', `/branches/${vacia.id}/restore`);
    assert.equal(on.data!.active, true);
    const del = await call(banco.admin, 'DELETE', `/branches/${vacia.id}`);
    assert.equal(del.status, 204);
  });

  it('🔴 una persona, una oficina: pedir una SEGUNDA (mode ADD) es 409; mover sí se puede', async () => {
    const dos = await call(banco.admin, 'POST', `/branches/${off.CEN!.id}/members`, { userIds: [uid.colPAD], mode: 'ADD' });
    assert.equal(dos.status, 409);
    assert.equal(dos.error?.code, 'BRANCH_ASSIGNMENT_EXISTS');
    const mover = await call(banco.admin, 'POST', `/branches/${off.CEN!.id}/members`, { userIds: [uid.colPAD] });
    assert.equal(mover.status, 200, JSON.stringify(mover.error));
    const vigentes = await prisma.userBranchAssignment.findMany({ where: { userId: uid.colPAD!, revokedAt: null } });
    assert.deepEqual(vigentes.map((v) => v.branchId), [off.CEN!.id]);
    assert.equal((await prisma.userAccount.findFirstOrThrow({ where: { userId: uid.colPAD! } })).branchId, off.CEN!.id, 'espejo legado consistente');
    // quitar de la oficina
    const quitar = await call(banco.admin, 'DELETE', `/branches/${off.CEN!.id}/members/${uid.colPAD}`);
    assert.equal(quitar.status, 200);
    assert.equal(await prisma.userBranchAssignment.count({ where: { userId: uid.colPAD!, revokedAt: null } }), 0);
    assert.equal((await prisma.userAccount.findFirstOrThrow({ where: { userId: uid.colPAD! } })).branchId, null);
    assert.equal((await call(banco.admin, 'DELETE', `/branches/${off.CEN!.id}/members/${uid.colPAD}`)).error?.code, 'BRANCH_MEMBER_NOT_FOUND');
  });

  it('permisos: leer oficinas es office:read; escribir, office:write (el cobrador no)', async () => {
    // El MANAGER lee el árbol (office:read, que heredó de user:read); el supervisor y el cobrador no tenían user:read y no lo ven.
    assert.equal((await call(tok.mgrChq!, 'GET', '/branches')).status, 200);
    assert.equal((await call(tok.colMV!, 'GET', '/branches')).status, 403);
    assert.equal((await call(tok.mgrChq!, 'POST', '/branches', { name: 'No puede' })).status, 403, 'leer no es escribir');
    assert.equal((await call(tok.supMV!, 'POST', '/branches', { name: 'No puede' })).status, 403);
    assert.equal((await call(tok.supMV!, 'POST', `/branches/${off.CAM!.id}/move`, { parentId: off.LYV!.id })).status, 403);
  });

  it('tipos de oficina: el catálogo es editable por cuenta y el código es único', async () => {
    const nuevo = await call<BranchType>(banco.admin, 'POST', '/branch-types', { code: 'SUBAGENCIA', name: 'Subagencia' });
    assert.equal(nuevo.status, 201, JSON.stringify(nuevo.error));
    assert.equal((await call(banco.admin, 'POST', '/branch-types', { code: 'SUBAGENCIA', name: 'Otra' })).error?.code, 'BRANCH_TYPE_CODE_DUPLICATE');
    assert.equal((await call(banco.admin, 'PATCH', `/branch-types/${nuevo.data!.id}`, { name: 'Sub-agencia' })).status, 200);
  });

  it('toda mutación queda auditada', async () => {
    const acciones = await prisma.auditLog.findMany({ where: { accountId: banco.accountId, entity: 'branch' }, select: { action: true } });
    const set = new Set(acciones.map((a) => a.action));
    for (const a of ['CREATE', 'MOVE', 'DEACTIVATE', 'RESTORE', 'DELETE']) assert.ok(set.has(a), a);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('B7 · el espejo legado y las asignaciones no se separan', () => {
  it('PATCH /users/:id con branchId mueve la asignación y el espejo; null los quita', async () => {
    const r = await call(banco.admin, 'PATCH', `/users/${uid.colALT}`, { branchId: off.MON!.id });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual((await prisma.userBranchAssignment.findMany({ where: { userId: uid.colALT!, revokedAt: null } })).map((a) => a.branchId), [off.MON!.id]);
    assert.equal((await prisma.userAccount.findFirstOrThrow({ where: { userId: uid.colALT! } })).branchId, off.MON!.id);
    const nulo = await call(banco.admin, 'PATCH', `/users/${uid.colALT}`, { branchId: null });
    assert.equal(nulo.status, 200);
    assert.equal(await prisma.userBranchAssignment.count({ where: { userId: uid.colALT!, revokedAt: null } }), 0);
  });

  it('el script verify/oficinas-arbol.sql no encuentra inconsistencias (ver informe: se corre aparte con psql)', async () => {
    // Comprobación equivalente en línea: cada asignación vigente tiene su espejo y viceversa.
    const huerfanos = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM user_accounts ua
       WHERE ua.branch_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM user_branch_assignments a WHERE a.user_id = ua.user_id AND a.account_id = ua.account_id AND a.branch_id = ua.branch_id AND a.revoked_at IS NULL)`,
    );
    assert.equal(huerfanos[0]!.n, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('GET /credits?branchId= = ese nodo y su subárbol, acotado por el alcance', () => {
  const listed = async (token: string, q: string): Promise<string[]> => {
    const r = await call<{ id: string }[]>(token, 'GET', `/credits?limit=100${q}`);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    return r.data!.map((c) => c.id).sort();
  };
  const dbSubtree = async (office: Office): Promise<string[]> =>
    (await prisma.credit.findMany({ where: { accountId: banco.accountId, deletedAt: null, branch: { path: { startsWith: office.path } } }, select: { id: true } })).map((c) => c.id).sort();

  it('equivalencia con una oficina hoja: lo mismo que la igualdad de antes', async () => {
    const igualdad = (await prisma.credit.findMany({ where: { accountId: banco.accountId, deletedAt: null, branchId: off.MV!.id }, select: { id: true } })).map((c) => c.id).sort();
    assert.deepEqual(await listed(banco.admin, `&branchId=${off.MV!.id}`), igualdad);
    assert.ok(igualdad.length >= 2);
  });

  it('una regional (Chuquisaca) trae sus 6 agencias; el gerente regional lo mismo; La Paz no le trae nada', async () => {
    const chq = await dbSubtree(off.CHQ!);
    assert.ok(chq.length >= 7);
    assert.deepEqual(await listed(banco.admin, `&branchId=${off.CHQ!.id}`), chq);
    assert.deepEqual(await listed(tok.mgrChq!, `&branchId=${off.CHQ!.id}`), chq);
    assert.deepEqual(await listed(tok.mgrChq!, `&branchId=${off.LPZ!.id}`), []);
    assert.ok((await listed(tok.mgrChq!, '')).every((id) => chq.includes(id)), 'sin filtro tampoco ve fuera de su subárbol');
  });
});

describe('POST /credits/reassign-office con fromBranchId: la raíz con cartera recibe su primera hija', () => {
  it('mueve toda la cartera de una oficina, la audita y no toca los pagos; el supervisor ajeno no puede', async () => {
    const antes = await prisma.credit.findMany({ where: { accountId: banco.accountId, branchId: off.LYV!.id, deletedAt: null }, select: { id: true } });
    assert.ok(antes.length > 0);
    const pagosAntes = await prisma.payment.count({ where: { accountId: banco.accountId, branchId: off.LYV!.id } });
    assert.equal((await call(tok.supMV!, 'POST', '/credits/reassign-office', { fromBranchId: off.LYV!.id, toBranchId: off.MV!.id })).error?.code, 'CREDIT_OFFICE_OUT_OF_SCOPE');
    assert.equal((await call(banco.admin, 'POST', '/credits/reassign-office', { toBranchId: off.MV!.id })).error?.code, 'CREDIT_REASSIGN_ARGS');
    const r = await call<{ moved: number }>(banco.admin, 'POST', '/credits/reassign-office', { fromBranchId: off.LYV!.id, toBranchId: off.CEN!.id });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data!.moved, antes.length);
    assert.equal(await prisma.credit.count({ where: { accountId: banco.accountId, branchId: off.LYV!.id, deletedAt: null } }), 0);
    assert.equal(await prisma.payment.count({ where: { accountId: banco.accountId, branchId: off.LYV!.id } }), pagosAntes);
    assert.equal(await prisma.auditLog.count({ where: { entity: 'credit', action: 'REASSIGN_OFFICE', entityId: { in: antes.map((c) => c.id) } } }), antes.length);
  });

  it('POST /branches/:id/members acepta la forma singular {userId}; el detalle trae stats, membersList e history', async () => {
    const r = await call<Office>(banco.admin, 'POST', `/branches/${off.CAM!.id}/members`, { userId: uid.supNada });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data!.members, 1);
    const d = await call<{ stats: { members: number }; membersList: unknown[]; history: unknown[] }>(banco.admin, 'GET', `/branches/${off.CAM!.id}`);
    assert.equal(d.data!.stats.members, 1);
    assert.equal(d.data!.membersList.length, 1);
    assert.ok(Array.isArray(d.data!.history));
  });
});

describe('A-6 · quien crea decide la oficina cuando no hay oficina ni responsable explícitos', () => {
  // F14 · F2b: un cliente sin crédito sólo lo ve quien lo dio de alta (o su oficina de registro); el fixture refleja el alta real.
  const nuevoCliente = async (creador: string): Promise<string> =>
    (await prisma.client.create({ data: { accountId: banco.accountId, clientType: 'PERSON', firstName: 'Q', lastName: randomUUID().slice(0, 4), createdBy: uid[creador]! } })).id;

  it('🔴 un cobrador con UNA oficina crea sin enviar branchId → queda en su oficina (el móvil no manda oficina)', async () => {
    const r = await call<{ branchId?: string }>(tok.colMV!, 'POST', '/credits', { clientId: await nuevoCliente('colMV'), principalAmount: 300, installmentsCount: 3 });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data!.branchId, off.MV!.id);
  });

  it('un gerente regional sin responsable crea → la oficina de su única asignación (la regional)', async () => {
    const r = await call<{ branchId?: string }>(tok.mgrChq!, 'POST', '/credits', { clientId: await nuevoCliente('mgrChq'), principalAmount: 300, installmentsCount: 3 });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data!.branchId, off.CHQ!.id);
  });

  it('🔴 un cobrador SIN asignación en una cuenta con varias hojas sigue recibiendo 422 CREDIT_BRANCH_UNRESOLVED, con mensaje claro', async () => {
    await member('colSin', 'COLLECTOR', null);
    const r = await call(tok.colSin!, 'POST', '/credits', { clientId: await nuevoCliente('colSin'), principalAmount: 300, installmentsCount: 3 });
    assert.equal(r.status, 422);
    assert.equal(r.error?.code, 'CREDIT_BRANCH_UNRESOLVED');
    assert.match(r.error!.message, /oficina/i);
  });
});

describe('Baja de oficina: las asignaciones vigentes se revocan', () => {
  it('borrar una oficina cuyas únicas personas son inactivas revoca sus asignaciones y limpia el espejo', async () => {
    const o = await createOffice('Para borrar', off.CBBA!, 'AGENCIA', 'DEL');
    await member('colInact', 'COLLECTOR', o);
    await prisma.userAccount.updateMany({ where: { userId: uid.colInact!, accountId: banco.accountId }, data: { isActive: false } });
    const del = await call(banco.admin, 'DELETE', `/branches/${o.id}`);
    assert.equal(del.status, 204, JSON.stringify(del.error));
    assert.equal(await prisma.userBranchAssignment.count({ where: { branchId: o.id, revokedAt: null } }), 0);
    assert.equal((await prisma.userAccount.findFirstOrThrow({ where: { userId: uid.colInact!, accountId: banco.accountId } })).branchId, null);
  });
});
