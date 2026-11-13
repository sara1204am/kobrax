import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { CreditsService } from './credits.service';
import { OfficeScopeService } from '../../common/office-scope/office-scope.service';

/** F13 · `GET /credits?branchId=` es «ese nodo y su subárbol», acotado por el alcance de quien pide. */
function make(perms: string[], opts: { nodePath?: string | null; assignments?: string[] } = {}) {
  const calls = { where: undefined as Record<string, unknown> | undefined, raw: [] as string[] };
  const tx = {
    $queryRaw: async (q: { sql?: string; strings?: readonly string[]; values?: unknown[] }) => {
      calls.raw.push(`${(q.strings ?? [q.sql ?? '']).join('?')} ${JSON.stringify(q.values ?? [])}`);
      return /count\(\*\)/.test((q.strings ?? [q.sql ?? '']).join('')) ? [{ n: 0n }] : [];
    },
    branch: { findFirst: async () => (opts.nodePath === null ? null : { path: opts.nodePath ?? '/r/chq/' }) },
    userBranchAssignment: { findMany: async () => (opts.assignments ?? []).map((path) => ({ userId: 'u1', branch: { path } })) },
    credit: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        calls.where = a.where;
        return [];
      },
      count: async () => 0,
    },
    account: { findUnique: async () => ({ currencyCode: 'BOB', configuration: {}, settings: {} }), findFirst: async () => ({ configuration: {}, settings: {} }) },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc', userId: 'u1', can: (p: string) => perms.includes(p) };
  const service = new CreditsService(prisma as never, tenant as never, { record: async () => undefined } as never, {} as never, {} as never, {} as never, new OfficeScopeService(tenant as never));
  return { service, calls };
}

describe('F13 · credits.list con branchId', () => {
  it('equivalencia: sin branchId ni subárbol el where es el de siempre', async () => {
    const { service, calls } = make([Permission.DATA_SCOPE_ALL]);
    await service.list({} as never);
    assert.deepEqual(calls.where, { deletedAt: null });
  });

  it('una oficina hoja filtra por su ruta (prefijo): trae lo suyo, que es lo mismo que la igualdad de antes', async () => {
    const { service, calls } = make([Permission.DATA_SCOPE_ALL], { nodePath: '/r/chq/mv/' });
    await service.list({ branchId: 'mv' } as never);
    assert.deepEqual(calls.where, { deletedAt: null, AND: [{ branch: { path: { startsWith: '/r/chq/mv/' } } }] });
  });

  it('una regional (Chuquisaca) trae su subárbol: el prefijo de su ruta cubre las 6 agencias', async () => {
    const { service, calls } = make([Permission.DATA_SCOPE_ALL], { nodePath: '/r/chq/' });
    await service.list({ branchId: 'chq' } as never);
    const prefix = ((calls.where!.AND as { branch: { path: { startsWith: string } } }[])[0]!).branch.path.startsWith;
    for (const agencia of ['/r/chq/mv/', '/r/chq/cen/', '/r/chq/lyv/', '/r/chq/pad/', '/r/chq/mon/', '/r/chq/cam/']) assert.ok(agencia.startsWith(prefix));
    assert.ok(!'/r/lpz/alt/'.startsWith(prefix));
  });

  it('🔴 D-7: quien no ve toda la cuenta pagina EN SQL con la regla de Mora (nunca trae la lista de ids a memoria)', async () => {
    const { service, calls } = make([Permission.DATA_SCOPE_SUBTREE], { nodePath: '/r/lpz/', assignments: ['/r/chq/'] });
    await service.list({ branchId: 'lpz' } as never);
    assert.deepEqual(calls.where, { id: { in: [] } }, 'sólo hidrata la página por id: el alcance se aplicó en SQL');
    assert.equal(calls.raw.length, 2, 'página + total');
    assert.ok(calls.raw[0]!.includes('user_branch_assignments'), 'usa la visibilidad por asignaciones');
    assert.ok(calls.raw[0]!.includes('/r/lpz/%'), 'y el filtro de oficina pedido, como prefijo');
  });

  it('el supervisor y el cobrador también quedan acotados; un branchId ajeno no calza con nada', async () => {
    for (const perms of [[Permission.DATA_SCOPE_BRANCH], []]) {
      const m = make(perms, { assignments: ['/r/chq/'] });
      await m.service.list({} as never);
      assert.deepEqual(m.calls.where, { id: { in: [] } });
      assert.equal(m.calls.raw.length, 2);
    }
    const ajena = make([Permission.DATA_SCOPE_ALL], { nodePath: null });
    await ajena.service.list({ branchId: 'x' } as never);
    assert.deepEqual(ajena.calls.where, { deletedAt: null, AND: [{ branch: { path: { startsWith: '/__sin_oficina__/' } } }] });
  });
});

