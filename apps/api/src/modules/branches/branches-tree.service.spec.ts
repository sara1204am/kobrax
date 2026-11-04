import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_OFFICE_DEPTH } from '@kobrax/shared';
import { BranchesService } from './branches.service';
import { deactivationBlock } from './branch-rules';
import { AssignMembersDto, CreateBranchDto, CreateBranchTypeDto, MoveBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { rejectsWithCode } from '../auth/auth-test-utils';
import { fakePlanLimits } from '../../common/plan/plan-test-utils';

type Row = Record<string, unknown>;

/** Un valor de `where` de Prisma contra un valor de fila: igualdad, `{ not }`, `{ in }`. */
function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as { not?: unknown; in?: unknown[] };
    if ('not' in c) return actual !== c.not;
    if ('in' in c) return (c.in ?? []).includes(actual);
    return true; // filtros por relación (user: { userAccounts … }) no se modelan: el spec los da por cumplidos
  }
  return actual === cond;
}
const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => matchValue(row[k], v));

const TYPES: Row[] = [
  { id: 't-central', accountId: 'acc-A', code: 'CENTRAL', name: 'Central', isActive: true, sortOrder: 0 },
  { id: 't-reg', accountId: 'acc-A', code: 'REGIONAL', name: 'Regional', isActive: true, sortOrder: 1 },
  { id: 't-ag', accountId: 'acc-A', code: 'AGENCIA', name: 'Agencia', isActive: true, sortOrder: 2 },
];

/** Árbol del caso de referencia (acotado): Central › Chuquisaca › Mesa Verde, y Central › La Paz. */
function tree(): Row[] {
  const b = (id: string, name: string, parentId: string | null, path: string, depth: number, typeId: string, over: Row = {}): Row => ({
    id, accountId: 'acc-A', name, code: null, city: null, address: null, managerUserId: null, active: true, deletedAt: null,
    parentId, typeId, path, depth, isRoot: parentId === null, ...over,
  });
  return [
    b('root', 'Central', null, '/root/', 0, 't-central'),
    b('chq', 'Chuquisaca', 'root', '/root/chq/', 1, 't-reg'),
    b('mv', 'Mesa Verde', 'chq', '/root/chq/mv/', 2, 't-ag'),
    b('lpz', 'La Paz', 'root', '/root/lpz/', 1, 't-reg'),
  ];
}

interface World {
  branches?: Row[];
  credits?: Record<string, number>; // por oficina
  assignments?: Row[];
  members?: Row[]; // user_accounts
  plan?: Parameters<typeof fakePlanLimits>[0];
}

