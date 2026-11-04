import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { assignedToRootSql, officeInMySubtreeSql, officeScopeKindOf, officeVisibilitySql } from './office-scope';
import { OfficeScopeService } from './office-scope.service';

const ROOT = '/r/';
const REGIONAL = '/r/chq/';
const AGENCIA = '/r/chq/mv/';

describe('F13 · tipo de alcance por capacidad (no por nombre de rol)', () => {
  const kind = (perms: string[]) => officeScopeKindOf((p) => perms.includes(p));

  it('all > subtree > branch > nada (falla cerrado)', () => {
    assert.equal(kind([Permission.DATA_SCOPE_ALL, Permission.DATA_SCOPE_SUBTREE, Permission.DATA_SCOPE_BRANCH]), 'ALL');
    assert.equal(kind([Permission.DATA_SCOPE_SUBTREE, Permission.DATA_SCOPE_BRANCH]), 'SUBTREE');
    assert.equal(kind([Permission.DATA_SCOPE_BRANCH]), 'BRANCH');
    assert.equal(kind([Permission.COLLECTION_WRITE]), 'OWN');
    assert.equal(kind([]), 'OWN');
  });
});

describe('F13 · fragmentos SQL del alcance', () => {
  const sql = (s: { sql: string }) => s.sql;

  it('subárbol: asignaciones vigentes de una persona activa, expandidas por prefijo de ruta, con el tenant del registro', () => {
    const s = officeInMySubtreeSql('u1');
    assert.match(sql(s), /user_branch_assignments ab/);
    assert.match(sql(s), /ab\.revoked_at IS NULL/);
    assert.match(sql(s), /uaa\.is_active = true/);
    assert.match(sql(s), /ob\.path LIKE mine\.path \|\| '%'/);
    assert.match(sql(s), /ab\.account_id = cr\.account_id/);
    assert.deepEqual(s.values, ['u1']);
  });

  it('raíz: sólo cuenta una asignación a la oficina raíz', () => {
    const s = assignedToRootSql('u1');
    assert.match(sql(s), /rb\.is_root = true/);
    assert.match(sql(s), /ar\.revoked_at IS NULL/);
  });

  it('BRANCH exige responsable y oficina no nula; SUBTREE no exige responsable y suma la raíz', () => {
    assert.match(sql(officeVisibilitySql('BRANCH', 'u1')), /cr\.assigned_manager_id IS NOT NULL AND cr\.branch_id IS NOT NULL/);
    const sub = sql(officeVisibilitySql('SUBTREE', 'u1'));
    assert.doesNotMatch(sub, /assigned_manager_id/);
    assert.match(sub, /rb\.is_root = true/);
  });
});

/** Un tx de mentira: lo justo que usa el servicio. */
function fakeTx(opts: {
  assignments?: { userId: string; path: string; active?: boolean }[];
  credits?: { id: string; path: string | null }[];
}) {
  return {
    userBranchAssignment: {
      findMany: async (args: { where: { userId: { in: string[] } } }) =>
        (opts.assignments ?? [])
          .filter((a) => args.where.userId.in.includes(a.userId) && a.active !== false)
          .map((a) => ({ userId: a.userId, branch: { path: a.path } })),
      count: async () => 0,
    },
    credit: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        (opts.credits ?? []).filter((c) => args.where.id.in.includes(c.id)).map((c) => ({ id: c.id, branch: c.path ? { path: c.path } : null })),
    },
  } as never;
}

function service(perms: string[], userId = 'u1') {
  return new OfficeScopeService({ accountId: 'acc', userId, can: (p: string) => perms.includes(p) } as never);
}

