import { describe, expect, it } from 'vitest';
import { checkRoleEdit, diffPermissions, withDependencies, ROLE_ERROR, type RoleEditInput } from './role-edit.js';

const catalog: RoleEditInput['catalog'] = [
  { code: 'client:read', reserved: null, requires: [] },
  { code: 'client:write', reserved: null, requires: ['client:read'] },
  { code: 'client:delete', reserved: null, requires: ['client:write'] },
  { code: 'report:export', reserved: null, requires: [] },
  { code: 'user:write', reserved: 'ADMIN_CORE', requires: [] },
  { code: 'platform:accounts:read', reserved: 'PLATFORM', requires: [] },
  { code: 'data:scope:all', reserved: null, requires: [] },
  { code: 'data:scope:subtree', reserved: null, requires: [] },
  { code: 'data:scope:branch', reserved: null, requires: [] },
];

const base: RoleEditInput = {
  targetKey: 'MANAGER',
  catalog,
  current: ['client:read', 'data:scope:subtree'],
  desired: ['client:read', 'data:scope:subtree'],
  actorHas: () => true,
  actorInTargetRole: false,
};
const codes = (i: Partial<RoleEditInput>) => checkRoleEdit({ ...base, ...i }).map((v) => v.code);

describe('checkRoleEdit · reglas de edición de un rol (F14 · F7, D-3)', () => {
  it('un cambio válido no tiene incumplimientos', () => {
    expect(codes({ desired: ['client:read', 'client:write', 'report:export', 'data:scope:subtree'] })).toEqual([]);
    expect(codes({})).toEqual([]);
  });

  it('🔴 el rol de administrador de la cuenta no se edita', () => {
    expect(codes({ targetKey: 'ACCOUNT_ADMIN', desired: ['client:read'] })).toEqual([ROLE_ERROR.PROTECTED]);
  });

  it('🔴 no se añade ni se quita un permiso reservado', () => {
    expect(codes({ desired: [...base.desired, 'user:write'] })).toContain(ROLE_ERROR.RESERVED);
    expect(codes({ current: [...base.current, 'user:write'], desired: base.desired })).toContain(ROLE_ERROR.RESERVED);
    expect(codes({ desired: [...base.desired, 'platform:accounts:read'] })).toContain(ROLE_ERROR.RESERVED);
  });

  it('🔴 no concede lo que quien edita no tiene', () => {
    const v = checkRoleEdit({ ...base, desired: [...base.desired, 'report:export'], actorHas: (c) => c !== 'report:export' });
    expect(v.map((x) => x.code)).toContain(ROLE_ERROR.GRANT_EXCEEDS_ACTOR);
    expect(v.find((x) => x.code === ROLE_ERROR.GRANT_EXCEEDS_ACTOR)!.permissions).toEqual(['report:export']);
  });

  it('quitar no exige tenerlo: lo que ya tiene el rol se puede quitar aunque quien edita no lo tenga', () => {
    expect(codes({ current: [...base.current, 'report:export'], desired: base.desired, actorHas: () => false })).toEqual([]);
  });

  it('🔴 quien pertenece al rol que edita sólo puede quitar', () => {
    expect(codes({ actorInTargetRole: true, desired: [...base.desired, 'report:export'] })).toContain(ROLE_ERROR.SELF_ELEVATION);
    expect(codes({ actorInTargetRole: true, current: [...base.current, 'report:export'], desired: base.desired })).toEqual([]);
  });

  it('🔴 las dependencias deben quedar satisfechas: no se añade lo que depende de algo ausente ni se quita de lo que otro depende', () => {
    const add = checkRoleEdit({ ...base, desired: [...base.desired, 'client:delete'] });
    expect(add.map((v) => v.code)).toContain(ROLE_ERROR.DEPENDENCY);
    expect(add.find((v) => v.code === ROLE_ERROR.DEPENDENCY)!.permissions).toEqual(expect.arrayContaining(['client:write', 'client:delete']));

    const remove = checkRoleEdit({
      ...base,
      current: ['client:read', 'client:write', 'data:scope:subtree'],
      desired: ['client:write', 'data:scope:subtree'],
    });
    expect(remove.map((v) => v.code)).toContain(ROLE_ERROR.DEPENDENCY);
  });

  it('🔴 a lo sumo un alcance de datos: dos se rechazan; ninguno es válido (alcance propio, el del cobrador)', () => {
    expect(codes({ desired: ['client:read'] })).toEqual([]);
    expect(codes({ desired: ['client:read', 'data:scope:all', 'data:scope:branch'] })).toContain(ROLE_ERROR.SCOPE);
    expect(codes({ desired: ['client:read', 'data:scope:all'] })).toEqual([]);
  });

  it('un código que no existe se rechaza', () => {
    expect(codes({ desired: [...base.desired, 'inventado:todo'] })).toContain(ROLE_ERROR.UNKNOWN_PERMISSION);
  });

  it('los estados de respuesta: 403 para lo no autorizado y 422 para un conjunto inválido', () => {
    const by = (i: Partial<RoleEditInput>) => Object.fromEntries(checkRoleEdit({ ...base, ...i }).map((v) => [v.code, v.status]));
    expect(by({ desired: [...base.desired, 'user:write'] })[ROLE_ERROR.RESERVED]).toBe(403);
    expect(by({ desired: ['client:read', 'data:scope:all', 'data:scope:branch'] })[ROLE_ERROR.SCOPE]).toBe(422);
  });
});

describe('checkRoleEdit · sólo juzga lo que el cambio toca (revisión de código de F7)', () => {
  const legacy = { ...base, current: ['client:write', 'viejo:retirado', 'data:scope:all', 'data:scope:branch'], desired: ['client:write', 'viejo:retirado', 'data:scope:all', 'data:scope:branch'] };
  it('🔴 un rol que ya traía algo fuera de regla (código retirado, dependencia rota, dos alcances) no queda atascado por un cambio ajeno', () => {
    expect(checkRoleEdit({ ...legacy, desired: [...legacy.desired, 'report:export'] })).toEqual([]);
    expect(checkRoleEdit({ ...legacy, desired: legacy.desired.filter((c) => c !== 'data:scope:branch') })).toEqual([]);
  });

  it('pero lo que el cambio introduce sí se juzga: añadir un código inexistente, o un segundo alcance, o romper una dependencia', () => {
    const codes2 = (desired: string[]) => checkRoleEdit({ ...legacy, desired }).map((v) => v.code);
    expect(codes2([...legacy.desired, 'inventado:todo'])).toContain(ROLE_ERROR.UNKNOWN_PERMISSION);
    expect(codes2([...legacy.desired, 'data:scope:subtree'])).toContain(ROLE_ERROR.SCOPE);
    expect(checkRoleEdit({ ...base, current: ['client:read', 'client:write', 'data:scope:subtree'], desired: ['client:write', 'data:scope:subtree'] }).map((v) => v.code)).toContain(ROLE_ERROR.DEPENDENCY);
  });
});

describe('diffPermissions / withDependencies', () => {
  it('la diferencia sale ordenada', () => {
    expect(diffPermissions(['b', 'a'], ['c', 'a'])).toEqual({ added: ['c'], removed: ['b'] });
  });

  it('cierra un conjunto sobre sus dependencias, también las encadenadas', () => {
    expect(withDependencies(['client:delete'], catalog).sort()).toEqual(['client:delete', 'client:read', 'client:write']);
  });
});
