import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission, RoleType } from '@kobrax/shared';
import { AssignmentService } from './assignment.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

/**
 * F4/08 · D8-a y D10 — reemplazo temporal, ayuda y reasignación del responsable, contra una base en memoria
 * que entiende lo justo de `where` (igualdad, null, in, gt, lte, not, OR). Lo que se prueba es lo que importa:
 * qué agendados cambian de manos, cuáles no, y que el vencimiento es idempotente.
 */

type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

const time = (v: unknown): unknown => (v instanceof Date ? v.getTime() : v);

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((w) => matches(row, w));
    const v = time(row[key]);
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v === cond.getTime();
    if (typeof cond === 'object') {
      const c = cond as { in?: unknown[]; gt?: Date; lte?: Date; not?: unknown };
      if (c.in) return c.in.includes(row[key]);
      if (c.gt) return typeof v === 'number' && v > c.gt.getTime();
      if (c.lte) return typeof v === 'number' && v <= c.lte.getTime();
      if ('not' in c) return v !== c.not && !(c.not === null && (v === null || v === undefined));
    }
    return v === cond;
  });
}

const HOUR = 3_600_000;

interface Opts {
  permissions?: string[];
  userId?: string;
  credits?: { id: string; assignedManagerId: string | null; branchId?: string | null }[];
  assignments?: Row[];
  agenda?: Row[];
  members?: { userId: string; isActive?: boolean; role: string; branchId?: string | null }[];
}

function make(opts: Opts = {}) {
  const credits = new Map(opts.credits?.map((c) => [c.id, { ...c, branchId: c.branchId ?? null, deletedAt: null as Date | null }]));
  const assignments: Row[] = [...(opts.assignments ?? [])];
  const agenda: Row[] = (opts.agenda ?? []).map((a) => ({ deletedAt: null, details: {}, updatedBy: null, ...a }));
  const auditLogs: Row[] = [];
  let seq = 0;

  const tx = {
    credit: {
      findFirst: async ({ where }: { where: Where }) => {
        const c = credits.get(where.id as string);
        return c && !c.deletedAt ? { ...c } : null;
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => {
          const c = credits.get(id);
          return c && !c.deletedAt ? [{ ...c }] : [];
        }),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { assignedManagerId: string | null } }) => {
        for (const id of where.id.in) credits.get(id)!.assignedManagerId = data.assignedManagerId;
        return { count: where.id.in.length };
      },
    },
    creditAssignment: {
      findMany: async ({ where }: { where: Where }) => assignments.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      findFirst: async ({ where }: { where: Where }) => {
        const r = assignments.find((x) => matches(x, where));
        return r ? { ...r } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `as-${++seq}`, revokedAt: null, revokedBy: null, caseId: null, ...data } as Row;
        assignments.push(row);
        return { ...row };
      },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) assignments.push({ id: `as-${++seq}`, revokedAt: null, revokedBy: null, caseId: null, expiresAt: null, ...d } as Row);
        return { count: data.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = assignments.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      },
      updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        const hit = assignments.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
    agendaItem: {
      findMany: async ({ where }: { where: Where }) => agenda.filter((a) => matches(a, where)).map((a) => ({ ...a })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(agenda.find((a) => a.id === where.id)!, data);
        return {};
      },
      updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        const hit = agenda.filter((a) => matches(a, where));
        for (const a of hit) Object.assign(a, data);
        return { count: hit.length };
      },
    },
    userAccount: {
      findMany: async ({ where }: { where: { userId?: { in: string[] }; isActive?: boolean } }) =>
        (opts.members ?? [])
          .filter((m) => (where.userId ? where.userId.in.includes(m.userId) : true) && (where.isActive === undefined || (m.isActive ?? true) === where.isActive))
          .map((m) => ({
            userId: m.userId,
            isActive: m.isActive ?? true,
            branchId: m.branchId ?? null,
            role: { name: m.role },
            user: { email: `${m.userId}@x.com`, profile: null },
          })),
      findFirst: async ({ where }: { where: { userId: string } }) => {
        const m = (opts.members ?? []).find((x) => x.userId === where.userId);
        return m ? { branchId: m.branchId ?? null } : null;
      },
    },
    auditLog: {
      createMany: async ({ data }: { data: Row[] }) => void auditLogs.push(...data),
    },
  };

  const prisma = {
    withTenant: async (_acc: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    $queryRaw: async () => [{ account_id: 'acc-A' }],
  };
  const permissions = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: opts.userId ?? 'boss', can: (p: string) => permissions.includes(p) };
  const audited: { action: string; entityId: string; before?: unknown; after?: Record<string, unknown> }[] = [];
  const audit = {
    record: async (e: (typeof audited)[number]) => void audited.push(e),
    recordMany: async (es: typeof audited) => void audited.push(...es),
  };
  const service = new AssignmentService(prisma as never, tenant as never, audit as never);
  const agendaOf = (id: string) => agenda.find((a) => a.id === id)!;
  return { service, credits, assignments, agenda, agendaOf, audited, auditLogs, tx: tx as never };
}

