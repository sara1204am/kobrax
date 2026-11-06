/**
 * F14 · F2 — responsabilidad y alcance, de punta a punta (R-03, R-12/R-13, N-12, H-3, H-7, H-8, H-12, H-13).
 *
 * API compilada + Postgres y Redis reales (base `kobrax_it`). Lo que los unitarios no pueden afirmar: que la visibilidad del cliente
 * derivada de sus créditos y de su oficina de registro dé el resultado prometido con DATOS reales, que cada `:id` ajeno responda 404
 * (IDOR), que invitar / asignar respete la jerarquía y que la cuenta gratuita individual siga funcionando sin pedir nada.
 *
 *   Banco › Chuquisaca › {Mesa Verde, Padilla};  La Paz › El Alto
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
  isRoot: boolean;
}
interface BranchType {
  id: string;
  code: string;
}
interface ClientOut {
  id: string;
  otherCredits?: { count: number; totalOutstanding: number; responsibles: { userId: string; name: string }[] } | null;
}

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
let banco: { accountId: string; admin: string; root: Office };
let indiv: { accountId: string; admin: string };
const off: Record<string, Office> = {};
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
const roleId: Record<string, string> = {};

async function signup(businessName: string, plan?: string): Promise<{ accountId: string; admin: string }> {
  const email = `${businessName.toLowerCase().replace(/\W+/g, '-')}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, firstName: 'Dueño', lastName: businessName, email, password: 'Kobrax123!', ...(plan ? { planCode: plan } : {}) }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  return { accountId: owner.userAccounts[0]!.accountId, admin: await loginSkippingMfa(email) };
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

/** Un cliente con un crédito en `officeId` a cargo de `responsible` (sembrado por la base: lo que se prueba es la lectura). */
async function clientWithCredit(label: string, officeId: string, responsible: string, balance = 100): Promise<{ clientId: string; creditId: string }> {
  const client = await prisma.client.create({
    data: { accountId: banco.accountId, clientType: 'PERSON', firstName: label, lastName: 'Deudor', registeredBranchId: officeId },
  });
  const credit = await prisma.credit.create({
    data: {
      accountId: banco.accountId,
      clientId: client.id,
      branchId: officeId,
      code: `C-${label}-${suffix}`,
      principalAmount: balance,
      outstandingBalance: balance,
      currency: 'BOB',
      daysPastDue: 10,
      assignedManagerId: uid[responsible]!,
    },
  });
  return { clientId: client.id, creditId: credit.id };
}

