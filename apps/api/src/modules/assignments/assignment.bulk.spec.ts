import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission, RoleType } from '@kobrax/shared';
import { AssignmentService } from './assignment.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

interface CreditFake { id: string; assignedManagerId: string | null; branchId: string | null; deletedAt?: Date | null }
interface Member { userId: string; role: string; isActive: boolean; branchId: string | null }
interface Perm { id: string; creditId: string; userId: string; revokedAt: Date | null }

function makeService(opts: { permissions?: string[]; userId?: string; credits: CreditFake[]; members: Member[]; agenda?: { id: string; creditId: string; assigneeId: string }[]; conflictOn?: string }) {
  const credits = new Map(opts.credits.map((c) => [c.id, { deletedAt: null, ...c }]));
  const perms: Perm[] = opts.credits.filter((c) => c.assignedManagerId).map((c) => ({ id: `p-${c.id}`, creditId: c.id, userId: c.assignedManagerId!, revokedAt: null }));
  const agenda = (opts.agenda ?? []).map((a) => ({ ...a }));
  const audited: { action: string; entityId: string; after: Record<string, unknown> }[] = [];
  let txCount = 0;
  let seq = 0;
  const tx = {
    credit: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        const c = credits.get(where.id);
        return c && !c.deletedAt ? { id: c.id, assignedManagerId: c.assignedManagerId } : null;
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => {
          const c = credits.get(id);
          return c && !c.deletedAt ? [{ id: c.id, assignedManagerId: c.assignedManagerId, branchId: c.branchId }] : [];
        }),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { assignedManagerId: string | null } }) => {
        for (const id of where.id.in) credits.get(id)!.assignedManagerId = data.assignedManagerId;
        return { count: where.id.in.length };
      },
    },
    creditAssignment: {
      findMany: async ({ where }: { where: { creditId: { in: string[] } } }) => perms.filter((p) => where.creditId.in.includes(p.creditId) && !p.revokedAt),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { revokedAt: Date } }) => {
        for (const p of perms) if (where.id.in.includes(p.id)) p.revokedAt = data.revokedAt;
        return { count: 1 };
      },
      createMany: async ({ data }: { data: { creditId: string; userId: string }[] }) => {
        if (data.some((d) => d.creditId === opts.conflictOn)) throw Object.assign(Object.create(null), { response: { code: 'ASSIGNMENT_CONFLICT' } });
        for (const d of data) perms.push({ id: `n${++seq}`, creditId: d.creditId, userId: d.userId, revokedAt: null });
        return { count: data.length };
      },
    },
    agendaItem: {
      findMany: async ({ where }: { where: { creditId: { in: string[] }; assigneeId: string } }) =>
        agenda.filter((a) => where.creditId.in.includes(a.creditId) && a.assigneeId === where.assigneeId).map((a) => ({ id: a.id, creditId: a.creditId })),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { assigneeId: string } }) => {
        for (const a of agenda) if (where.id.in.includes(a.id)) a.assigneeId = data.assigneeId;
        return { count: 1 };
      },
    },
    userAccount: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
        opts.members.filter((m) => where.userId.in.includes(m.userId)).map((m) => ({ userId: m.userId, isActive: m.isActive, branchId: m.branchId, role: { name: m.role } })),
      findFirst: async ({ where }: { where: { userId?: string } }) => {
        const m = opts.members.find((x) => x.userId === where.userId);
        return m ? { branchId: m.branchId } : null;
      },
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => (txCount++, fn(tx)) };
  const permissions = opts.permissions ?? [Permission.ASSIGNMENT_WRITE, Permission.DATA_SCOPE_ALL];
  const tenant = { accountId: 'acc-A', userId: opts.userId ?? 'boss', can: (p: string) => permissions.includes(p) };
  const audit = { recordMany: async (e: typeof audited) => void audited.push(...e) };
  const service = new AssignmentService(prisma as never, tenant as never, audit as never);
  return { service, tx: tx as never, credits, perms, agenda, audited, txCount: () => txCount };
}