describe('F13 · reassign-office con fromBranchId (toda la cartera de una oficina)', () => {
  function makeMove(opts: { fromPath?: string | null; rows?: number; scope?: { kind: 'ALL' | 'OFFICES'; paths: string[] } } = {}) {
    const updates: string[][] = [];
    const timeouts: (number | undefined)[] = [];
    const order: string[] = [];
    const rows = Array.from({ length: opts.rows ?? 3 }, (_, i) => ({ id: `c${i}`, branchId: 'raiz', branch: { path: '/r/' } }));
    const tx = {
      branch: { findFirst: async () => (opts.fromPath === null ? null : { id: 'raiz', path: opts.fromPath ?? '/r/' }) },
      credit: {
        findMany: async (a: { where: { branchId?: string; id?: unknown } }) => (a.where.branchId === 'raiz' ? rows : a.where.id ? rows.slice(0, 1) : []),
        updateMany: async (a: { where: { id: { in: string[] } } }) => (updates.push(a.where.id.in), order.push('update'), { count: a.where.id.in.length }),
      },
      auditLog: { createMany: async (a: { data: unknown[] }) => (audited.push(a.data), order.push('audit'), { count: a.data.length }) },
    };
    const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>, timeout?: number) => (timeouts.push(timeout), fn(tx)) };
    const tenant = { accountId: 'acc', userId: 'u1', get: () => ({ ip: '1.1.1.1' }), can: () => true };
    const audited: unknown[][] = [];
    const office = {
      assignScope: async () => opts.scope ?? { kind: 'ALL', paths: [] },
      assertBranchUsable: async (_t: unknown, id: string) => ({ id, path: `/r/${id}/` }),
      inScope: new OfficeScopeService(tenant as never).inScope,
    };
    const service = new CreditsService(prisma as never, tenant as never, { recordMany: async () => { throw new Error('la auditoría va DENTRO de la transacción, no por recordMany'); } } as never, {} as never, {} as never, {} as never, office as never);
    return { service, updates, audited, timeouts, order };
  }
  const code = (c: string) => (e: { response?: { code?: string } }) => e.response?.code === c;

  it('mueve TODA la cartera de la raíz a su primera hija, auditada por crédito', async () => {
    const { service, updates, audited } = makeMove();
    const r = await service.reassignOffice({ fromBranchId: 'raiz', toBranchId: 'hija' });
    assert.deepEqual(r, { moved: 3, unchanged: 0, toBranchId: 'hija' });
    assert.deepEqual(updates, [['c0', 'c1', 'c2']]);
    assert.equal(audited.flat().length, 3);
  });

  it('🔴 la auditoría se escribe dentro de la transacción, lote a lote, y la de «toda la cartera» pide un timeout holgado (120 s)', async () => {
    const { service, order, timeouts } = makeMove({ rows: 600 });
    await service.reassignOffice({ fromBranchId: 'raiz', toBranchId: 'hija' });
    assert.deepEqual(order, ['update', 'audit', 'update', 'audit']);
    assert.deepEqual(timeouts, [120_000]);
    const lote = makeMove();
    await lote.service.reassignOffice({ creditIds: ['c0'], toBranchId: 'hija' });
    assert.deepEqual(lote.timeouts, [undefined], 'el lote explícito (≤500) usa el tope normal');
  });

  it('en lotes de 500 dentro de la misma transacción', async () => {
    const { service, updates } = makeMove({ rows: 1200 });
    const r = await service.reassignOffice({ fromBranchId: 'raiz', toBranchId: 'hija' });
    assert.equal(r.moved, 1200);
    assert.deepEqual(updates.map((u) => u.length), [500, 500, 200]);
  });

  it('exactamente una forma: ni las dos ni ninguna (400)', async () => {
    const { service } = makeMove();
    await assert.rejects(service.reassignOffice({ toBranchId: 'x' } as never), code('CREDIT_REASSIGN_ARGS'));
    await assert.rejects(service.reassignOffice({ creditIds: ['a'], fromBranchId: 'raiz', toBranchId: 'x' } as never), code('CREDIT_REASSIGN_ARGS'));
  });

  it('origen fuera del alcance o inexistente: no mueve nada', async () => {
    const fuera = makeMove({ scope: { kind: 'OFFICES', paths: ['/r/chq/'] } });
    await assert.rejects(fuera.service.reassignOffice({ fromBranchId: 'raiz', toBranchId: 'hija' }), code('CREDIT_OFFICE_OUT_OF_SCOPE'));
    assert.equal(fuera.updates.length, 0);
    const nada = makeMove({ fromPath: null });
    await assert.rejects(nada.service.reassignOffice({ fromBranchId: 'raiz', toBranchId: 'hija' }), code('CREDIT_BRANCH_INVALID'));
  });
});