describe('F13 · OfficeScopeService', () => {
  it('ALL: sin consultar nada, reparte a toda la cuenta', async () => {
    assert.deepEqual(await service([Permission.DATA_SCOPE_ALL]).assignScope(fakeTx({})), { kind: 'ALL', paths: [] });
  });

  it('SUBTREE asignado a la RAÍZ equivale a ALL (cubre también lo que no tiene oficina)', async () => {
    const tx = fakeTx({ assignments: [{ userId: 'u1', path: ROOT }] });
    assert.deepEqual(await service([Permission.DATA_SCOPE_SUBTREE]).assignScope(tx), { kind: 'ALL', paths: [] });
  });

  it('SUBTREE en una regional: OFFICES con la ruta de la regional; la agencia de abajo queda dentro, la de otra regional no', async () => {
    const svc = service([Permission.DATA_SCOPE_SUBTREE]);
    const scope = await svc.assignScope(fakeTx({ assignments: [{ userId: 'u1', path: REGIONAL }] }));
    assert.deepEqual(scope, { kind: 'OFFICES', paths: [REGIONAL] });
    assert.equal(svc.inScope(scope, AGENCIA), true);
    assert.equal(svc.inScope(scope, '/r/lpz/ag/'), false);
    assert.equal(svc.inScope(scope, null), false);
  });

  it('BRANCH asignado a la raíz NO es ALL: conserva su regla (OFFICES con la raíz)', async () => {
    const scope = await service([Permission.DATA_SCOPE_BRANCH]).assignScope(fakeTx({ assignments: [{ userId: 'u1', path: ROOT }] }));
    assert.deepEqual(scope, { kind: 'OFFICES', paths: [ROOT] });
  });

  it('sin asignaciones (supervisor o gerente) no reparte nada: falla cerrado, nunca todo (A-4)', async () => {
    for (const p of [Permission.DATA_SCOPE_BRANCH, Permission.DATA_SCOPE_SUBTREE, Permission.ASSIGNMENT_WRITE]) {
      assert.deepEqual(await service([p]).assignScope(fakeTx({})), { kind: 'OFFICES', paths: [] });
    }
  });

  it('las rutas de N personas se piden juntas y se colapsan las cubiertas', async () => {
    const tx = fakeTx({
      assignments: [
        { userId: 'a', path: AGENCIA },
        { userId: 'a', path: REGIONAL },
        { userId: 'b', path: '/r/lpz/' },
      ],
    });
    const m = await service([]).assignmentPaths(tx, ['a', 'b', 'c']);
    assert.deepEqual(m.get('a'), [REGIONAL]);
    assert.deepEqual(m.get('b'), ['/r/lpz/']);
    assert.deepEqual(m.get('c'), []);
  });

  it('la ruta de la oficina de N créditos; sin oficina = null; inexistente = ausente', async () => {
    const tx = fakeTx({ credits: [{ id: 'c1', path: AGENCIA }, { id: 'c2', path: null }] });
    const m = await service([]).creditOfficePaths(tx, ['c1', 'c2', 'c3']);
    assert.equal(m.get('c1'), AGENCIA);
    assert.equal(m.get('c2'), null);
    assert.equal(m.has('c3'), false);
  });
});

/** Un tx con el árbol: Central (raíz) › Chuquisaca › Mesa Verde, y Central › La Paz (desactivada). */
function treeTx(opts: { assignments?: { userId: string; branchId: string }[]; onlyRoot?: boolean } = {}) {
  const all = [
    { id: 'root', path: '/root/', parentId: null, active: true, deletedAt: null, accountId: 'acc' },
    { id: 'chq', path: '/root/chq/', parentId: 'root', active: true, deletedAt: null, accountId: 'acc' },
    { id: 'mv', path: '/root/chq/mv/', parentId: 'chq', active: true, deletedAt: null, accountId: 'acc' },
    { id: 'lpz', path: '/root/lpz/', parentId: 'root', active: false, deletedAt: null, accountId: 'acc' },
    { id: 'otra', path: '/o/', parentId: null, active: true, deletedAt: null, accountId: 'OTRA' },
  ].filter((b) => !opts.onlyRoot || b.id === 'root');
  return {
    branch: {
      findFirst: async (a: { where: { id: string; accountId: string } }) => all.find((b) => b.id === a.where.id && b.accountId === a.where.accountId) ?? null,
      findMany: async () => all.filter((b) => b.accountId === 'acc' && b.active),
    },
    userBranchAssignment: {
      findMany: async (a: { where: { userId: string | { in: string[] } } }) =>
        (opts.assignments ?? [])
          .filter((x) => (typeof a.where.userId === 'string' ? x.userId === a.where.userId : a.where.userId.in.includes(x.userId)))
          .map((x) => ({ branchId: x.branchId, userId: x.userId, branch: { active: true, deletedAt: null, path: all.find((b) => b.id === x.branchId)!.path } })),
    },
  } as never;
}

