import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Permission, ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { ArrearCategoriesService } from './arrear-categories.service';
import { ArrearCategoriesController } from './arrear-categories.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

interface Row {
  id: string;
  accountId: string;
  code: string;
  name: string;
  fromDays: number;
  toDays: number | null;
  color: string | null;
  sortOrder: number;
}

function make(initial: Omit<Row, 'id' | 'accountId'>[] = []) {
  let seq = 0;
  const rows: Row[] = initial.map((r) => ({ id: `id-${++seq}`, accountId: 'acc-A', ...r }));
  const audited: { entity: string; entityId: string; action: string; before?: unknown; after?: unknown }[] = [];
  const tx = {
    arrearCategory: {
      findMany: async () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.fromDays - b.fromDays).map((r) => ({ ...r })),
      deleteMany: async ({ where }: { where: { code: { notIn: string[] } } }) => {
        for (let i = rows.length - 1; i >= 0; i--) if (!where.code.notIn.includes(rows[i]!.code)) rows.splice(i, 1);
        return { count: 0 };
      },
      upsert: async ({ where, create, update }: { where: { accountId_code: { code: string } }; create: Omit<Row, 'id'>; update: Partial<Row> }) => {
        const hit = rows.find((r) => r.code === where.accountId_code.code);
        if (hit) Object.assign(hit, update);
        else rows.push({ id: `id-${++seq}`, ...create });
      },
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'admin' };
  const audit = { record: async (e: (typeof audited)[number]) => void audited.push(e) };
  const service = new ArrearCategoriesService(prisma as never, tenant as never, audit as never);
  return { service, rows, audited };
}

const c = (code: string, fromDays: number, toDays: number | null, name = `Cat ${code}`) => ({ code, name, fromDays, toDays });
const DEFAULTS = [
  { code: 'A', name: 'Categoría A', fromDays: 1, toDays: 30, color: null, sortOrder: 1 },
  { code: 'B', name: 'Categoría B', fromDays: 31, toDays: 60, color: null, sortOrder: 2 },
  { code: 'C', name: 'Categoría C', fromDays: 61, toDays: null, color: null, sortOrder: 3 },
];

async function rejectsInvalid(promise: Promise<unknown>, expected: string[]): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    const e = err as { getStatus?: () => number; getResponse?: () => { code?: string; details?: { errors?: string[] } } };
    assert.equal(e.getStatus?.(), 400);
    assert.equal(e.getResponse?.().code, 'ARREAR_CATEGORIES_INVALID');
    assert.deepEqual(e.getResponse?.().details?.errors, expected);
    return true;
  });
}

describe('GET /arrear-categories', () => {
  it('devuelve los rangos de la cuenta, ordenados', async () => {
    const { service } = make([...DEFAULTS].reverse());
    const { data } = await service.list();
    assert.deepEqual(data!.map((r) => r.code), ['A', 'B', 'C']);
    assert.equal(data![2]!.toDays, null);
  });

  it('una cuenta sin categorías devuelve la lista vacía', async () => {
    assert.deepEqual((await make().service.list()).data, []);
  });
});