const MANAGER = [Permission.ASSIGNMENT_WRITE, Permission.DATA_SCOPE_ALL];
const SUPERVISOR = [Permission.ASSIGNMENT_WRITE, Permission.DATA_SCOPE_BRANCH];

const members = [
  { userId: 'ana', role: RoleType.COLLECTOR, branchId: 'ag-1' },
  { userId: 'luis', role: RoleType.COLLECTOR, branchId: 'ag-1' },
  { userId: 'sup1', role: RoleType.SUPERVISOR, branchId: 'ag-1' },
  { userId: 'pedro', role: RoleType.COLLECTOR, branchId: 'ag-2' },
  { userId: 'gerente', role: RoleType.MANAGER, branchId: null },
];

const item = (id: string, over: Row extends never ? never : Record<string, unknown> = {}): Row => ({
  id,
  creditId: 'c1',
  assigneeId: 'ana',
  status: 'SCHEDULED',
  ...over,
});

const base = (over: Opts = {}): Opts => ({
  permissions: MANAGER,
  credits: [{ id: 'c1', assignedManagerId: 'ana', branchId: 'ag-1' }],
  assignments: [
    { id: 'p1', accountId: 'acc-A', creditId: 'c1', userId: 'ana', kind: 'PRINCIPAL', revokedAt: null, expiresAt: null, caseId: null, startsAt: new Date() },
  ],
  members,
  ...over,
});

const inOneHour = () => new Date(Date.now() + HOUR);

