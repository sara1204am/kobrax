import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { Permission, RoleType } from '@kobrax/shared';
import { AssignmentService } from './assignment.service';
import { agencyViolations, isAssignable, notAssignable } from './assignment-rules';
import { rejectsWithCode } from '../auth/auth-test-utils';

interface Row {
  id: string;
  creditId: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  caseId: string | null;
}

/**
 * Una base en memoria con lo justo: créditos (con su columna), asignaciones y miembros. Alcanza para
 * probar lo que importa del servicio —qué filas revoca y crea, y que la columna queda igual a la tabla—
 * sin levantar Postgres.
 */
function makeService(opts: {
  permissions?: string[];
  userId?: string;
  credits?: { id: string; assignedManagerId: string | null; deletedAt?: Date | null }[];
  rows?: Row[];
  members?: { userId: string; isActive: boolean; role: string }[];
  createFails?: boolean;
}) {
  const credits = new Map((opts.credits ?? []).map((c) => [c.id, { ...c, deletedAt: c.deletedAt ?? null }]));
  const rows: Row[] = [...(opts.rows ?? [])];
  const audited: { action: string; entityId: string; after: unknown }[] = [];
  let seq = 0;

  const tx = {
    credit: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => {
          const c = credits.get(id);
          return c && !c.deletedAt ? [{ id: c.id, assignedManagerId: c.assignedManagerId }] : [];
        }),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { assignedManagerId: string | null } }) => {
        for (const id of where.id.in) credits.get(id)!.assignedManagerId = data.assignedManagerId;
        return { count: where.id.in.length };
      },
    },
    creditAssignment: {
      findMany: async ({ where }: { where: { creditId: { in: string[] } } }) =>
        rows.filter((r) => where.creditId.in.includes(r.creditId) && !r.revokedAt && !r.expiresAt && !r.caseId),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { revokedAt: Date } }) => {
        for (const r of rows) if (where.id.in.includes(r.id)) r.revokedAt = data.revokedAt;
        return { count: where.id.in.length };
      },
      createMany: async ({ data }: { data: { creditId: string; userId: string }[] }) => {
        if (opts.createFails) {
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
        }
        for (const d of data) rows.push({ id: `new-${++seq}`, creditId: d.creditId, userId: d.userId, revokedAt: null, expiresAt: null, caseId: null });
        return { count: data.length };
      },
    },
    // D10: sin agendados pendientes en estos casos (los cubre `assignment.coverage.spec.ts`).
    agendaItem: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    userAccount: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
        (opts.members ?? [])
          .filter((m) => where.userId.in.includes(m.userId))
          .map((m) => ({ userId: m.userId, isActive: m.isActive, role: { name: m.role } })),
    },
  };
  const permissions = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: opts.userId ?? 'boss', can: (p: string) => permissions.includes(p) };
  const audit = { recordMany: async (e: typeof audited) => void audited.push(...e) };
  const service = new AssignmentService({} as never, tenant as never, audit as never);
  const active = (creditId: string) => rows.filter((r) => r.creditId === creditId && !r.revokedAt).map((r) => r.userId);
  return { service, tx: tx as never, credits, rows, audited, active };
}

describe('P3 · a quién se le puede asignar', () => {
  const juan = { userId: 'juan', role: RoleType.COLLECTOR, isActive: true };
  it('a un cobrador activo, o a uno mismo aunque no sea cobrador', () => {
    assert.equal(isAssignable(juan, 'boss'), true);
    assert.equal(isAssignable({ userId: 'boss', role: RoleType.MANAGER, isActive: true }, 'boss'), true);
  });
  it('D8 · un supervisor también puede tener créditos a su cargo', () => {
    assert.equal(isAssignable({ userId: 'sup', role: RoleType.SUPERVISOR, isActive: true }, 'boss'), true);
    assert.equal(isAssignable({ userId: 'sup', role: RoleType.SUPERVISOR, isActive: false }, 'boss'), false);
  });

  it('no a un gerente que no es uno mismo, ni a un cobrador inactivo, ni a alguien de afuera', () => {
    assert.equal(isAssignable({ userId: 'otro', role: RoleType.MANAGER, isActive: true }, 'boss'), false);
    assert.equal(isAssignable({ ...juan, isActive: false }, 'boss'), false);
    assert.deepEqual(notAssignable(['juan', 'fantasma', 'fantasma'], [juan], 'boss'), ['fantasma']);
  });
});