describe('PUT /arrear-categories — reemplaza el juego completo', () => {
  it('un juego válido se guarda: ordenado por rango, con sort_order 1..n y color', async () => {
    const { service, rows } = make(DEFAULTS);
    const { data } = await service.replace({ categories: [{ ...c('C', 91, null), color: ' #f00 ' }, c('A', 1, 45), c('B', 46, 90)] } as never);
    assert.deepEqual(data!.map((r) => [r.code, r.fromDays, r.toDays, r.sortOrder]), [
      ['A', 1, 45, 1],
      ['B', 46, 90, 2],
      ['C', 91, null, 3],
    ]);
    assert.equal(rows.find((r) => r.code === 'C')!.color, '#f00');
  });

  it('las que ya existían conservan su id; las que faltan se borran; las nuevas se crean', async () => {
    const { service, rows } = make(DEFAULTS);
    const idA = rows.find((r) => r.code === 'A')!.id;
    await service.replace({ categories: [c('A', 1, 10), c('Z', 11, null)] } as never);
    assert.deepEqual(rows.map((r) => r.code).sort(), ['A', 'Z']);
    assert.equal(rows.find((r) => r.code === 'A')!.id, idA);
    assert.equal(rows.find((r) => r.code === 'A')!.toDays, 10);
  });

  it('una sola categoría sin tope es un juego válido', async () => {
    const { service } = make();
    const { data } = await service.replace({ categories: [c('X', 1, null)] } as never);
    assert.equal(data!.length, 1);
  });

  it('🔴 con huecos → 400 GAP, y no escribe nada', async () => {
    const { service, rows, audited } = make(DEFAULTS);
    await rejectsInvalid(service.replace({ categories: [c('A', 1, 30), c('B', 35, null)] } as never), ['GAP']);
    assert.equal(rows.length, 3);
    assert.equal(audited.length, 0);
  });

  it('🔴 con solapes → 400 OVERLAP', async () => {
    const { service } = make();
    await rejectsInvalid(service.replace({ categories: [c('A', 1, 30), c('B', 30, null)] } as never), ['OVERLAP']);
  });

  it('🔴 la que no tiene tope tiene que ser la última → 400 OPEN_ENDED_NOT_LAST', async () => {
    const { service } = make();
    await rejectsInvalid(service.replace({ categories: [c('A', 1, null), c('B', 31, 60)] } as never), ['OPEN_ENDED_NOT_LAST']);
  });

  it('tiene que empezar en el día 1 → 400 NOT_STARTING_AT_1', async () => {
    const { service } = make();
    await rejectsInvalid(service.replace({ categories: [c('A', 2, null)] } as never), ['NOT_STARTING_AT_1']);
  });

  it('vacío, código repetido, hasta < desde y decimales también rebotan con su código', async () => {
    const { service } = make();
    await rejectsInvalid(service.replace({ categories: [] } as never), ['EMPTY']);
    await rejectsInvalid(service.replace({ categories: [c('A', 1, 30), c('A', 31, null)] } as never), ['CODE_DUPLICATE']);
    await rejectsInvalid(service.replace({ categories: [c('A', 10, 5)] } as never), ['TO_BEFORE_FROM', 'NOT_STARTING_AT_1']);
    await rejectsInvalid(service.replace({ categories: [c('A', 1.5, null)] } as never), ['RANGE_INVALID', 'NOT_STARTING_AT_1']);
  });

  it('una sola entrada de auditoría con el antes y el después (UPDATE; CREATE si no había nada)', async () => {
    const edit = make(DEFAULTS);
    await edit.service.replace({ categories: [c('A', 1, 15), c('B', 16, null)] } as never);
    assert.equal(edit.audited.length, 1);
    const a = edit.audited[0]!;
    assert.equal(a.action, 'UPDATE');
    assert.equal(a.entity, 'arrear_categories');
    assert.equal(a.entityId, 'acc-A');
    assert.equal((a.before as unknown[]).length, 3);
    assert.equal((a.after as unknown[]).length, 2);

    const first = make();
    await first.service.replace({ categories: [c('A', 1, null)] } as never);
    assert.equal(first.audited[0]!.action, 'CREATE');
  });

  it('el siguiente GET ve el cambio: no hay caché', async () => {
    const { service } = make(DEFAULTS);
    await service.replace({ categories: [c('A', 1, null)] } as never);
    assert.deepEqual((await service.list()).data!.map((r) => r.code), ['A']);
  });
});

describe('permisos de /arrear-categories', () => {
  const rolesOf = (method: 'list' | 'replace'): string[] =>
    (Reflect.getMetadata(ROLES_KEY, (ArrearCategoriesController.prototype as unknown as Record<string, object>)[method]!) as string[]) ?? [];

  it('GET exige collection:read: lo tienen todos los roles que ven Mora', () => {
    assert.deepEqual(rolesOf('list'), [Permission.COLLECTION_READ]);
    for (const role of [RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR, RoleType.VIEWER]) {
      assert.ok((ROLE_PERMISSIONS[role] as string[]).includes(Permission.COLLECTION_READ), role);
    }
  });

  it('🔴 PUT exige account:write (administración): gerente, supervisor y cobrador no lo tienen', () => {
    assert.deepEqual(rolesOf('replace'), [Permission.ACCOUNT_WRITE]);
    for (const role of [RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR, RoleType.VIEWER]) {
      assert.ok(!(ROLE_PERMISSIONS[role] as string[]).includes(Permission.ACCOUNT_WRITE), `${role} no debería poder editar las categorías`);
    }
    assert.ok((ROLE_PERMISSIONS[RoleType.ACCOUNT_ADMIN] as string[]).includes(Permission.ACCOUNT_WRITE));
  });
});