describe('TEMPORAL · crear el reemplazo', () => {
  it('inserta TEMPORAL con vencimiento; el responsable sigue siendo el mismo (conserva el crédito)', async () => {
    const { service, assignments, credits } = make(base());
    const out = await service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() });
    assert.equal(out.kind, 'TEMPORAL');
    const row = assignments.find((a) => a.id === out.id)!;
    assert.equal(row.userId, 'luis');
    assert.equal(row.kind, 'TEMPORAL');
    assert.ok(row.expiresAt instanceof Date);
    assert.equal(credits.get('c1')!.assignedManagerId, 'ana', 'ana conserva el crédito');
    assert.equal(assignments.find((a) => a.id === 'p1')!.revokedAt, null, 'y su asignación principal sigue vigente');
  });

  it('pasa al reemplazo lo agendado PENDIENTE de la responsable y lo marca; no toca lo ejecutado, borrado ni de otros', async () => {
    const { service, agendaOf } = make(
      base({
        agenda: [
          item('a-pend-1'),
          item('a-pend-2'),
          item('a-hecho', { status: 'EXECUTED' }),
          item('a-borrado', { deletedAt: new Date() }),
          item('a-de-otro', { assigneeId: 'luis' }),
          item('a-otro-credito', { creditId: 'c2' }),
        ],
      }),
    );
    const out = await service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() });
    assert.equal(out.agendaMoved, 2);
    for (const id of ['a-pend-1', 'a-pend-2']) {
      assert.equal(agendaOf(id).assigneeId, 'luis');
      const d = agendaOf(id).details as Record<string, unknown>;
      assert.equal(d.handoffFromUserId, 'ana');
      assert.equal(d.handoffAssignmentId, out.id);
    }
    assert.equal(agendaOf('a-hecho').assigneeId, 'ana');
    assert.equal(agendaOf('a-borrado').assigneeId, 'ana');
    assert.equal(agendaOf('a-de-otro').assigneeId, 'luis');
    assert.equal(agendaOf('a-otro-credito').assigneeId, 'ana');
  });

  it('conserva los demás campos de details al marcar', async () => {
    const { service, agendaOf } = make(base({ agenda: [item('a1', { details: { amount: 150 } })] }));
    await service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() });
    assert.equal((agendaOf('a1').details as Record<string, unknown>).amount, 150);
  });

  it('audita ASSIGN_TEMPORARY con quién, hasta cuándo, el motivo y cuántos agendados pasaron', async () => {
    const { service, audited } = make(base({ agenda: [item('a1')] }));
    const exp = inOneHour();
    await service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: exp, reason: 'vacaciones' });
    const a = audited.find((x) => x.action === 'ASSIGN_TEMPORARY')!;
    assert.equal(a.entityId, 'c1');
    assert.deepEqual(
      { ...a.after, assignmentId: undefined },
      { assignmentId: undefined, principalId: 'ana', temporaryUserId: 'luis', expiresAt: exp.toISOString(), reason: 'vacaciones', agendaMoved: 1 },
    );
  });

  it('exige vencimiento futuro', async () => {
    const { service } = make(base());
    await rejectsWithCode(service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: new Date(Date.now() - 1000) }), 'TEMPORARY_EXPIRY_INVALID');
  });

  it('sin assignment:write → ASSIGNMENT_FORBIDDEN', async () => {
    const { service } = make(base({ permissions: [] }));
    await rejectsWithCode(service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() }), 'ASSIGNMENT_FORBIDDEN');
  });

  it('el reemplazo tiene que ser cobrador o supervisor activo: un gerente que no es quien pide no', async () => {
    const { service } = make(base());
    await rejectsWithCode(service.createTemporary({ creditId: 'c1', userId: 'gerente', expiresAt: inOneHour() }), 'ASSIGNEE_NOT_ELIGIBLE');
  });

  it('un supervisor puede ser el reemplazo', async () => {
    const { service } = make(base());
    const out = await service.createTemporary({ creditId: 'c1', userId: 'sup1', expiresAt: inOneHour() });
    assert.equal(out.userId, 'sup1');
  });

  it('sin responsable no hay a quien reemplazar; y el reemplazo no puede ser el mismo responsable', async () => {
    const sinResponsable = make(base({ credits: [{ id: 'c1', assignedManagerId: null, branchId: 'ag-1' }] }));
    await rejectsWithCode(sinResponsable.service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() }), 'ASSIGNMENT_NO_PRINCIPAL');
    const mismo = make(base());
    await rejectsWithCode(mismo.service.createTemporary({ creditId: 'c1', userId: 'ana', expiresAt: inOneHour() }), 'ASSIGNMENT_SAME_AS_PRINCIPAL');
  });

  it('un solo reemplazo vigente por crédito', async () => {
    const { service } = make(base());
    await service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() });
    await rejectsWithCode(service.createTemporary({ creditId: 'c1', userId: 'sup1', expiresAt: inOneHour() }), 'ASSIGNMENT_TEMPORARY_EXISTS');
  });

  it('crédito inexistente → 404', async () => {
    const { service } = make(base());
    await rejectsWithCode(service.createTemporary({ creditId: 'nope', userId: 'luis', expiresAt: inOneHour() }), 'RESOURCE_NOT_FOUND');
  });
});