describe('D8 · el supervisor reparte sólo dentro de su agencia', () => {
  const sup = { kind: 'BRANCH' as const, branchId: 'ag-1' };
  const credits = [
    { id: 'c-propio', branchId: 'ag-1' },
    { id: 'c-ajeno', branchId: 'ag-2' },
    { id: 'c-sin-agencia', branchId: null },
  ];
  const people = [
    { userId: 'juan', branchId: 'ag-1' },
    { userId: 'maria', branchId: 'ag-2' },
    { userId: 'sin', branchId: null },
  ];

  it('gerente y administrador (ALL) no tienen límite', () => {
    assert.deepEqual(agencyViolations({ kind: 'ALL', branchId: null }, credits, people), { creditIds: [], userIds: [] });
  });

  it('el supervisor: créditos de su agencia a gente de su agencia', () => {
    assert.deepEqual(agencyViolations(sup, [credits[0]!], [people[0]!]), { creditIds: [], userIds: [] });
  });

  it('un crédito de otra agencia o sin agencia, o un destinatario de otra agencia o sin ella, se señala', () => {
    assert.deepEqual(agencyViolations(sup, credits, people), {
      creditIds: ['c-ajeno', 'c-sin-agencia'],
      userIds: ['maria', 'sin'],
    });
  });

  it('un supervisor sin agencia no puede repartir nada (null no es igual a ninguna agencia)', () => {
    const v = agencyViolations({ kind: 'BRANCH', branchId: null }, [{ id: 'c', branchId: null }], [{ userId: 'u', branchId: null }]);
    assert.deepEqual(v, { creditIds: ['c'], userIds: ['u'] });
  });
});