function makeService(w: World = {}) {
  const branches = w.branches ?? tree();
  const assignments = w.assignments ?? [];
  const members = w.members ?? [];
  const credits = w.credits ?? {};
  const audit: { entity: string; entityId: string; action: string; before?: unknown; after?: unknown }[] = [];
  const created: Row[] = [];
  const updates: { id: string; data: Row }[] = [];
  const assignCreated: Row[] = [];
  let nextAssign = 1;

  const withType = (r: Row) => ({ ...r, type: TYPES.find((t) => t.id === r.typeId) });
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      if (q.sql.includes('is_root = true')) return branches.filter((r) => r.isRoot && !r.deletedAt).map((r) => ({ id: r.id }));
      if (q.sql.includes('path LIKE')) {
        const prefix = String(q.values[1]).replace(/%$/, '');
        return branches.filter((r) => !r.deletedAt && String(r.path).startsWith(prefix)).map((r) => ({ id: r.id, path: r.path, depth: r.depth }));
      }
      const id = q.values[0];
      return branches.filter((r) => r.id === id && !r.deletedAt).map((r) => ({ id: r.id, path: r.path, depth: r.depth, active: r.active, is_root: r.isRoot }));
    },
    branch: {
      findFirst: async (a: { where: Row }) => {
        const r = branches.find((x) => matches(x, a.where));
        return r ? withType(r) : null;
      },
      findFirstOrThrow: async (a: { where: Row }) => {
        const r = branches.find((x) => matches(x, a.where));
        if (!r) throw new Error('no existe');
        return r;
      },
      findMany: async (a: { where?: Row }) => branches.filter((x) => matches(x, a.where)).map(withType),
      count: async (a: { where: Row }) => branches.filter((x) => matches(x, a.where)).length,
      groupBy: async () => [],
      create: async (a: { data: Row }) => {
        created.push(a.data);
        const row = { code: null, city: null, address: null, managerUserId: null, active: true, deletedAt: null, ...a.data };
        branches.push(row);
        return row;
      },
      update: async (a: { where: { id: string }; data: Row }) => {
        const r = branches.find((x) => x.id === a.where.id)!;
        updates.push({ id: a.where.id, data: a.data });
        for (const [k, v] of Object.entries(a.data)) if (v !== undefined) r[k] = v;
        return r;
      },
    },
    branchType: {
      findFirst: async (a: { where: Row }) => TYPES.find((t) => matches(t, a.where)) ?? null,
      findMany: async () => TYPES,
    },
    credit: {
      count: async (a: { where: { branchId: string } }) => credits[a.where.branchId] ?? 0,
      groupBy: async () => [],
    },
    userBranchAssignment: {
      count: async (a: { where: { branchId: string } }) => assignments.filter((x) => x.branchId === a.where.branchId && !x.revokedAt && !x.inactiveUser).length,
      groupBy: async () => [],
      findMany: async (a: { where: Row }) => assignments.filter((x) => matches(x, { ...a.where, user: undefined }) && !x.revokedAt),
      findFirst: async (a: { where: Row }) => assignments.find((x) => matches(x, a.where)) ?? null,
      updateMany: async (a: { where: { id?: { in: string[] }; branchId?: string }; data: Row }) => {
        const hit = assignments.filter((x) => (a.where.id ? a.where.id.in.includes(String(x.id)) : x.branchId === a.where.branchId && !x.revokedAt));
        for (const x of hit) Object.assign(x, a.data);
        return { count: hit.length };
      },
      update: async (a: { where: { id: string }; data: Row }) => {
        Object.assign(assignments.find((x) => x.id === a.where.id)!, a.data);
        return {};
      },
      createMany: async (a: { data: Row[] }) => {
        for (const d of a.data) {
          const row = { id: `as${nextAssign++}`, revokedAt: null, ...d };
          assignments.push(row);
          assignCreated.push(row);
        }
        return { count: a.data.length };
      },
    },
    userAccount: {
      findFirst: async () => ({ id: 'ua-mgr' }),
      findMany: async (a: { where: { userId?: { in: string[] } } }) => members.filter((m) => !a.where.userId || a.where.userId.in.includes(String(m.userId))),
      updateMany: async () => ({ count: 1 }),
    },
    profile: { findMany: async () => [] },
    auditLog: { findMany: async () => [] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const auditSvc = { record: async (e: (typeof audit)[number]) => void audit.push(e) };
  const tenant = { accountId: 'acc-A', userId: 'admin' };
  const service = new BranchesService(prisma as never, tenant as never, auditSvc as never, fakePlanLimits(w.plan), { assignScope: async () => ({ kind: 'ALL', paths: [] }) } as never);
  return { service, branches, assignments, created, updates, assignCreated, audit };
}

const SOME_ID = '3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f11';