describe('D8 · el supervisor sólo reparte en su agencia (reemplazo y ayuda)', () => {
  const sup = (over: Opts = {}) => make(base({ permissions: SUPERVISOR, userId: 'sup1', ...over }));

  it('crédito y reemplazo de su agencia: pasa (él mismo incluido)', async () => {
    const { service } = sup();
    assert.equal((await service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() })).userId, 'luis');
    const otra = sup();
    assert.equal((await otra.service.createSupport({ creditId: 'c1', userId: 'sup1' })).userId, 'sup1');
  });

  it('crédito de OTRA agencia → ASSIGNMENT_OUT_OF_AGENCY', async () => {
    const { service } = sup({ credits: [{ id: 'c1', assignedManagerId: 'pedro', branchId: 'ag-2' }] });
    await rejectsWithCode(service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() }), 'ASSIGNMENT_OUT_OF_AGENCY');
    await rejectsWithCode(service.createSupport({ creditId: 'c1', userId: 'luis' }), 'ASSIGNMENT_OUT_OF_AGENCY');
  });

  it('destinatario de OTRA agencia → ASSIGNMENT_OUT_OF_AGENCY', async () => {
    const { service } = sup();
    await rejectsWithCode(service.createTemporary({ creditId: 'c1', userId: 'pedro', expiresAt: inOneHour() }), 'ASSIGNMENT_OUT_OF_AGENCY');
  });

  it('un supervisor sin agencia no reparte nada', async () => {
    const { service } = sup({ members: members.map((m) => (m.userId === 'sup1' ? { ...m, branchId: null } : m)) });
    await rejectsWithCode(service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() }), 'ASSIGNMENT_OUT_OF_AGENCY');
  });

  it('el gerente (alcance total) reparte entre agencias', async () => {
    const { service } = make(base({ credits: [{ id: 'c1', assignedManagerId: 'pedro', branchId: 'ag-2' }] }));
    assert.equal((await service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() })).userId, 'luis');
  });

  it('el selector del supervisor sólo ofrece a su agencia; el del gerente, a todos los asignables', async () => {
    const s = sup();
    assert.deepEqual((await s.service.listAssignees()).map((a) => a.userId).sort(), ['ana', 'luis', 'sup1']);
    const m = make(base());
    assert.deepEqual((await m.service.listAssignees()).map((a) => a.userId).sort(), ['ana', 'luis', 'pedro', 'sup1']);
  });
});

describe('TEMPORAL · revocar', () => {
  async function withTemporary(extra: Row[] = []) {
    const ctx = make(base({ agenda: [item('a-pend'), item('a-hecho', { status: 'EXECUTED' }), ...extra] }));
    const temp = await ctx.service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() });
    return { ...ctx, temp };
  }

  it('lo que sigue pendiente y marcado vuelve a la responsable, sin la marca', async () => {
    const { service, agendaOf, temp } = await withTemporary();
    const out = await service.revoke(temp.id);
    assert.equal(out.agendaReturned, 1);
    assert.equal(agendaOf('a-pend').assigneeId, 'ana');
    assert.equal('handoffFromUserId' in (agendaOf('a-pend').details as object), false);
    assert.equal('handoffAssignmentId' in (agendaOf('a-pend').details as object), false);
  });

  it('lo que el reemplazo creó, y lo que ejecutó, se queda con él', async () => {
    // El reemplazo ejecuta uno de los traspasados y agenda uno propio (sin marca).
    const { service, agendaOf, temp } = await withTemporary([item('a-propio', { assigneeId: 'luis' })]);
    agendaOf('a-pend').status = 'EXECUTED';
    const out = await service.revoke(temp.id);
    assert.equal(out.agendaReturned, 0);
    assert.equal(agendaOf('a-pend').assigneeId, 'luis', 'ejecutado: queda a nombre de quien lo hizo');
    assert.equal(agendaOf('a-propio').assigneeId, 'luis', 'creado por el reemplazo: se queda');
  });

  it('marca la asignación como revocada y audita REVOKE_TEMPORARY', async () => {
    const { service, assignments, audited, temp } = await withTemporary();
    await service.revoke(temp.id);
    const row = assignments.find((a) => a.id === temp.id)!;
    assert.ok(row.revokedAt instanceof Date);
    assert.equal(row.revokedBy, 'boss');
    assert.ok(audited.some((a) => a.action === 'REVOKE_TEMPORARY' && a.entityId === 'c1'));
  });

  it('el responsable principal no se revoca; una ya revocada o inexistente da 404', async () => {
    const { service, temp } = await withTemporary();
    await rejectsWithCode(service.revoke('p1'), 'ASSIGNMENT_NOT_REVOCABLE');
    await service.revoke(temp.id);
    await rejectsWithCode(service.revoke(temp.id), 'ASSIGNMENT_NOT_FOUND');
    await rejectsWithCode(service.revoke('fantasma'), 'ASSIGNMENT_NOT_FOUND');
  });

  it('un supervisor no revoca en una agencia que no es la suya', async () => {
    const ctx = make(
      base({
        permissions: SUPERVISOR,
        userId: 'sup1',
        credits: [{ id: 'c1', assignedManagerId: 'pedro', branchId: 'ag-2' }],
        assignments: [
          { id: 't9', accountId: 'acc-A', creditId: 'c1', userId: 'luis', kind: 'TEMPORAL', revokedAt: null, expiresAt: inOneHour(), caseId: null },
        ],
      }),
    );
    await rejectsWithCode(ctx.service.revoke('t9'), 'ASSIGNMENT_OUT_OF_AGENCY');
  });
});