describe('F13 · A-6 resolveCreditBranch: la oficina del crédito la decide el servidor', () => {
  const admin = () => service([Permission.DATA_SCOPE_ALL]);
  const supervisor = () => service([Permission.DATA_SCOPE_BRANCH]);

  it('1 · explícita: debe existir, ser de la cuenta, estar activa y en el alcance', async () => {
    const tx = treeTx({ assignments: [{ userId: 'u1', branchId: 'mv' }] });
    assert.equal(await admin().resolveCreditBranch(tx, { branchId: 'chq' }), 'chq');
    await assert.rejects(admin().resolveCreditBranch(tx, { branchId: 'otra' }), (e: { response?: { code?: string; details?: { reason: string } } }) => e.response?.code === 'CREDIT_BRANCH_INVALID' && e.response.details?.reason === 'NOT_FOUND');
    await assert.rejects(admin().resolveCreditBranch(tx, { branchId: 'nada' }), (e: { response?: { code?: string } }) => e.response?.code === 'CREDIT_BRANCH_INVALID');
    await assert.rejects(admin().resolveCreditBranch(tx, { branchId: 'lpz' }), (e: { response?: { details?: { reason: string } } }) => e.response?.details?.reason === 'INACTIVE');
    // El supervisor de Mesa Verde no puede poner un crédito en Chuquisaca (fuera de su subárbol), sí en su agencia.
    assert.equal(await supervisor().resolveCreditBranch(tx, { branchId: 'mv' }), 'mv');
    await assert.rejects(supervisor().resolveCreditBranch(tx, { branchId: 'chq' }), (e: { response?: { details?: { reason: string } } }) => e.response?.details?.reason === 'OUT_OF_SCOPE');
  });

  it('2 · sin oficina: la de la ÚNICA asignación vigente del responsable', async () => {
    const tx = treeTx({ assignments: [{ userId: 'resp', branchId: 'mv' }] });
    assert.equal(await admin().resolveCreditBranch(tx, { responsibleId: 'resp' }), 'mv');
  });

  it('2b · un responsable con DOS asignaciones no decide: cae a la regla 3 y, con varias hojas, a 422', async () => {
    const tx = treeTx({ assignments: [{ userId: 'resp', branchId: 'mv' }, { userId: 'resp', branchId: 'chq' }] });
    // hojas activas: mv y (lpz está desactivada) → una sola hoja viva: mv
    assert.equal(await admin().resolveCreditBranch(tx, { responsibleId: 'resp' }), 'mv');
  });

  it('3 · sin oficina ni responsable: la de la ÚNICA asignación de QUIEN CREA (antes de la regla de la hoja)', async () => {
    const tx = treeTx({ assignments: [{ userId: 'u1', branchId: 'chq' }] });
    assert.equal(await admin().resolveCreditBranch(tx, {}), 'chq');
    // el responsable sin oficina cae a quien crea
    assert.equal(await admin().resolveCreditBranch(tx, { responsibleId: 'sin-oficina' }), 'chq');
    // el orden se conserva: la oficina del responsable gana a la de quien crea
    const dos = treeTx({ assignments: [{ userId: 'u1', branchId: 'chq' }, { userId: 'resp', branchId: 'mv' }] });
    assert.equal(await admin().resolveCreditBranch(dos, { responsibleId: 'resp' }), 'mv');
  });

  it('3b · quien crea con DOS asignaciones o ninguna no decide: sigue la regla de la hoja o el 422', async () => {
    const tx = {
      branch: { findMany: async () => [{ id: 'a', parentId: 'r' }, { id: 'b', parentId: 'r' }, { id: 'r', parentId: null }] },
      userBranchAssignment: { findMany: async () => [{ branchId: 'a', branch: { active: true, deletedAt: null } }, { branchId: 'b', branch: { active: true, deletedAt: null } }] },
    } as never;
    await assert.rejects(admin().resolveCreditBranch(tx, {}), (e: { response?: { code?: string; message?: string } }) => e.response?.code === 'CREDIT_BRANCH_UNRESOLVED' && /oficina/i.test(e.response.message ?? ''));
  });

  it('3 · sin responsable con oficina: la raíz si no hay agencias (tenant individual)', async () => {
    assert.equal(await admin().resolveCreditBranch(treeTx({ onlyRoot: true }), {}), 'root');
  });

  it('3b · con una sola agencia viva, esa agencia', async () => {
    assert.equal(await admin().resolveCreditBranch(treeTx(), {}), 'mv');
  });

  it('4 · si no se resuelve (varias hojas y nada que decida) → 422 CREDIT_BRANCH_UNRESOLVED, nunca NULL', async () => {
    const tx = {
      branch: { findMany: async () => [{ id: 'a', parentId: 'r' }, { id: 'b', parentId: 'r' }, { id: 'r', parentId: null }] },
      userBranchAssignment: { findMany: async () => [] },
    } as never;
    await assert.rejects(admin().resolveCreditBranch(tx, { responsibleId: 'sin-oficina' }), (e: { response?: { code?: string } }) => e.response?.code === 'CREDIT_BRANCH_UNRESOLVED');
  });
});
