import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { RolesService } from './roles.service';
import { roleEditPermissions } from '../../common/authz/policies/role-edit-permissions.policy';
import { throwIfDenied } from '../../common/authz/authorization.service';
import type { RoleEditFacts } from '../../common/authz/facts-loader';

/**
 * Un "mundo" en memoria de una cuenta: roles con sus permisos, plantillas, catálogo y miembros. `withTenant` clona el estado y lo RESTAURA si la
 * transacción lanza, así se prueba que el cambio y la auditoría son atómicos.
 */
interface RoleState { id: string; key: string; tier: number; templateKey: string | null; version: number; divergedAt: Date | null; perms: Set<string> }
interface World {
  roles: Map<string, RoleState>;
  templates: Map<string, string[]>;
  catalog: { code: string; id: string; reserved: 'ADMIN_CORE' | null; requires: string[] }[];
  members: { id: string; userId: string; accountRoleId: string; isActive: boolean }[];
  audit: Record<string, unknown>[];
  bumped: string[][];
  published: number;
  rows: { roleId: string; code: string; source: string; grantedBy: string | null }[];
}

const CATALOG: World['catalog'] = [
  { code: 'client:read', id: 'p-cr', reserved: null, requires: [] },
  { code: 'client:write', id: 'p-cw', reserved: null, requires: ['client:read'] },
  { code: 'report:export', id: 'p-re', reserved: null, requires: [] },
  { code: 'role:write', id: 'p-rw', reserved: 'ADMIN_CORE', requires: [] },
  { code: 'data:scope:subtree', id: 'p-ds', reserved: null, requires: [] },
  { code: 'data:scope:all', id: 'p-da', reserved: null, requires: [] },
];

function world(): World {
  const mgr: RoleState = { id: 'r-mgr', key: 'MANAGER', tier: 70, templateKey: 'MANAGER', version: 3, divergedAt: null, perms: new Set(['client:read', 'data:scope:subtree']) };
  const adm: RoleState = { id: 'r-adm', key: 'ACCOUNT_ADMIN', tier: 90, templateKey: 'ACCOUNT_ADMIN', version: 1, divergedAt: null, perms: new Set(CATALOG.map((c) => c.code)) };
  return {
    roles: new Map([['MANAGER', mgr], ['ACCOUNT_ADMIN', adm]]),
    templates: new Map([['MANAGER', ['client:read', 'data:scope:subtree']], ['ACCOUNT_ADMIN', CATALOG.map((c) => c.code)]]),
    catalog: CATALOG,
    members: [{ id: 'm1', userId: 'u-ana', accountRoleId: 'r-mgr', isActive: true }, { id: 'm2', userId: 'u-luis', accountRoleId: 'r-mgr', isActive: true }, { id: 'm3', userId: 'u-off', accountRoleId: 'r-mgr', isActive: false }],
    audit: [],
    bumped: [],
    published: 0,
    rows: [],
  };
}