describe('TEMPORAL · vencimiento (expireDue)', () => {
  /** Un reemplazo creado "hace dos horas" que venció hace una. */
  function expired(extra: Partial<Opts> = {}) {
    const exp = new Date(Date.now() - HOUR);
    return make(
      base({
        agenda: [item('a-pend', { assigneeId: 'luis', details: { handoffFromUserId: 'ana', handoffAssignmentId: 't1', amount: 9 } }), item('a-hecho', { assigneeId: 'luis', status: 'EXECUTED' }), item('a-propio', { assigneeId: 'luis' })],
        assignments: [
          { id: 'p1', accountId: 'acc-A', creditId: 'c1', userId: 'ana', kind: 'PRINCIPAL', revokedAt: null, expiresAt: null, caseId: null },
          { id: 't1', accountId: 'acc-A', creditId: 'c1', userId: 'luis', kind: 'TEMPORAL', revokedAt: null, expiresAt: exp, grantedBy: 'boss', caseId: null },
        ],
        ...extra,
      }),
    );
  }

  it('revoca lo vencido y devuelve a la responsable lo pendiente y marcado; el resto se queda', async () => {
    const { service, agendaOf, assignments } = expired();
    const r = await service.expireDue(new Date());
    assert.deepEqual(r, { revoked: 1, returned: 1 });
    const t = assignments.find((a) => a.id === 't1')!;
    assert.ok(t.revokedAt instanceof Date);
    assert.equal((t.revokedAt as Date).getTime(), (t.expiresAt as Date).getTime(), 'revokedAt = el vencimiento');
    assert.equal(agendaOf('a-pend').assigneeId, 'ana');
    assert.deepEqual(agendaOf('a-pend').details, { amount: 9 }, 'sin la marca y conservando el resto');
    assert.equal(agendaOf('a-hecho').assigneeId, 'luis');
    assert.equal(agendaOf('a-propio').assigneeId, 'luis');
  });

  it('es idempotente: la segunda corrida no encuentra nada ni cambia nada', async () => {
    const { service, agendaOf, auditLogs } = expired();
    await service.expireDue(new Date());
    const snapshot = JSON.stringify([agendaOf('a-pend'), agendaOf('a-hecho'), agendaOf('a-propio')]);
    assert.deepEqual(await service.expireDue(new Date()), { revoked: 0, returned: 0 });
    assert.equal(JSON.stringify([agendaOf('a-pend'), agendaOf('a-hecho'), agendaOf('a-propio')]), snapshot);
    assert.equal(auditLogs.length, 1, 'una sola entrada de auditoría');
  });

  it('lo no vencido no se toca', async () => {
    const { service, assignments, agendaOf } = make(
      base({
        agenda: [item('a1', { assigneeId: 'luis', details: { handoffFromUserId: 'ana', handoffAssignmentId: 't1' } })],
        assignments: [{ id: 't1', accountId: 'acc-A', creditId: 'c1', userId: 'luis', kind: 'TEMPORAL', revokedAt: null, expiresAt: inOneHour(), caseId: null }],
      }),
    );
    assert.deepEqual(await service.expireDue(new Date()), { revoked: 0, returned: 0 });
    assert.equal(assignments[0]!.revokedAt, null);
    assert.equal(agendaOf('a1').assigneeId, 'luis');
  });

  it('vuelve a quien es el responsable HOY, no a quien lo era al traspasar', async () => {
    const { service, agendaOf, credits } = expired();
    credits.get('c1')!.assignedManagerId = 'sup1';
    await service.expireDue(new Date());
    assert.equal(agendaOf('a-pend').assigneeId, 'sup1');
  });

  it('un ítem que alguien reasignó a mano a otra persona no vuelve: sólo se le quita la marca', async () => {
    const { service, agendaOf } = expired();
    agendaOf('a-pend').assigneeId = 'sup1';
    const r = await service.expireDue(new Date());
    assert.equal(r.returned, 0);
    assert.equal(agendaOf('a-pend').assigneeId, 'sup1');
    assert.equal('handoffAssignmentId' in (agendaOf('a-pend').details as object), false);
  });

  it('escribe la auditoría EXPIRE_TEMPORARY en la misma transacción, a nombre de quien la otorgó', async () => {
    const { service, auditLogs } = expired();
    await service.expireDue(new Date());
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0]!.action, 'EXPIRE_TEMPORARY');
    assert.equal(auditLogs[0]!.userId, 'boss');
    assert.equal(auditLogs[0]!.entityId, 'c1');
  });

  it('una ayuda (APOYO) con vencimiento también se revoca, sin mover agenda', async () => {
    const { service, assignments, agendaOf } = make(
      base({
        agenda: [item('a1')],
        assignments: [
          { id: 'p1', accountId: 'acc-A', creditId: 'c1', userId: 'ana', kind: 'PRINCIPAL', revokedAt: null, expiresAt: null, caseId: null },
          { id: 'ap1', accountId: 'acc-A', creditId: 'c1', userId: 'luis', kind: 'APOYO', revokedAt: null, expiresAt: new Date(Date.now() - 1000), caseId: null },
        ],
      }),
    );
    assert.deepEqual(await service.expireDue(new Date()), { revoked: 1, returned: 0 });
    assert.ok(assignments.find((a) => a.id === 'ap1')!.revokedAt);
    assert.equal(assignments.find((a) => a.id === 'p1')!.revokedAt, null, 'la principal no se toca');
    assert.equal(agendaOf('a1').assigneeId, 'ana');
  });

  it('una ayuda sin vencimiento no vence nunca', async () => {
    const { service, assignments } = make(
      base({ assignments: [{ id: 'ap1', accountId: 'acc-A', creditId: 'c1', userId: 'luis', kind: 'APOYO', revokedAt: null, expiresAt: null, caseId: null }] }),
    );
    assert.deepEqual(await service.expireDue(new Date(Date.now() + 1000 * HOUR)), { revoked: 0, returned: 0 });
    assert.equal(assignments[0]!.revokedAt, null);
  });
});