describe('BranchesService.create · el alta calcula la ruta en la misma transacción', () => {
  it('sin padre cuelga de la raíz: path = ruta del padre + su id, depth +1, tipo AGENCIA; audita CREATE', async () => {
    const { service, created, audit } = makeService();
    await service.create({ name: '  Alto Norte ', code: 'alto-2', city: 'El Alto' });
    const row = created[0]!;
    assert.equal(row.name, 'Alto Norte');
    assert.equal(row.code, 'ALTO-2');
    assert.equal(row.parentId, 'root');
    assert.equal(row.typeId, 't-ag');
    assert.equal(row.depth, 1);
    assert.equal(row.path, `/root/${row.id}/`);
    assert.equal(row.isRoot, false);
    assert.equal(row.accountId, 'acc-A');
    assert.deepEqual(audit.map((a) => a.action), ['CREATE']);
  });

  it('con padre y tipo: la ruta cuelga del padre ("Central › Chuquisaca › Padilla")', async () => {
    const { service, created } = makeService();
    await service.create({ name: 'Padilla', parentId: 'chq', typeId: 't-ag' });
    assert.equal(created[0]!.path, `/root/chq/${created[0]!.id}/`);
    assert.equal(created[0]!.depth, 2);
  });

  it('la ubicación en el mapa se guarda completa; con una sola coordenada se rechaza (BRANCH_LOCATION_INCOMPLETE)', async () => {
    const { service, created } = makeService();
    await service.create({ name: 'Con mapa', latitude: -19.0196, longitude: -65.2619 });
    assert.equal(created[0]!.latitude, -19.0196);
    assert.equal(created[0]!.longitude, -65.2619);
    await rejectsWithCode(service.create({ name: 'Media ubicación', latitude: -19.0196 }), 'BRANCH_LOCATION_INCOMPLETE');
    await rejectsWithCode(service.update('lpz', { latitude: null }), 'BRANCH_LOCATION_INCOMPLETE');
    await service.update('lpz', { latitude: null, longitude: null });
  });

  it('la validación acota la latitud a ±90 y la longitud a ±180', async () => {
    const errs = async (body: object) => (await validate(plainToInstance(CreateBranchDto, { name: 'Oficina X', ...body }))).map((e) => e.property);
    assert.deepEqual(await errs({ latitude: -19.5, longitude: -65.2 }), []);
    assert.deepEqual(await errs({ latitude: 91, longitude: 0 }), ['latitude']);
    assert.deepEqual(await errs({ latitude: 0, longitude: 181 }), ['longitude']);
  });

  it('🔴 un padre que no es de esta cuenta (o no existe) se rechaza: BRANCH_PARENT_INVALID', async () => {
    const { service, created } = makeService();
    await rejectsWithCode(service.create({ name: 'Intrusa', parentId: 'de-otra-cuenta' }), 'BRANCH_PARENT_INVALID');
    assert.equal(created.length, 0);
  });

  it('el padre desactivado no admite hijas', async () => {
    const branches = tree();
    branches.find((b) => b.id === 'lpz')!.active = false;
    const { service } = makeService({ branches });
    await rejectsWithCode(service.create({ name: 'X', parentId: 'lpz' }), 'BRANCH_PARENT_INACTIVE');
  });

  it('🔴 la profundidad máxima es una guarda técnica: no se cuelga más allá', async () => {
    const branches = tree();
    branches.push({ id: 'hondo', accountId: 'acc-A', name: 'Hondo', parentId: 'mv', typeId: 't-ag', path: '/root/chq/mv/hondo/', depth: MAX_OFFICE_DEPTH, active: true, deletedAt: null, isRoot: false });
    const { service } = makeService({ branches });
    await rejectsWithCode(service.create({ name: 'Más hondo', parentId: 'hondo' }), 'BRANCH_TOO_DEEP');
  });

  it('🔴 el tope del plan frena el alta dentro de la transacción', async () => {
    const { service, created } = makeService({ plan: { limits: { branches: 4 }, usage: { branches: 4 } } });
    await rejectsWithCode(service.create({ name: 'Una más' }), 'PLAN_LIMIT_REACHED');
    assert.equal(created.length, 0);
  });

  it('un tipo desactivado o ajeno se rechaza', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.create({ name: 'X', typeId: 't-de-otra' }), 'BRANCH_TYPE_INVALID');
  });

  it('🔴 un código ya usado por otra oficina viva es 409 y no escribe nada', async () => {
    const branches = tree();
    branches.find((b) => b.id === 'lpz')!.code = 'LPZ';
    const { service, created, audit } = makeService({ branches });
    await rejectsWithCode(service.create({ name: 'Otra', code: 'lpz' }), 'BRANCH_CODE_DUPLICATE');
    assert.equal(created.length, 0);
    assert.deepEqual(audit, []);
  });
});

