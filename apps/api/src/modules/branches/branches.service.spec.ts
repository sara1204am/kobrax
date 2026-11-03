import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BranchesService } from './branches.service';
import { AssignMembersDto, CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { rejectsWithCode } from '../auth/auth-test-utils';

type Row = Record<string, unknown>;

function branch(over: Row = {}): Row {
  return { id: 'b1', accountId: 'acc-A', name: 'Central', code: 'CEN', city: 'La Paz', address: null, managerUserId: null, active: true, deletedAt: null, ...over };
}

/** Un `tx` mínimo: sólo lo que el servicio toca, con cada consulta registrada para poder mirar el `where`. */
function makeService(opts: { found?: Row | null; clash?: Row | null; activeMembers?: number; manager?: Row | null; members?: Row[] } = {}) {
  const calls = {
    created: undefined as Row | undefined,
    updated: undefined as Row | undefined,
    manyUpdated: undefined as Row | undefined,
    clashWhere: undefined as Row | undefined,
    audit: [] as { entity: string; action: string; before?: unknown; after?: unknown }[],
  };
  const found = opts.found === undefined ? branch() : opts.found;
  const tx = {
    branch: {
      findFirst: async (args: { where: Row }) => {
        // La consulta de choque de código lleva `code` en el where; la de la propia agencia, `id`.
        if ('code' in args.where) {
          calls.clashWhere = args.where;
          return opts.clash ?? null;
        }
        return found;
      },
      findMany: async () => (found ? [found] : []),
      create: async (args: { data: Row }) => {
        calls.created = args.data;
        return branch({ id: 'b-new', ...args.data });
      },
      update: async (args: { data: Row }) => {
        calls.updated = args.data;
        return { ...(found ?? {}), ...Object.fromEntries(Object.entries(args.data).filter(([, v]) => v !== undefined)) };
      },
    },
    userAccount: {
      groupBy: async () => [],
      count: async () => opts.activeMembers ?? 0,
      findFirst: async () => (opts.manager === undefined ? { id: 'ua1' } : opts.manager),
      findMany: async () => opts.members ?? [],
      updateMany: async (args: { data: Row }) => {
        calls.manyUpdated = args.data;
        return { count: (opts.members ?? []).length };
      },
    },
    credit: { groupBy: async () => [] },
    profile: { findMany: async () => [] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const audit = { record: async (e: { entity: string; action: string; before?: unknown; after?: unknown }) => void calls.audit.push(e) };
  const service = new BranchesService(prisma as never, { accountId: 'acc-A' } as never, audit as never);
  return { service, calls };
}

describe('BranchesService.create', () => {
  it('guarda el código en mayúsculas, recorta el nombre y audita CREATE', async () => {
    const { service, calls } = makeService();
    await service.create({ name: '  Alto Norte ', code: 'alto-2', city: 'El Alto' });
    assert.equal(calls.created!.name, 'Alto Norte');
    assert.equal(calls.created!.code, 'ALTO-2');
    assert.equal(calls.created!.accountId, 'acc-A');
    assert.deepEqual(calls.audit.map((a) => a.action), ['CREATE']);
  });

  it('🔴 un código ya usado por otra agencia viva es 409 y no escribe nada', async () => {
    const { service, calls } = makeService({ clash: branch({ id: 'otra' }) });
    await rejectsWithCode(service.create({ name: 'Otra', code: 'CEN' }), 'BRANCH_CODE_DUPLICATE');
    assert.equal(calls.created, undefined);
    assert.deepEqual(calls.audit, []);
    assert.equal(calls.clashWhere!.deletedAt, null, 'sólo choca con las vivas: una dada de baja libera su código');
  });

  it('sin código no consulta choques (las que no tienen código no se pelean entre sí)', async () => {
    const { service, calls } = makeService();
    await service.create({ name: 'Sin código' });
    assert.equal(calls.clashWhere, undefined);
    assert.equal(calls.created!.code, null);
  });

  it('el responsable debe ser un miembro activo de la cuenta', async () => {
    const { service, calls } = makeService({ manager: null });
    await rejectsWithCode(service.create({ name: 'X', managerUserId: '3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f11' }), 'BRANCH_MANAGER_INVALID');
    assert.equal(calls.created, undefined);
  });
});

describe('BranchesService.update', () => {
  it('404 si la agencia no existe o está borrada', async () => {
    const { service } = makeService({ found: null });
    await rejectsWithCode(service.update('b1', { name: 'X' }), 'BRANCH_NOT_FOUND');
  });

  it('null quita el dato; ausente no lo toca', async () => {
    const { service, calls } = makeService();
    await service.update('b1', { city: null, name: 'Central 2' });
    assert.equal(calls.updated!.city, null);
    assert.equal(calls.updated!.name, 'Central 2');
    assert.equal(calls.updated!.address, undefined);
    assert.deepEqual(calls.audit.map((a) => a.action), ['UPDATE']);
  });

  it('el choque de código excluye a la propia agencia', async () => {
    const { service, calls } = makeService();
    await service.update('b1', { code: 'cen' });
    assert.deepEqual(calls.clashWhere!.id, { not: 'b1' });
    assert.equal(calls.updated!.code, 'CEN');
  });

  it('🔴 no se desactiva una agencia con miembros activos: primero se los pasa a otra', async () => {
    const { service, calls } = makeService({ activeMembers: 3 });
    await rejectsWithCode(service.update('b1', { active: false }), 'BRANCH_HAS_MEMBERS');
    assert.equal(calls.updated, undefined);
  });

  it('una vacía sí se desactiva', async () => {
    const { service, calls } = makeService({ activeMembers: 0 });
    await service.update('b1', { active: false });
    assert.equal(calls.updated!.active, false);
  });

  it('reactivar no pide estar vacía', async () => {
    const { service, calls } = makeService({ found: branch({ active: false }), activeMembers: 5 });
    await service.update('b1', { active: true });
    assert.equal(calls.updated!.active, true);
  });
});

describe('BranchesService.remove', () => {
  it('baja lógica: marca deletedAt y desactiva, y audita DELETE', async () => {
    const { service, calls } = makeService();
    await service.remove('b1');
    assert.ok(calls.updated!.deletedAt instanceof Date);
    assert.equal(calls.updated!.active, false);
    assert.deepEqual(calls.audit.map((a) => a.action), ['DELETE']);
  });

  it('🔴 con miembros activos se rechaza', async () => {
    const { service, calls } = makeService({ activeMembers: 1 });
    await rejectsWithCode(service.remove('b1'), 'BRANCH_HAS_MEMBERS');
    assert.equal(calls.updated, undefined);
  });

  it('404 si no existe', async () => {
    const { service } = makeService({ found: null });
    await rejectsWithCode(service.remove('b1'), 'BRANCH_NOT_FOUND');
  });
});

describe('BranchesService.assignMembers', () => {
  const MEMBERS = [
    { id: 'ua1', userId: 'u1', branchId: null },
    { id: 'ua2', userId: 'u2', branchId: 'b-vieja' },
    { id: 'ua3', userId: 'u3', branchId: 'b1' },
  ];

  it('los pasa a la agencia y audita sólo a los que de verdad cambiaron, con su agencia anterior', async () => {
    const { service, calls } = makeService({ members: MEMBERS });
    await service.assignMembers('b1', { userIds: ['u1', 'u2', 'u3'] });
    assert.deepEqual(calls.manyUpdated, { branchId: 'b1' });
    const audited = calls.audit.filter((a) => a.entity === 'user_account');
    assert.equal(audited.length, 2, 'u3 ya estaba en b1: no es un cambio');
    assert.deepEqual(audited.map((a) => a.before), [{ branchId: null }, { branchId: 'b-vieja' }]);
  });

  it('🔴 si alguno no existe o está inactivo, no mueve a nadie', async () => {
    const { service, calls } = makeService({ members: MEMBERS.slice(0, 2) });
    await rejectsWithCode(service.assignMembers('b1', { userIds: ['u1', 'u2', 'u3'] }), 'BRANCH_MEMBERS_INVALID');
    assert.equal(calls.manyUpdated, undefined);
  });

  it('no se asigna a una agencia desactivada', async () => {
    const { service } = makeService({ found: branch({ active: false }), members: MEMBERS });
    await rejectsWithCode(service.assignMembers('b1', { userIds: ['u1'] }), 'BRANCH_INACTIVE');
  });
});

async function errorsOf<T extends object>(cls: new () => T, body: Record<string, unknown>) {
  return (await validate(plainToInstance(cls, body))).map((e) => e.property);
}

describe('DTOs de agencias', () => {
  it('alta: nombre obligatorio de 2 a 80; código corto y sin espacios', async () => {
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'Central', code: 'CEN-1' }), []);
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'X' }), ['name']);
    assert.deepEqual(await errorsOf(CreateBranchDto, {}), ['name']);
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'Central', code: 'con espacio' }), ['code']);
    assert.deepEqual(await errorsOf(CreateBranchDto, { name: 'Central', code: 'x'.repeat(21) }), ['code']);
  });

  it('edición: null quita datos opcionales', async () => {
    assert.deepEqual(await errorsOf(UpdateBranchDto, { city: null, address: null, code: null, managerUserId: null }), []);
    assert.deepEqual(await errorsOf(UpdateBranchDto, { active: 'si' }), ['active']);
  });

  it('asignar miembros: de 1 a 100 ids únicos y válidos', async () => {
    const id = '3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f11';
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [id] }), []);
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [] }), ['userIds']);
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: [id, id] }), ['userIds']);
    assert.deepEqual(await errorsOf(AssignMembersDto, { userIds: ['no-es-uuid'] }), ['userIds']);
  });
});