describe('APOYO · segundo cobrador', () => {
  it('crea la ayuda sin vencimiento y sin mover la agenda; el responsable no cambia', async () => {
    const { service, assignments, agendaOf, credits } = make(base({ agenda: [item('a1')] }));
    const out = await service.createSupport({ creditId: 'c1', userId: 'luis' });
    assert.equal(out.kind, 'APOYO');
    assert.equal(out.expiresAt, null);
    assert.equal(assignments.find((a) => a.id === out.id)!.kind, 'APOYO');
    assert.equal(agendaOf('a1').assigneeId, 'ana');
    assert.equal(credits.get('c1')!.assignedManagerId, 'ana');
  });

  it('con vencimiento opcional, que tiene que ser futuro', async () => {
    const { service } = make(base());
    const out = await service.createSupport({ creditId: 'c1', userId: 'luis', expiresAt: inOneHour() });
    assert.ok(out.expiresAt);
    await rejectsWithCode(service.createSupport({ creditId: 'c1', userId: 'sup1', expiresAt: new Date(Date.now() - 1) }), 'TEMPORARY_EXPIRY_INVALID');
  });

  it('puede haber varias ayudas, pero no la misma persona dos veces; ni el responsable de ayuda de sí mismo', async () => {
    const { service } = make(base());
    await service.createSupport({ creditId: 'c1', userId: 'luis' });
    await service.createSupport({ creditId: 'c1', userId: 'sup1' });
    await rejectsWithCode(service.createSupport({ creditId: 'c1', userId: 'luis' }), 'ASSIGNMENT_SUPPORT_EXISTS');
    await rejectsWithCode(service.createSupport({ creditId: 'c1', userId: 'ana' }), 'ASSIGNMENT_SAME_AS_PRINCIPAL');
  });

  it('sin assignment:write → ASSIGNMENT_FORBIDDEN', async () => {
    const { service } = make(base({ permissions: [] }));
    await rejectsWithCode(service.createSupport({ creditId: 'c1', userId: 'luis' }), 'ASSIGNMENT_FORBIDDEN');
  });

  it('se quita con revoke (audita REVOKE_SUPPORT) y la agenda no se mueve', async () => {
    const { service, assignments, audited, agendaOf } = make(base({ agenda: [item('a1')] }));
    const out = await service.createSupport({ creditId: 'c1', userId: 'luis' });
    const r = await service.revoke(out.id);
    assert.equal(r.agendaReturned, 0);
    assert.ok(assignments.find((a) => a.id === out.id)!.revokedAt);
    assert.ok(audited.some((a) => a.action === 'REVOKE_SUPPORT'));
    assert.equal(agendaOf('a1').assigneeId, 'ana');
  });

  it('una ayuda (permanente, sin vencimiento) no se confunde con el responsable al reasignar', async () => {
    const { service, tx, assignments } = make(
      base({
        assignments: [
          { id: 'p1', accountId: 'acc-A', creditId: 'c1', userId: 'ana', kind: 'PRINCIPAL', revokedAt: null, expiresAt: null, caseId: null },
          { id: 'ap1', accountId: 'acc-A', creditId: 'c1', userId: 'luis', kind: 'APOYO', revokedAt: null, expiresAt: null, caseId: null },
        ],
      }),
    );
    const changes = await service.apply(tx, [{ creditId: 'c1', to: 'sup1', expectedFrom: 'ana' }], 'MANUAL');
    assert.deepEqual(changes.map((c) => [c.from, c.to]), [['ana', 'sup1']], 'el "de" es la principal, no la ayuda');
    assert.equal(assignments.find((a) => a.id === 'ap1')!.revokedAt, null, 'la ayuda sigue');
    assert.ok(assignments.find((a) => a.id === 'p1')!.revokedAt, 'la principal anterior queda revocada');
  });
});