describe('AssignmentService.apply — tabla y columna, siempre juntas', () => {
  it('asigna por primera vez: crea la permanente y escribe la columna', async () => {
    const { service, tx, credits, active } = makeService({ credits: [{ id: 'c1', assignedManagerId: null }] });
    const changes = await service.apply(tx, [{ creditId: 'c1', to: 'juan' }], 'IMPORT_CHOSEN');
    assert.deepEqual(changes, [{ creditId: 'c1', from: null, to: 'juan', reason: 'IMPORT_CHOSEN' }]);
    assert.deepEqual(active('c1'), ['juan']);
    assert.equal(credits.get('c1')!.assignedManagerId, 'juan');
  });

  it('reasigna: revoca la anterior (no la borra) y crea la nueva', async () => {
    const { service, tx, credits, rows, active } = makeService({
      credits: [{ id: 'c1', assignedManagerId: 'juan' }],
      rows: [{ id: 'a1', creditId: 'c1', userId: 'juan', revokedAt: null, expiresAt: null, caseId: null }],
    });
    const changes = await service.apply(tx, [{ creditId: 'c1', to: 'maria', expectedFrom: 'juan' }], 'MANUAL');
    assert.deepEqual(changes, [{ creditId: 'c1', from: 'juan', to: 'maria', reason: 'MANUAL' }]);
    assert.deepEqual(active('c1'), ['maria']);
    assert.ok(rows.find((r) => r.id === 'a1')!.revokedAt, 'la de Juan queda revocada, como historial');
    assert.equal(credits.get('c1')!.assignedManagerId, 'maria');
  });

  it('pedir el que ya está no es un cambio: no escribe ni audita', async () => {
    const { service, tx, rows } = makeService({
      credits: [{ id: 'c1', assignedManagerId: 'juan' }],
      rows: [{ id: 'a1', creditId: 'c1', userId: 'juan', revokedAt: null, expiresAt: null, caseId: null }],
    });
    assert.deepEqual(await service.apply(tx, [{ creditId: 'c1', to: 'juan' }], 'MANUAL'), []);
    assert.equal(rows.length, 1);
  });

  it('una temporal vigente no se toca: la cobertura de otra persona sigue', async () => {
    const { service, tx, rows } = makeService({
      credits: [{ id: 'c1', assignedManagerId: 'juan' }],
      rows: [
        { id: 'a1', creditId: 'c1', userId: 'juan', revokedAt: null, expiresAt: null, caseId: null },
        { id: 't1', creditId: 'c1', userId: 'sara', revokedAt: null, expiresAt: new Date('2099-01-01'), caseId: null },
      ],
    });
    await service.apply(tx, [{ creditId: 'c1', to: 'maria' }], 'MANUAL');
    assert.equal(rows.find((r) => r.id === 't1')!.revokedAt, null);
  });

  it('si el responsable cambió desde que se miró → ASSIGNMENT_CONFLICT y nada escrito', async () => {
    const { service, tx, rows } = makeService({ credits: [{ id: 'c1', assignedManagerId: 'pedro' }] });
    await rejectsWithCode(() => service.apply(tx, [{ creditId: 'c1', to: 'maria', expectedFrom: 'juan' }], 'MANUAL'), 'ASSIGNMENT_CONFLICT');
    assert.equal(rows.length, 0);
  });

  it('dos escrituras a la vez chocan en el índice → ASSIGNMENT_CONFLICT, no un 500', async () => {
    const { service, tx } = makeService({ credits: [{ id: 'c1', assignedManagerId: null }], createFails: true });
    await rejectsWithCode(() => service.apply(tx, [{ creditId: 'c1', to: 'juan' }], 'MANUAL'), 'ASSIGNMENT_CONFLICT');
  });

  it('repara la columna si se había separado de la tabla, sin inventar un cambio', async () => {
    const { service, tx, credits } = makeService({
      credits: [{ id: 'c1', assignedManagerId: null }],
      rows: [{ id: 'a1', creditId: 'c1', userId: 'juan', revokedAt: null, expiresAt: null, caseId: null }],
    });
    assert.deepEqual(await service.apply(tx, [{ creditId: 'c1', to: 'juan' }], 'MANUAL'), []);
    assert.equal(credits.get('c1')!.assignedManagerId, 'juan');
  });

  it('un crédito borrado no recibe responsable', async () => {
    const { service, tx, rows } = makeService({ credits: [{ id: 'c1', assignedManagerId: null, deletedAt: new Date() }] });
    assert.deepEqual(await service.apply(tx, [{ creditId: 'c1', to: 'juan' }], 'MANUAL'), []);
    assert.equal(rows.length, 0);
  });
});

describe('AssignmentService — permisos y destinatarios', () => {
  it('sin assignment:write → ASSIGNMENT_FORBIDDEN', async () => {
    const { service } = makeService({ permissions: [] });
    await rejectsWithCode(async () => service.authorize(), 'ASSIGNMENT_FORBIDDEN');
  });

  it('con assignment:write pasa', () => {
    const { service } = makeService({ permissions: [Permission.ASSIGNMENT_WRITE] });
    assert.doesNotThrow(() => service.authorize());
  });

  it('un destinatario que no es cobrador activo de la cuenta → ASSIGNEE_NOT_ELIGIBLE', async () => {
    const { service, tx } = makeService({
      members: [
        { userId: 'juan', isActive: true, role: RoleType.COLLECTOR },
        { userId: 'boss', isActive: true, role: RoleType.MANAGER },
      ],
    });
    await service.assertAssignable(tx, ['juan', 'boss']); // uno mismo, aunque sea gerente
    await rejectsWithCode(() => service.assertAssignable(tx, ['juan', 'ex-empleado']), 'ASSIGNEE_NOT_ELIGIBLE');
  });

  it('audita REASSIGN con antes y después, y ASSIGN la primera vez', async () => {
    const { service, audited } = makeService({});
    await service.auditChanges(
      [
        { creditId: 'c1', from: 'juan', to: 'maria', reason: 'MANUAL' },
        { creditId: 'c2', from: null, to: 'juan', reason: 'IMPORT_OWN' },
      ],
      { runId: 'run-1' },
    );
    assert.deepEqual(audited.map((a) => [a.entityId, a.action]), [['c1', 'REASSIGN'], ['c2', 'ASSIGN']]);
    assert.deepEqual(audited[0]!.after, { assignedManagerId: 'maria', reason: 'MANUAL', runId: 'run-1' });
  });
});