const getClient = (token: string, id: string) => call<ClientOut>(token, 'GET', `/clients/${id}`);

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();

  const b = await signup('Banco Sur', 'PROFESSIONAL');
  await prisma.account.update({ where: { id: b.accountId }, data: { limitsOverride: { branches: 30, users: 60, credits: 500, clients: 500 } } });
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
  await member('supMV2', 'SUPERVISOR', off.MV!); // par de supMV en la misma oficina
  await member('colMV', 'COLLECTOR', off.MV!);
  await member('colPAD', 'COLLECTOR', off.PAD!);
  await member('colALT', 'COLLECTOR', off.ALT!);
  await member('mgrChq', 'MANAGER', off.CHQ!);
  await member('mgrRaiz', 'MANAGER', root);

  for (const r of await prisma.role.findMany()) roleId[r.name] = r.id;

  indiv = await signup('Cobranzas Don Pedro');
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F2 · el cliente no tiene dueño: se ve por sus créditos y por su oficina de registro', () => {
  let shared: { clientId: string; creditId: string; hiddenCreditId: string };

  before(async () => {
    // Un cliente con DOS créditos: uno en Mesa Verde (colMV) y otro en Padilla (colPAD).
    const first = await clientWithCredit('Compartido', off.MV!.id, 'colMV', 100);
    const second = await prisma.credit.create({
      data: {
        accountId: banco.accountId,
        clientId: first.clientId,
        branchId: off.PAD!.id,
        code: `C-Compartido-PAD-${suffix}`,
        principalAmount: 250.5,
        outstandingBalance: 250.5,
        currency: 'BOB',
        daysPastDue: 5,
        assignedManagerId: uid.colPAD!,
      },
    });
    shared = { ...first, hiddenCreditId: second.id };
  });

  it('🔴 el cobrador ve al cliente por SU crédito, y el aviso trae SÓLO agregados del otro (cantidad, saldo, responsable)', async () => {
    const r = await getClient(tok.colMV!, shared.clientId);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const other = r.data!.otherCredits;
    assert.equal(other?.count, 1);
    assert.equal(other?.totalOutstanding, 250.5);
    assert.deepEqual(other?.responsibles.map((p) => p.userId), [uid.colPAD]);
    assert.deepEqual(Object.keys(other!).sort(), ['count', 'responsibles', 'totalOutstanding']);
  });

  it('🔴 IDOR: el detalle del crédito ajeno sigue respondiendo 404 aunque el cliente sea visible', async () => {
    assert.equal((await call(tok.colMV!, 'GET', `/credits/${shared.hiddenCreditId}`)).status, 404);
    assert.equal((await call(tok.colMV!, 'GET', `/credits/${shared.creditId}`)).status, 200);
  });

  it('quien ve todo el subárbol no recibe aviso (ve ambos créditos)', async () => {
    const r = await getClient(tok.mgrChq!, shared.clientId);
    assert.equal(r.status, 200);
    assert.equal(r.data!.otherCredits ?? null, null);
  });

  it('🔴 IDOR: un cliente de otra regional responde 404 a cada `:id` (ficha, pdf, línea de tiempo)', async () => {
    const alto = await clientWithCredit('SoloAlto', off.ALT!.id, 'colALT');
    for (const path of [`/clients/${alto.clientId}`, `/clients/${alto.clientId}/pdf`, `/clients/${alto.clientId}/timeline`]) {
      assert.equal((await call(tok.mgrChq!, 'GET', path)).status, 404, path);
      assert.equal((await call(tok.colMV!, 'GET', path)).status, 404, path);
    }
    assert.equal((await getClient(tok.mgrRaiz!, alto.clientId)).status, 200);
  });

  it('🔴 sin accesos residuales: al perder el último crédito visible el cobrador deja de ver al cliente', async () => {
    const solo = await clientWithCredit('Traspaso', off.MV!.id, 'colMV');
    assert.equal((await getClient(tok.colMV!, solo.clientId)).status, 200);
    // Le quito el crédito (otro responsable de la misma oficina) y el cliente nunca queda «guardado» a su nombre.
    await prisma.credit.update({ where: { id: solo.creditId }, data: { assignedManagerId: uid.supMV! } });
    assert.equal((await getClient(tok.colMV!, solo.clientId)).status, 404);
    assert.equal((await getClient(tok.supMV!, solo.clientId)).status, 200);
  });

  it('el cliente sin crédito se ve por su oficina de registro (gerente de la regional) y NO por el cobrador de otra agencia', async () => {
    const huerfano = await prisma.client.create({
      data: { accountId: banco.accountId, clientType: 'PERSON', firstName: 'SinCredito', lastName: 'MV', registeredBranchId: off.MV!.id },
    });
    assert.equal((await getClient(tok.mgrChq!, huerfano.id)).status, 200);
    assert.equal((await getClient(tok.mgrRaiz!, huerfano.id)).status, 200);
    assert.equal((await getClient(tok.colPAD!, huerfano.id)).status, 404);
    assert.equal((await getClient(tok.colALT!, huerfano.id)).status, 404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F2 · client.create — la oficina de registro la decide el servidor', () => {
  const body = (over: Record<string, unknown> = {}) => ({ clientType: 'PERSON', firstName: 'Nuevo', lastName: `Cliente${randomUUID().slice(0, 6)}`, ...over });

  it('el cobrador registra en SU oficina y el cliente queda visible para él mientras no tenga crédito', async () => {
    const r = await call<ClientOut>(tok.colMV!, 'POST', '/clients', body());
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const row = await prisma.client.findUniqueOrThrow({ where: { id: r.data!.id } });
    assert.equal(row.registeredBranchId, off.MV!.id);
    assert.equal(row.createdBy, uid.colMV);
    assert.equal((await getClient(tok.colMV!, r.data!.id)).status, 200);
    assert.equal((await getClient(tok.colPAD!, r.data!.id)).status, 404);
  });

  it('🔴 el cobrador NO puede registrar en otra oficina aunque la pida', async () => {
    const r = await call(tok.colMV!, 'POST', '/clients', body({ branchId: off.PAD!.id }));
    assert.equal(r.status, 403);
    assert.equal(r.error?.code, 'CLIENT_BRANCH_OUT_OF_SCOPE');
  });

  it('el gerente elige una oficina de su alcance, y fuera de él se le niega', async () => {
    const ok = await call<ClientOut>(tok.mgrChq!, 'POST', '/clients', body({ branchId: off.PAD!.id }));
    assert.equal(ok.status, 201, JSON.stringify(ok.error));
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: ok.data!.id } })).registeredBranchId, off.PAD!.id);
    const no = await call(tok.mgrChq!, 'POST', '/clients', body({ branchId: off.ALT!.id }));
    assert.equal(no.status, 403);
    assert.equal(no.error?.code, 'CLIENT_BRANCH_OUT_OF_SCOPE');
  });

  it('🔴 nunca en la raíz de una cuenta con varias oficinas; sin oficina resuelta se pide una (422)', async () => {
    const raiz = await call(tok.mgrRaiz!, 'POST', '/clients', body());
    assert.equal(raiz.status, 422);
    assert.equal(raiz.error?.code, 'CLIENT_CREATE_AT_ROOT');
    const dueno = await call(banco.admin, 'POST', '/clients', body());
    assert.equal(dueno.status, 422);
    assert.equal(dueno.error?.code, 'CLIENT_BRANCH_UNRESOLVED');
  });

  it('🔴 sólo el administrador de la cuenta borra clientes (client:delete); gerente y cobrador reciben 403', async () => {
    const r = await call<ClientOut>(tok.colMV!, 'POST', '/clients', body());
    const id = r.data!.id;
    assert.equal((await call(tok.colMV!, 'DELETE', `/clients/${id}`)).status, 403);
    assert.equal((await call(tok.mgrChq!, 'DELETE', `/clients/${id}`)).status, 403);
    assert.equal((await call(banco.admin, 'DELETE', `/clients/${id}`)).status, 204);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F2 · credit.assign — a quién se puede destinar un crédito', () => {
  let creditId: string;
  before(async () => {
    creditId = (await clientWithCredit('Reparto', off.MV!.id, 'colMV')).creditId;
  });
  const bulk = (token: string, userId: string) => call<{ done?: unknown[]; skipped?: unknown[] }>(token, 'POST', '/assignments/bulk', { creditIds: [creditId], userId });

  it('🔴 un supervisor NO asigna a otro supervisor de su misma oficina', async () => {
    const r = await bulk(tok.supMV!, uid.supMV2!);
    assert.equal(r.status, 403, JSON.stringify(r));
    assert.equal(r.error?.code, 'CREDIT_ASSIGN_TIER');
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: creditId } })).assignedManagerId, uid.colMV);
  });

  it('el supervisor sí asigna a un cobrador de su agencia', async () => {
    const r = await bulk(tok.supMV!, uid.colMV!); // ya es suyo: se saltea, pero la política lo permite (no 403)
    assert.notEqual(r.status, 403, JSON.stringify(r));
  });

  it('el gerente (tier mayor) sí asigna a un supervisor', async () => {
    const r = await bulk(tok.mgrChq!, uid.supMV2!);
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.equal((await prisma.credit.findUniqueOrThrow({ where: { id: creditId } })).assignedManagerId, uid.supMV2);
  });

  it('🔴 nadie asigna hacia arriba: a un gerente no se le destina (la regla de destinatarios corta antes que la jerarquía)', async () => {
    const r = await bulk(tok.supMV!, uid.mgrChq!);
    assert.equal(r.status, 422, JSON.stringify(r));
    assert.equal(r.error?.code, 'ASSIGNEE_NOT_ELIGIBLE');
    // El «hacia arriba» entre roles asignables lo cubre credit-assign.spec.ts (tier del destino > tier del actor).
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F2 · member.invite / member.assignRole — la jerarquía de las personas', () => {
  const invite = (token: string, role: string, branchId: string | undefined, tag: string) =>
    call<{ userId: string }>(token, 'POST', '/users/invite', {
      firstName: 'Nuevo',
      lastName: tag,
      email: `inv-${tag}-${suffix}@ejemplo.com`,
      roleId: roleId[role],
      ...(branchId ? { branchId } : {}),
    });

  it('el gerente regional invita a un cobrador a una agencia de su regional', async () => {
    const r = await invite(tok.mgrChq!, 'COLLECTOR', off.MV!.id, 'cobrador');
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const asg = await prisma.userBranchAssignment.findMany({ where: { userId: r.data!.userId, revokedAt: null } });
    assert.deepEqual(asg.map((a) => a.branchId), [off.MV!.id]);
  });

  it('🔴 el gerente NO invita a otro gerente (mismo nivel) ni a una oficina fuera de su regional', async () => {
    const par = await invite(tok.mgrChq!, 'MANAGER', off.MV!.id, 'gerente');
    assert.equal(par.status, 403);
    assert.equal(par.error?.code, 'MEMBER_TIER_NOT_LOWER');
    const fuera = await invite(tok.mgrChq!, 'COLLECTOR', off.ALT!.id, 'fuera');
    assert.equal(fuera.status, 403);
    assert.equal(fuera.error?.code, 'MEMBER_OFFICE_OUT_OF_SCOPE');
  });

  it('🔴 nadie otorga ACCOUNT_ADMIN por invitación, ni siquiera el administrador (H-13)', async () => {
    const r = await invite(banco.admin, 'ACCOUNT_ADMIN', off.MV!.id, 'admin');
    assert.equal(r.status, 403);
    assert.equal(r.error?.code, 'MEMBER_ROLE_RESERVED');
  });

  it('🔴 tampoco por cambio de rol', async () => {
    const r = await call(banco.admin, 'PATCH', `/users/${uid.colMV}`, { roleId: roleId.ACCOUNT_ADMIN });
    assert.equal(r.status, 403);
    assert.equal(r.error?.code, 'MEMBER_ROLE_RESERVED');
  });

  it('el selector de roles no ofrece lo que el servidor negaría', async () => {
    const delGerente = (await call<{ name: string }[]>(tok.mgrChq!, 'GET', '/roles')).data ?? [];
    assert.ok(!delGerente.some((r) => r.name === 'MANAGER' || r.name === 'ACCOUNT_ADMIN'), JSON.stringify(delGerente));
    const delAdmin = (await call<{ name: string }[]>(banco.admin, 'GET', '/roles')).data ?? [];
    assert.ok(!delAdmin.some((r) => r.name === 'ACCOUNT_ADMIN'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F2 · regresión del tenant gratuito individual (RULES §C)', () => {
  it('el dueño crea cliente y crédito sin pedir oficina ni responsable, y se queda con ambos', async () => {
    const c = await call<ClientOut>(indiv.admin, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Ana', lastName: 'Quispe' });
    assert.equal(c.status, 201, JSON.stringify(c.error));
    const row = await prisma.client.findUniqueOrThrow({ where: { id: c.data!.id } });
    assert.ok(row.registeredBranchId, 'la oficina única se resuelve sola');
    const cr = await call<{ id: string }>(indiv.admin, 'POST', '/credits', { clientId: c.data!.id, principalAmount: 1200, installmentsCount: 12 });
    assert.equal(cr.status, 201, JSON.stringify(cr.error));
    const ficha = await getClient(indiv.admin, c.data!.id);
    assert.equal(ficha.status, 200);
    assert.equal(ficha.data!.otherCredits ?? null, null);
  });

  it('el dueño sigue pudiendo borrar un cliente sin créditos', async () => {
    const c = await call<ClientOut>(indiv.admin, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Borrar', lastName: 'Prueba' });
    assert.equal((await call(indiv.admin, 'DELETE', `/clients/${c.data!.id}`)).status, 204);
  });
});