describe('D10 · reasignar el responsable traspasa lo agendado y sin ejecutar', () => {
  const agenda = () => [
    item('a-pend'),
    item('a-hecho', { status: 'EXECUTED' }),
    item('a-cancelado', { status: 'CANCELLED' }),
    item('a-borrado', { deletedAt: new Date() }),
    item('a-del-reemplazo', { assigneeId: 'luis' }),
    item('a-otro-credito', { creditId: 'c2' }),
  ];

  it('lo pendiente del anterior pasa al nuevo; lo ejecutado queda a nombre de quien lo hizo', async () => {
    const { service, tx, agendaOf } = make(base({ agenda: agenda() }));
    const changes = await service.apply(tx, [{ creditId: 'c1', to: 'sup1', expectedFrom: 'ana' }], 'MANUAL');
    assert.equal(agendaOf('a-pend').assigneeId, 'sup1');
    assert.equal(agendaOf('a-hecho').assigneeId, 'ana');
    assert.equal(agendaOf('a-cancelado').assigneeId, 'ana');
    assert.equal(agendaOf('a-borrado').assigneeId, 'ana');
    assert.equal(agendaOf('a-del-reemplazo').assigneeId, 'luis');
    assert.equal(agendaOf('a-otro-credito').assigneeId, 'ana');
    assert.equal(changes[0]!.agendaMoved, 1);
  });

  it('el historial de asignaciones lo registra (revoca la anterior, crea la nueva) y la columna sigue a la tabla', async () => {
    const { service, tx, assignments, credits } = make(base({ agenda: agenda() }));
    await service.apply(tx, [{ creditId: 'c1', to: 'sup1' }], 'MANUAL');
    assert.ok(assignments.find((a) => a.id === 'p1')!.revokedAt);
    assert.ok(assignments.some((a) => a.userId === 'sup1' && a.kind === 'PRINCIPAL' && !a.revokedAt));
    assert.equal(credits.get('c1')!.assignedManagerId, 'sup1');
  });

  it('audita REASSIGN con cuántos agendados pasaron', async () => {
    const { service, tx, audited } = make(base({ agenda: agenda() }));
    const changes = await service.apply(tx, [{ creditId: 'c1', to: 'sup1' }], 'MANUAL');
    await service.auditChanges(changes);
    const a = audited.find((x) => x.action === 'REASSIGN')!;
    assert.equal(a.after!.agendaMoved, 1);
    assert.equal(a.after!.assignedManagerId, 'sup1');
  });

  it('asignar por primera vez, o quitar al responsable, no mueve nada', async () => {
    const primera = make(
      base({
        credits: [{ id: 'c1', assignedManagerId: null, branchId: 'ag-1' }],
        assignments: [],
        agenda: [item('a1', { assigneeId: 'luis' })],
      }),
    );
    await primera.service.apply(primera.tx, [{ creditId: 'c1', to: 'ana' }], 'MANUAL');
    assert.equal(primera.agendaOf('a1').assigneeId, 'luis');

    const quitar = make(base({ agenda: [item('a1')] }));
    await quitar.service.apply(quitar.tx, [{ creditId: 'c1', to: null }], 'MANUAL');
    assert.equal(quitar.agendaOf('a1').assigneeId, 'ana');
  });

  it('pedir el responsable que ya está no mueve nada', async () => {
    const { service, tx, agendaOf } = make(base({ agenda: [item('a1')] }));
    assert.deepEqual(await service.apply(tx, [{ creditId: 'c1', to: 'ana' }], 'MANUAL'), []);
    assert.equal(agendaOf('a1').assigneeId, 'ana');
  });

  it('con un reemplazo vigente: lo del reemplazo vuelve, al vencer, al NUEVO responsable', async () => {
    const ctx = make(base({ agenda: [item('a-pend'), item('a-nuevo')] }));
    const temp = await ctx.service.createTemporary({ creditId: 'c1', userId: 'luis', expiresAt: new Date(Date.now() + 1000) });
    ctx.agendaOf('a-nuevo').assigneeId = 'ana'; // agendado por la responsable durante el reemplazo
    await ctx.service.apply(ctx.tx, [{ creditId: 'c1', to: 'sup1' }], 'MANUAL');
    assert.equal(ctx.agendaOf('a-pend').assigneeId, 'luis', 'el reemplazo conserva lo suyo');
    assert.equal(ctx.agendaOf('a-nuevo').assigneeId, 'sup1', 'lo de la responsable anterior pasa a la nueva');
    await ctx.service.expireDue(new Date(Date.now() + HOUR));
    assert.equal(ctx.agendaOf('a-pend').assigneeId, 'sup1');
    void temp;
  });
});