const juan: Member = { userId: 'juan', role: RoleType.COLLECTOR, isActive: true, branchId: 'ag-1' };
const maria: Member = { userId: 'maria', role: RoleType.COLLECTOR, isActive: true, branchId: 'ag-2' };
const ana: Member = { userId: 'ana', role: RoleType.COLLECTOR, isActive: true, branchId: 'ag-1' };

describe('AssignmentService.bulkReassign (POST /assignments/bulk)', () => {
  it('reasigna el responsable de varios créditos con apply(): tabla + columna, traspaso de agenda y auditoría', async () => {
    const { service, credits, perms, agenda, audited } = makeService({
      credits: [
        { id: 'c1', assignedManagerId: 'ana', branchId: 'ag-1' },
        { id: 'c2', assignedManagerId: null, branchId: 'ag-1' },
      ],
      members: [juan, ana],
      agenda: [{ id: 'a1', creditId: 'c1', assigneeId: 'ana' }],
    });
    const r = await service.bulkReassign({ creditIds: ['c1', 'c2'], userId: 'juan' });
    assert.deepEqual(r, { changed: 2, skipped: [] });
    assert.equal(credits.get('c1')!.assignedManagerId, 'juan');
    assert.equal(credits.get('c2')!.assignedManagerId, 'juan');
    assert.deepEqual(perms.filter((p) => !p.revokedAt).map((p) => `${p.creditId}>${p.userId}`).sort(), ['c1>juan', 'c2>juan']);
    assert.equal(agenda[0]!.assigneeId, 'juan'); // D10: lo agendado pendiente pasa al nuevo
    assert.equal(audited.length, 2);
    assert.equal(audited[0]!.after.reason, 'BULK_REASSIGN');
    assert.equal(audited[0]!.after.bulk, true);
  });

  it('atómico por crédito: cada uno va en su transacción', async () => {
    const { service, txCount } = makeService({
      credits: [{ id: 'c1', assignedManagerId: 'ana', branchId: 'ag-1' }, { id: 'c2', assignedManagerId: 'ana', branchId: 'ag-1' }],
      members: [juan, ana],
    });
    await service.bulkReassign({ creditIds: ['c1', 'c2'], userId: 'juan' });
    assert.equal(txCount(), 3); // validación del destinatario + una por crédito
  });

  it('saltea los que no se pueden y informa por qué: no existe, ya es suyo, repetidos se quitan', async () => {
    const { service } = makeService({
      credits: [
        { id: 'c1', assignedManagerId: 'juan', branchId: 'ag-1' },
        { id: 'c2', assignedManagerId: 'ana', branchId: 'ag-1' },
        { id: 'c3', assignedManagerId: 'ana', branchId: 'ag-1', deletedAt: new Date() },
      ],
      members: [juan, ana],
    });
    const r = await service.bulkReassign({ creditIds: ['c1', 'c2', 'c2', 'c3', 'fantasma'], userId: 'juan' });
    assert.equal(r.changed, 1);
    assert.deepEqual(r.skipped, [
      { creditId: 'c1', reason: 'ALREADY_ASSIGNED' },
      { creditId: 'c3', reason: 'NOT_FOUND' },
      { creditId: 'fantasma', reason: 'NOT_FOUND' },
    ]);
  });

  it('supervisor: los créditos de otra agencia se saltean (OUT_OF_AGENCY) y los de la suya se reasignan', async () => {
    const { service, credits } = makeService({
      permissions: [Permission.ASSIGNMENT_WRITE, Permission.DATA_SCOPE_BRANCH],
      userId: 'sup',
      credits: [
        { id: 'c-mio', assignedManagerId: 'ana', branchId: 'ag-1' },
        { id: 'c-ajeno', assignedManagerId: 'maria', branchId: 'ag-2' },
      ],
      members: [juan, ana, maria, { userId: 'sup', role: RoleType.SUPERVISOR, isActive: true, branchId: 'ag-1' }],
    });
    const r = await service.bulkReassign({ creditIds: ['c-mio', 'c-ajeno'], userId: 'juan' });
    assert.equal(r.changed, 1);
    assert.deepEqual(r.skipped, [{ creditId: 'c-ajeno', reason: 'OUT_OF_AGENCY' }]);
    assert.equal(credits.get('c-mio')!.assignedManagerId, 'juan');
    assert.equal(credits.get('c-ajeno')!.assignedManagerId, 'maria'); // intacto
  });

  it('supervisor: un destinatario de otra agencia deja todos los créditos en OUT_OF_AGENCY', async () => {
    const { service } = makeService({
      permissions: [Permission.ASSIGNMENT_WRITE, Permission.DATA_SCOPE_BRANCH],
      userId: 'sup',
      credits: [{ id: 'c1', assignedManagerId: 'ana', branchId: 'ag-1' }],
      members: [maria, ana, { userId: 'sup', role: RoleType.SUPERVISOR, isActive: true, branchId: 'ag-1' }],
    });
    const r = await service.bulkReassign({ creditIds: ['c1'], userId: 'maria' });
    assert.deepEqual(r, { changed: 0, skipped: [{ creditId: 'c1', reason: 'OUT_OF_AGENCY' }] });
  });

  it('un destinatario que no es cobrador/supervisor activo es 422 de toda la petición y no toca nada', async () => {
    const { service, credits } = makeService({
      credits: [{ id: 'c1', assignedManagerId: 'ana', branchId: 'ag-1' }],
      members: [ana, { userId: 'gte', role: RoleType.MANAGER, isActive: true, branchId: null }],
    });
    await rejectsWithCode(service.bulkReassign({ creditIds: ['c1'], userId: 'gte' }), 'ASSIGNEE_NOT_ELIGIBLE');
    assert.equal(credits.get('c1')!.assignedManagerId, 'ana');
  });

  it('exige assignment:write (403)', async () => {
    const { service } = makeService({ permissions: [], credits: [], members: [juan] });
    await rejectsWithCode(service.bulkReassign({ creditIds: ['c1'], userId: 'juan' }), 'ASSIGNMENT_FORBIDDEN');
  });

  it('un choque de concurrencia en un crédito lo saltea (CONFLICT) sin frenar los demás', async () => {
    const { service, credits } = makeService({
      credits: [{ id: 'c1', assignedManagerId: 'ana', branchId: 'ag-1' }, { id: 'c2', assignedManagerId: 'ana', branchId: 'ag-1' }],
      members: [juan, ana],
      conflictOn: 'c1',
    });
    const r = await service.bulkReassign({ creditIds: ['c1', 'c2'], userId: 'juan' });
    assert.equal(r.changed, 1);
    assert.deepEqual(r.skipped, [{ creditId: 'c1', reason: 'CONFLICT' }]);
    assert.equal(credits.get('c2')!.assignedManagerId, 'juan');
  });
});