describe('BranchesService.move', () => {
  it('mueve una regional con TODO su subárbol: reescribe path y depth de cada nodo, y audita MOVE', async () => {
    const { service, branches, audit } = makeService();
    await service.move('chq', { parentId: 'lpz' });
    const get = (id: string) => branches.find((b) => b.id === id)!;
    assert.equal(get('chq').path, '/root/lpz/chq/');
    assert.equal(get('chq').parentId, 'lpz');
    assert.equal(get('chq').depth, 2);
    assert.equal(get('mv').path, '/root/lpz/chq/mv/');
    assert.equal(get('mv').depth, 3);
    assert.deepEqual(audit.map((a) => a.action), ['MOVE']);
  });

  it('🔴 sin ciclos: no puede colgar de sí misma ni de una descendiente', async () => {
    const { service, branches } = makeService();
    await rejectsWithCode(service.move('chq', { parentId: 'chq' }), 'BRANCH_MOVE_CYCLE');
    await rejectsWithCode(service.move('chq', { parentId: 'mv' }), 'BRANCH_MOVE_CYCLE');
    assert.equal(branches.find((b) => b.id === 'chq')!.path, '/root/chq/', 'no se tocó nada');
  });

  it('🔴 la raíz no se mueve', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.move('root', { parentId: 'lpz' }), 'BRANCH_ROOT_PROTECTED');
  });

  it('el mismo padre es un no-op: no escribe ni audita', async () => {
    const { service, updates, audit } = makeService();
    await service.move('chq', { parentId: 'root' });
    assert.equal(updates.length, 0);
    assert.equal(audit.length, 0);
  });

  it('el subárbol movido no puede pasar la profundidad máxima', async () => {
    const branches = tree();
    // Una cadena larga bajo La Paz: moverle encima Chuquisaca (altura 1) superaría el tope.
    let parent = 'lpz';
    let path = '/root/lpz/';
    for (let d = 2; d <= MAX_OFFICE_DEPTH; d++) {
      const id = `n${d}`;
      path += `${id}/`;
      branches.push({ id, accountId: 'acc-A', name: id, parentId: parent, typeId: 't-ag', path, depth: d, active: true, deletedAt: null, isRoot: false });
      parent = id;
    }
    const { service } = makeService({ branches });
    await rejectsWithCode(service.move('chq', { parentId: parent }), 'BRANCH_TOO_DEEP');
  });

  it('un destino que no existe en la cuenta: BRANCH_PARENT_INVALID', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.move('chq', { parentId: 'de-otra-cuenta' }), 'BRANCH_PARENT_INVALID');
  });
});

describe('BranchesService · baja (desactivar / borrar)', () => {
  it('🔴 la raíz no se desactiva ni se borra', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.deactivate('root'), 'BRANCH_ROOT_PROTECTED');
    await rejectsWithCode(service.remove('root'), 'BRANCH_ROOT_PROTECTED');
  });

  it('🔴 se BLOQUEA con hijas activas', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.deactivate('chq'), 'BRANCH_HAS_CHILDREN');
  });

  it('🔴 se BLOQUEA con créditos', async () => {
    const { service } = makeService({ credits: { mv: 7 } });
    await rejectsWithCode(service.deactivate('mv'), 'BRANCH_HAS_CREDITS');
  });

  it('🔴 se BLOQUEA con personas vigentes', async () => {
    const { service } = makeService({ assignments: [{ id: 'a1', accountId: 'acc-A', userId: 'u1', branchId: 'mv', revokedAt: null }] });
    await rejectsWithCode(service.deactivate('mv'), 'BRANCH_HAS_MEMBERS');
  });

  it('una hoja vacía se desactiva, se audita y se puede restaurar', async () => {
    const { service, branches, audit } = makeService();
    await service.deactivate('mv');
    assert.equal(branches.find((b) => b.id === 'mv')!.active, false);
    await service.restore('mv');
    assert.equal(branches.find((b) => b.id === 'mv')!.active, true);
    assert.deepEqual(audit.map((a) => a.action), ['DEACTIVATE', 'RESTORE']);
  });

  it('restaurar bajo un padre apagado no se deja', async () => {
    const branches = tree();
    branches.find((b) => b.id === 'mv')!.active = false;
    branches.find((b) => b.id === 'chq')!.active = false;
    const { service } = makeService({ branches });
    await rejectsWithCode(service.restore('mv'), 'BRANCH_PARENT_INACTIVE');
  });

  it('desactivar es idempotente: la que ya está apagada no audita de nuevo', async () => {
    const branches = tree();
    branches.find((b) => b.id === 'mv')!.active = false;
    const { service, audit } = makeService({ branches });
    await service.deactivate('mv');
    assert.equal(audit.length, 0);
  });

  it('PATCH active:false aplica las mismas condiciones que desactivar', async () => {
    const { service } = makeService({ credits: { mv: 1 } });
    await rejectsWithCode(service.update('mv', { active: false }), 'BRANCH_HAS_CREDITS');
  });

  it('borrar: baja lógica de una hoja libre; audita DELETE', async () => {
    const { service, branches, audit } = makeService();
    await service.remove('mv');
    assert.ok(branches.find((b) => b.id === 'mv')!.deletedAt instanceof Date);
    assert.deepEqual(audit.map((a) => a.action), ['DELETE']);
  });

  it('🔴 borrar revoca las asignaciones vigentes de la oficina (aunque sean de usuarios inactivos) y limpia el espejo', async () => {
    const { service, assignments } = makeService({ assignments: [{ id: 'a1', accountId: 'acc-A', userId: 'inactivo', branchId: 'mv', revokedAt: null, inactiveUser: true }, { id: 'a2', accountId: 'acc-A', userId: 'otro', branchId: 'lpz', revokedAt: null }] });
    await service.remove('mv');
    assert.ok(assignments.find((a) => a.id === 'a1')!.revokedAt instanceof Date);
    assert.equal(assignments.find((a) => a.id === 'a2')!.revokedAt, null, 'las de otras oficinas no se tocan');
  });

  it('404 si no existe', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.deactivate('nada'), 'BRANCH_NOT_FOUND');
  });
});