function makeService(opts: { w?: World; permissions?: string[]; auditFails?: boolean; actorInRole?: boolean; platform?: boolean } = {}) {
  const w = opts.w ?? world();
  const perms = opts.permissions ?? [Permission.ROLE_WRITE, ...CATALOG.map((c) => c.code)];
  const byKey = (k: string) => w.roles.get(k);
  const byId = (id: string) => [...w.roles.values()].find((r) => r.id === id)!;

  const tx = {
    $queryRaw: async () => [],
    accountRole: {
      findFirst: async (a: { where: { key: string } }) => {
        const r = byKey(a.where.key);
        return r ? { id: r.id, key: r.key, templateKey: r.templateKey } : null;
      },
      findMany: async (a: { where: { key?: string } }) =>
        [...w.roles.values()]
          .filter((r) => !a.where.key || r.key === a.where.key)
          .map((r) => ({
            id: r.id, key: r.key, tier: r.tier, templateKey: r.templateKey, version: r.version, divergedAt: r.divergedAt, updatedAt: new Date('2026-11-08T10:00:00Z'),
            permissions: [...r.perms].map((code) => ({ permission: { code } })),
            template: r.templateKey ? { permissions: (w.templates.get(r.templateKey) ?? []).map((code) => ({ permission: { code } })) } : null,
          })),
      update: async (a: { where: { id: string }; data: { version: { increment: number }; divergedAt: Date | null } }) => {
        const r = byId(a.where.id);
        r.version += a.data.version.increment;
        r.divergedAt = a.data.divergedAt;
      },
    },
    permission: {
      findMany: async (a: { where: { code: { in: string[] } } }) => w.catalog.filter((c) => a.where.code.in.includes(c.code)).map((c) => ({ id: c.id, code: c.code })),
      count: async () => w.catalog.length,
    },
    roleTemplatePermission: { findMany: async (a: { where: { templateKey: string } }) => (w.templates.get(a.where.templateKey) ?? []).map((code) => ({ permission: { code } })) },
    accountRolePermission: {
      deleteMany: async (a: { where: { accountRoleId: string; permissionId: { in: string[] } } }) => {
        const r = byId(a.where.accountRoleId);
        for (const id of a.where.permissionId.in) r.perms.delete(w.catalog.find((c) => c.id === id)!.code);
      },
      createMany: async (a: { data: { accountRoleId: string; permissionId: string; source: string; grantedBy: string | null }[] }) => {
        for (const d of a.data) {
          const code = w.catalog.find((c) => c.id === d.permissionId)!.code;
          byId(d.accountRoleId).perms.add(code);
          w.rows.push({ roleId: d.accountRoleId, code, source: d.source, grantedBy: d.grantedBy });
        }
      },
    },
    userAccount: {
      findMany: async (a: { where: { accountRoleId: string; isActive?: boolean }; select: Record<string, unknown> }) => {
        const ms = w.members.filter((m) => m.accountRoleId === a.where.accountRoleId && (a.where.isActive === undefined || m.isActive === a.where.isActive));
        return a.select.user ? ms.map((m) => ({ userId: m.userId, isActive: m.isActive, user: { email: `${m.userId}@x.test`, profile: { firstName: m.userId, lastName: 'X' } } })) : ms.map((m) => ({ id: m.id }));
      },
      groupBy: async () => {
        const counts = new Map<string, number>();
        for (const m of w.members.filter((x) => x.isActive)) counts.set(m.accountRoleId, (counts.get(m.accountRoleId) ?? 0) + 1);
        return [...counts].map(([accountRoleId, n]) => ({ accountRoleId, _count: { _all: n } }));
      },
    },
    role: { findMany: async () => [{ id: 'g-mgr', name: 'MANAGER' }, { id: 'g-adm', name: 'ACCOUNT_ADMIN' }] },
  };

  const clone = () => ({
    roles: new Map([...w.roles].map(([k, r]) => [k, { ...r, perms: new Set(r.perms) }])),
    audit: [...w.audit], bumped: [...w.bumped], rows: [...w.rows],
  });
  const prisma = {
    withTenant: async <T>(_a: string, fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      const snap = clone();
      try {
        return await fn(tx);
      } catch (err) {
        w.roles = snap.roles as World['roles']; w.audit = snap.audit; w.bumped = snap.bumped; w.rows = snap.rows;
        throw err;
      }
    },
  };
  const ctx = { accountId: 'acc', userId: 'u-admin', get: () => ({ actorType: opts.platform ? 'PLATFORM' : undefined }) };
  const audit = {
    recordInTx: async (_t: unknown, e: Record<string, unknown>) => {
      if (opts.auditFails) throw new Error('auditoría caída');
      w.audit.push(e);
    },
  };
  const policies = {
    assert: async (name: string, input: { key: string; permissions: string[] }) => {
      assert.equal(name, 'role.editPermissions');
      const r = byKey(input.key);
      const facts: RoleEditFacts = {
        role: r ? { id: r.id, key: r.key, version: r.version, permissions: [...r.perms].sort() } : null,
        catalog: w.catalog.map((c) => ({ code: c.code, reserved: c.reserved, requires: c.requires })),
        actorInTargetRole: opts.actorInRole ?? false,
      };
      const d = roleEditPermissions.decide({ userId: 'u-admin', accountId: 'acc', can: (p) => perms.includes(p) }, facts, input);
      throwIfDenied(d);
      return d.allow ? d.data : undefined;
    },
  };
  const authz = {
    bumpInTx: async (_t: unknown, _a: string, ids: string[]) => (w.bumped.push(ids), ids.map((id) => ({ outboxId: id }))),
    publish: async () => { w.published += 1; },
  };
  const service = new RolesService(prisma as never, ctx as never, audit as never, policies as never, authz as never);
  return { service, w };
}