describe('AssignmentService.assertAssigneesInAgency (destinatarios de créditos nuevos de una importación)', () => {
  const sup = { permissions: [Permission.ASSIGNMENT_WRITE, Permission.DATA_SCOPE_BRANCH], userId: 'sup', credits: [] as CreditFake[] };
  const supMember: Member = { userId: 'sup', role: RoleType.SUPERVISOR, isActive: true, branchId: 'ag-1' };

  it('supervisor: destinatarios de su agencia pasan', async () => {
    const { service, tx } = makeService({ ...sup, members: [juan, ana, supMember] });
    await service.assertAssigneesInAgency(tx, ['juan', 'ana']);
  });

  it('supervisor: uno de otra agencia, o inexistente, es 403 ASSIGNMENT_OUT_OF_AGENCY', async () => {
    const { service, tx } = makeService({ ...sup, members: [juan, maria, supMember] });
    await rejectsWithCode(service.assertAssigneesInAgency(tx, ['juan', 'maria']), 'ASSIGNMENT_OUT_OF_AGENCY');
    await rejectsWithCode(service.assertAssigneesInAgency(tx, ['fantasma']), 'ASSIGNMENT_OUT_OF_AGENCY');
  });

  it('gerente / administrador: sin límite', async () => {
    const { service, tx } = makeService({ credits: [], members: [maria] });
    await service.assertAssigneesInAgency(tx, ['maria']);
  });
});