describe('BranchesService.update', () => {
  it('null quita el dato; ausente no lo toca', async () => {
    const { service, updates } = makeService();
    await service.update('lpz', { city: null, name: 'La Paz 2' });
    assert.equal(updates[0]!.data.city, null);
    assert.equal(updates[0]!.data.name, 'La Paz 2');
    assert.equal(updates[0]!.data.address, undefined);
  });

  it('el código se guarda en mayúsculas', async () => {
    const { service, updates } = makeService();
    await service.update('lpz', { code: 'lpz' });
    assert.equal(updates[0]!.data.code, 'LPZ');
  });
});

describe('BranchesService.assignMembers · una asignación vigente por persona', () => {
  const MEMBERS = [
    { id: 'ua1', userId: 'u1', branchId: null },
    { id: 'ua2', userId: 'u2', branchId: 'lpz' },
  ];
  const ASSIGN_U2 = { id: 'as-old', accountId: 'acc-A', userId: 'u2', branchId: 'lpz', revokedAt: null };

  it('asigna: crea la asignación vigente (rol siempre null) y audita', async () => {
    const { service, assignCreated, audit } = makeService({ members: [MEMBERS[0]!] });
    await service.assignMembers('mv', { userIds: ['u1'] });
    assert.equal(assignCreated.length, 1);
    assert.equal(assignCreated[0]!.branchId, 'mv');
    assert.equal(assignCreated[0]!.roleId, undefined, 'role_id queda null: el rol sigue en user_accounts (ADR-0002)');
    assert.deepEqual(audit.map((a) => a.entity), ['user_account']);
  });

  it('por defecto MUEVE: revoca la asignación vieja y crea la nueva', async () => {
    const { service, assignments, assignCreated } = makeService({ members: [MEMBERS[1]!], assignments: [{ ...ASSIGN_U2 }] });
    await service.assignMembers('mv', { userIds: ['u2'] });
    assert.ok(assignments.find((a) => a.id === 'as-old')!.revokedAt instanceof Date);
    assert.equal(assignCreated[0]!.branchId, 'mv');
  });

  it('🔴 pedir una SEGUNDA (mode ADD) con otra vigente es 409 BRANCH_ASSIGNMENT_EXISTS y no escribe nada', async () => {
    const { service, assignments, assignCreated } = makeService({ members: [MEMBERS[1]!], assignments: [{ ...ASSIGN_U2 }] });
    await rejectsWithCode(service.assignMembers('mv', { userIds: ['u2'], mode: 'ADD' }), 'BRANCH_ASSIGNMENT_EXISTS');
    assert.equal(assignCreated.length, 0);
    assert.equal(assignments[0]!.revokedAt, null);
  });

  it('quien ya está en esa oficina no se duplica', async () => {
    const { service, assignCreated } = makeService({ members: [MEMBERS[1]!], assignments: [{ ...ASSIGN_U2 }] });
    await service.assignMembers('lpz', { userIds: ['u2'] });
    assert.equal(assignCreated.length, 0);
  });

  it('🔴 si alguno no existe o está inactivo, no mueve a nadie', async () => {
    const { service, assignCreated } = makeService({ members: [MEMBERS[0]!] });
    await rejectsWithCode(service.assignMembers('mv', { userIds: ['u1', 'u2'] }), 'BRANCH_MEMBERS_INVALID');
    assert.equal(assignCreated.length, 0);
  });

  it('no se asigna a una oficina desactivada', async () => {
    const branches = tree();
    branches.find((b) => b.id === 'mv')!.active = false;
    const { service } = makeService({ branches, members: [MEMBERS[0]!] });
    await rejectsWithCode(service.assignMembers('mv', { userIds: ['u1'] }), 'BRANCH_INACTIVE');
  });

  it('quitar: revoca la vigente y audita; si no estaba asignada, 404', async () => {
    const { service, assignments, audit } = makeService({ assignments: [{ ...ASSIGN_U2 }] });
    await service.unassignMember('lpz', 'u2');
    assert.ok(assignments[0]!.revokedAt instanceof Date);
    assert.deepEqual(audit.map((a) => a.action), ['REVOKE']);
    await rejectsWithCode(service.unassignMember('lpz', 'u2'), 'BRANCH_MEMBER_NOT_FOUND');
  });
});