const reject = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: { response?: { code?: string } }) => e.response?.code === code, `esperaba ${code}`);

describe('RolesService.updatePermissions (F14 · F7)', () => {
  const ok = { permissions: ['client:read', 'client:write', 'report:export', 'data:scope:subtree'], expectedVersion: 3, reason: 'Pidieron exportar' };

  it('cambia los permisos, sube la versión, marca la divergencia y renueva a los miembros ACTIVOS del rol', async () => {
    const { service, w } = makeService();
    const res = await service.updatePermissions('MANAGER', ok);
    assert.deepEqual([...w.roles.get('MANAGER')!.perms].sort(), [...ok.permissions].sort());
    assert.equal(w.roles.get('MANAGER')!.version, 4);
    assert.ok(w.roles.get('MANAGER')!.divergedAt, 'queda registrada la divergencia');
    assert.deepEqual(w.bumped, [['m1', 'm2']], 'sólo los miembros activos');
    assert.equal(res.affectedMembers, 2);
    assert.equal(w.published, 1, 'publica a Redis después del commit');
    assert.deepEqual(res.role.diff, { added: ['client:write', 'report:export'], removed: [] });
    assert.equal(res.role.diverged, true);
  });

  it('🔴 la auditoría va en la MISMA transacción, con lo añadido, lo quitado y el motivo (sin datos personales)', async () => {
    const { service, w } = makeService();
    await service.updatePermissions('MANAGER', { ...ok, permissions: ['client:read', 'report:export', 'data:scope:subtree'] });
    assert.equal(w.audit.length, 1);
    assert.deepEqual(w.audit[0], { entity: 'account_role', entityId: 'r-mgr', action: 'ROLE_PERMISSIONS_UPDATED', after: { key: 'MANAGER', added: ['report:export'], removed: [], reason: 'Pidieron exportar' } });
  });

  it('🔴 si la auditoría falla, NO queda ningún cambio (atomicidad)', async () => {
    const { service, w } = makeService({ auditFails: true });
    await assert.rejects(() => service.updatePermissions('MANAGER', ok), /auditoría caída/);
    assert.deepEqual([...w.roles.get('MANAGER')!.perms].sort(), ['client:read', 'data:scope:subtree']);
    assert.equal(w.roles.get('MANAGER')!.version, 3);
    assert.equal(w.published, 0, 'tampoco se publicó nada');
  });

  it('🔴 sin motivo (o demasiado corto) no se cambia nada', async () => {
    const { service, w } = makeService();
    await reject(service.updatePermissions('MANAGER', { ...ok, reason: '  ab ' }), 'ROLE_REASON_REQUIRED');
    assert.equal(w.roles.get('MANAGER')!.version, 3);
    assert.equal(w.audit.length, 0);
  });

  it('🔴 edición simultánea: si la versión cambió, 409 ROLE_VERSION_CONFLICT y no se escribe nada', async () => {
    const { service, w } = makeService();
    await reject(service.updatePermissions('MANAGER', { ...ok, expectedVersion: 2 }), 'ROLE_VERSION_CONFLICT');
    assert.equal(w.audit.length, 0);
    assert.equal(w.roles.get('MANAGER')!.version, 3);
  });

  it('sin diferencias no escribe, no audita y no renueva sesiones', async () => {
    const { service, w } = makeService();
    const res = await service.updatePermissions('MANAGER', { ...ok, permissions: ['client:read', 'data:scope:subtree'] });
    assert.equal(res.affectedMembers, 0);
    assert.equal(w.audit.length, 0);
    assert.equal(w.bumped.length, 0);
    assert.equal(w.roles.get('MANAGER')!.version, 3);
  });

  it('🔴 las reglas de la política se aplican: reservado, dependencia, dos alcances, el administrador', async () => {
    const { service, w } = makeService();
    await reject(service.updatePermissions('MANAGER', { ...ok, permissions: [...ok.permissions, 'role:write'] }), 'ROLE_RESERVED');
    await reject(service.updatePermissions('MANAGER', { ...ok, permissions: ['client:write', 'data:scope:subtree'] }), 'ROLE_DEPENDENCY');
    await reject(service.updatePermissions('MANAGER', { ...ok, permissions: ['client:read', 'data:scope:all', 'data:scope:subtree'] }), 'ROLE_SCOPE');
    await reject(service.updatePermissions('ACCOUNT_ADMIN', { ...ok, expectedVersion: 1, permissions: ['client:read'] }), 'ROLE_PROTECTED');
    assert.equal(w.audit.length, 0);
    assert.equal(w.roles.get('MANAGER')!.version, 3);
  });

  it('🔴 sin role:write → ROLE_WRITE_FORBIDDEN; un rol inexistente → 404', async () => {
    await reject(makeService({ permissions: ['client:read'] }).service.updatePermissions('MANAGER', ok), 'ROLE_WRITE_FORBIDDEN');
    await reject(makeService().service.updatePermissions('FANTASMA', ok), 'ROLE_NOT_FOUND');
  });

  it('🔴 quien pertenece al rol que edita sólo puede quitar', async () => {
    await reject(makeService({ actorInRole: true }).service.updatePermissions('MANAGER', ok), 'ROLE_SELF_ELEVATION');
  });

  it('lo que la plantilla ya traía vuelve a ser «de plantilla» y lo nuevo es «personalizado»; quien lo concede queda registrado', async () => {
    const { service, w } = makeService();
    await service.updatePermissions('MANAGER', { ...ok, permissions: ['client:write', 'client:read', 'data:scope:subtree'], expectedVersion: 3 });
    assert.deepEqual(w.rows.map((r) => [r.code, r.source, r.grantedBy]), [['client:write', 'CUSTOM', 'u-admin']]);
  });

  it('la plataforma (sesión de soporte) no queda como «concedido por» una persona de la cuenta', async () => {
    const { service, w } = makeService({ platform: true });
    await service.updatePermissions('MANAGER', ok);
    assert.ok(w.rows.every((r) => r.grantedBy === null));
  });
});

describe('RolesService.restoreTemplate (F14 · F7)', () => {
  it('devuelve el rol a su plantilla y limpia la divergencia', async () => {
    const w = world();
    const r = w.roles.get('MANAGER')!;
    r.perms = new Set(['client:read', 'client:write', 'data:scope:subtree']);
    r.divergedAt = new Date();
    const { service } = makeService({ w });
    const res = await service.restoreTemplate('MANAGER', { expectedVersion: 3, reason: 'Volver a lo estándar' });
    assert.deepEqual([...w.roles.get('MANAGER')!.perms].sort(), ['client:read', 'data:scope:subtree']);
    assert.equal(w.roles.get('MANAGER')!.divergedAt, null);
    assert.equal(res.role.diverged, false);
    assert.equal(w.audit[0]!.action, 'ROLE_RESTORED_TEMPLATE');
  });

  it('un rol sin plantilla no se puede restaurar', async () => {
    const w = world();
    w.roles.get('MANAGER')!.templateKey = null;
    await reject(makeService({ w }).service.restoreTemplate('MANAGER', { expectedVersion: 3, reason: 'Probando' }), 'ROLE_NO_TEMPLATE');
  });

  it('exige motivo y versión como cualquier cambio', async () => {
    const { service } = makeService();
    await reject(service.restoreTemplate('MANAGER', { expectedVersion: 3, reason: '' }), 'ROLE_REASON_REQUIRED');
    await reject(service.restoreTemplate('MANAGER', { expectedVersion: 1, reason: 'Probando' }), 'ROLE_VERSION_CONFLICT');
  });
});