describe('reglas puras de baja', () => {
  it('el orden en que se le dice a la persona: raíz, hijas, créditos, gente', () => {
    assert.equal(deactivationBlock({ isRoot: true, children: 1, credits: 1, members: 1 }), 'ROOT');
    assert.equal(deactivationBlock({ isRoot: false, children: 1, credits: 1, members: 1 }), 'CHILDREN');
    assert.equal(deactivationBlock({ isRoot: false, children: 0, credits: 1, members: 1 }), 'CREDITS');
    assert.equal(deactivationBlock({ isRoot: false, children: 0, credits: 0, members: 1 }), 'MEMBERS');
    assert.equal(deactivationBlock({ isRoot: false, children: 0, credits: 0, members: 0 }), null);
  });
});

async function errorsOf<T extends object>(cls: new () => T, body: Record<string, unknown>) {
  return (await validate(plainToInstance(cls, body))).map((e) => e.property);
}

describe('DTOs de oficinas', () => {
  it('alta: nombre obligatorio de 2 a 80; código corto; padre y tipo opcionales pero uuid', async () => {
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'Central', code: 'CEN-1' }), []);
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'X' }), ['name']);
    assert.deepEqual(await errorsOf(CreateBranchDto, {}), ['name']);
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'Central', code: 'con espacio' }), ['code']);
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'Central', parentId: SOME_ID, typeId: SOME_ID }), []);
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'Central', parentId: 'no-uuid' }), ['parentId']);
  });

  it('edición: null quita datos opcionales', async () => {
    assert.deepEqual(await errorsOf(UpdateBranchDto, { city: null, address: null, code: null, managerUserId: null }), []);
    assert.deepEqual(await errorsOf(UpdateBranchDto, { active: 'si' }), ['active']);
  });

  it('mover exige un padre uuid', async () => {
    assert.deepEqual(await errorsOf(MoveBranchDto, { parentId: SOME_ID }), []);
    assert.deepEqual(await errorsOf(MoveBranchDto, {}), ['parentId']);
  });

  it('asignar miembros: de 1 a 100 ids únicos; modo MOVE | ADD', async () => {
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [SOME_ID] }), []);
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [SOME_ID], mode: 'ADD' }), []);
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [SOME_ID], mode: 'OTRO' }), ['mode']);
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [] }), ['userIds']);
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [SOME_ID, SOME_ID] }), ['userIds']);
  });

  it('tipos: código en mayúsculas', async () => {
    assert.deepEqual(await errorsOf(CreateBranchTypeDto, { code: 'SUB_AGENCIA', name: 'Sub agencia' }), []);
    assert.deepEqual(await errorsOf(CreateBranchTypeDto, { code: 'minúscula', name: 'X Y' }), ['code']);
  });
});