describe('RolesService · lectura', () => {
  it('listAll: resumen por rol con su divergencia calculada contra la plantilla, personas ACTIVAS y el identificador para invitar', async () => {
    const w = world();
    w.roles.get('MANAGER')!.perms.add('report:export');
    const { service } = makeService({ w });
    const list = await service.listAll();
    const mgr = list.find((r) => r.key === 'MANAGER')!;
    assert.equal(mgr.id, 'g-mgr', 'el id es el que ya usan invitar y cambiar el rol');
    assert.equal(mgr.name, 'MANAGER');
    assert.equal(mgr.level, 70);
    assert.equal(mgr.diverged, true);
    assert.equal(mgr.members, 2);
    assert.equal(mgr.scopeKind, 'SUBTREE');
    assert.equal(mgr.editable, true);
    assert.equal(list.find((r) => r.key === 'ACCOUNT_ADMIN')!.editable, false);
  });

  it('detalle: permisos, diferencia y personas', async () => {
    const { service } = makeService();
    const d = await service.detail('MANAGER');
    assert.deepEqual(d.granted, ['client:read', 'data:scope:subtree']);
    assert.deepEqual(d.diff, { added: [], removed: [] });
    assert.deepEqual(d.people.map((p) => p.userId), ['u-ana', 'u-luis', 'u-off']);
    await reject(service.detail('NADA'), 'ROLE_NOT_FOUND');
  });

  it('comparar: una fila por permiso que alguno tiene', async () => {
    const { service } = makeService();
    const c = await service.compare('MANAGER', 'ACCOUNT_ADMIN');
    assert.equal(c.a.key, 'MANAGER');
    assert.deepEqual(c.rows.find((r) => r.code === 'report:export'), { code: 'report:export', a: false, b: true });
    assert.deepEqual(c.rows.find((r) => r.code === 'client:read'), { code: 'client:read', a: true, b: true });
  });
});

describe('RolesService.assignable — el contrato histórico de GET /roles (F14 · F2 / F7 D-1)', () => {
  const ALL = [
    { id: 'g-adm', name: 'ACCOUNT_ADMIN', level: 90 },
    { id: 'g-mgr', name: 'MANAGER', level: 70 },
    { id: 'g-col', name: 'COLLECTOR', level: 30 },
  ];
  function svc(mine: { name: string; level: number } | null) {
    const where: { name?: unknown }[] = [];
    const tx = {
      role: { findMany: async (a: { where: { name: unknown } }) => (where.push(a.where), ALL) },
      userAccount: { findFirst: async () => (mine ? { role: mine } : null) },
    };
    const prisma = { withTenant: async <T>(_a: string, fn: (t: typeof tx) => Promise<T>) => fn(tx) };
    return { service: new RolesService(prisma as never, { accountId: 'acc', userId: 'u1' } as never, {} as never, {} as never, {} as never), where };
  }

  it('consulta sólo los roles que la app administra', async () => {
    const { service, where } = svc({ name: 'ACCOUNT_ADMIN', level: 90 });
    await service.assignable();
    assert.deepEqual(where[0]!.name, { in: ['ACCOUNT_ADMIN', 'MANAGER', 'SUPERVISOR', 'COLLECTOR'] });
  });

  it('sólo ofrece roles de nivel ESTRICTAMENTE inferior al de quien pregunta y nunca el reservado', async () => {
    assert.deepEqual((await svc({ name: 'MANAGER', level: 70 }).service.assignable()).map((r) => r.name), ['COLLECTOR']);
    assert.deepEqual((await svc({ name: 'ACCOUNT_ADMIN', level: 90 }).service.assignable()).map((r) => r.name), ['MANAGER', 'COLLECTOR']);
  });

  it('🔴 contrato: cada fila trae EXACTAMENTE { id, name, level } (lo que leen la web y los móviles instalados)', async () => {
    const rows = await svc({ name: 'ACCOUNT_ADMIN', level: 90 }).service.assignable();
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['id', 'level', 'name']);
  });

  it('quien no tiene rol en la cuenta no recibe ninguno', async () => {
    assert.deepEqual(await svc(null).service.assignable(), []);
  });
});
