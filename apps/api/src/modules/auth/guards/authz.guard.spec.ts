import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthzGuard } from './authz.guard';
import { TenantGuard } from './tenant.guard';
import { Authenticated, Authz, Destructive, Policy, Public } from '../decorators/authz.decorator';
import { Roles, RolesAny } from '../decorators/roles.decorator';
import { resolveAccess } from '../authz-access';

class Open {
  @Public() open() {}
  @Authenticated() mine() {}
  @Roles('a:read', 'b:read') all() {}
  @RolesAny('x:write', 'y:write') some() {}
  @Authz({ all: ['a:read'], any: ['x:write', 'y:write'] }) both() {}
  @Roles('a:read') @Policy('credit.writeOff') @Destructive() risky() {}
  bare() {}
}

@Roles('cls:read')
class WithClassRoles {
  inherits() {}
  @Authenticated() own() {}
  @Roles('own:read') overrides() {}
}

@Authenticated()
class ClassAuthenticated {
  inherits() {}
  @Roles('p:read') stricter() {}
}

function ctx(cls: { prototype: Record<string, () => void> } & (new () => unknown), method: string, perms: string[] | null) {
  const req = { user: perms === null ? undefined : { permissions: perms, accountId: 'a1' } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => cls.prototype[method]!,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return ((e as { getResponse?: () => { code?: string } }).getResponse?.() ?? {}).code;
  }
};
const guard = (deny = true) => new AuthzGuard(new Reflector(), { authzDenyByDefault: deny } as never);

describe('AuthzGuard — negación por defecto y permisos (F14 · F3)', () => {
  it('🔴 sin contrato → 403 AUTHZ_000', () => {
    assert.equal(codeOf(() => guard().canActivate(ctx(Open as never, 'bare', ['a:read']))), 'AUTHZ_000');
  });
  it('modo log (rollback): sin contrato pasa', () => {
    assert.equal(guard(false).canActivate(ctx(Open as never, 'bare', [])), true);
  });
  it('@Public y @Authenticated pasan sin permisos', () => {
    assert.equal(guard().canActivate(ctx(Open as never, 'open', null)), true);
    assert.equal(guard().canActivate(ctx(Open as never, 'mine', [])), true);
  });
  it('@Roles exige TODOS; @RolesAny, ALGUNO; @Authz las dos', () => {
    assert.equal(guard().canActivate(ctx(Open as never, 'all', ['a:read', 'b:read'])), true);
    assert.equal(codeOf(() => guard().canActivate(ctx(Open as never, 'all', ['a:read']))), 'AUTH_002');
    assert.equal(guard().canActivate(ctx(Open as never, 'some', ['y:write'])), true);
    assert.equal(codeOf(() => guard().canActivate(ctx(Open as never, 'some', ['a:read']))), 'AUTH_002');
    assert.equal(guard().canActivate(ctx(Open as never, 'both', ['a:read', 'x:write'])), true);
    assert.equal(codeOf(() => guard().canActivate(ctx(Open as never, 'both', ['x:write']))), 'AUTH_002');
    assert.equal(codeOf(() => guard().canActivate(ctx(Open as never, 'both', ['a:read']))), 'AUTH_002');
  });
});

describe('resolveAccess — precedencia handler > clase', () => {
  const r = new Reflector();
  it('hereda los permisos de la clase; el handler los reemplaza; @Authenticated del handler gana', () => {
    assert.deepEqual(resolveAccess(r, WithClassRoles.prototype.inherits, WithClassRoles), { kind: 'permissions', all: ['cls:read'], any: [], policy: undefined, destructive: false });
    assert.equal(resolveAccess(r, WithClassRoles.prototype.own, WithClassRoles)?.kind, 'authenticated');
    assert.deepEqual((resolveAccess(r, WithClassRoles.prototype.overrides, WithClassRoles) as { all: string[] }).all, ['own:read']);
  });
  it('@Authenticated de clase se hereda; un @Roles de handler lo endurece', () => {
    assert.equal(resolveAccess(r, ClassAuthenticated.prototype.inherits, ClassAuthenticated)?.kind, 'authenticated');
    assert.equal(resolveAccess(r, ClassAuthenticated.prototype.stricter, ClassAuthenticated)?.kind, 'permissions');
  });
  it('@Policy y @Destructive quedan en el contrato', () => {
    assert.deepEqual(resolveAccess(r, Open.prototype.risky, Open), { kind: 'permissions', all: ['a:read'], any: [], policy: 'credit.writeOff', destructive: true });
  });
});

describe('TenantGuard global — sólo exige tenant a los handlers con permisos', () => {
  const tenant = new TenantGuard(new Reflector());
  it('permisos sin accountId → 403 TENANT_001', () => {
    const c = { switchToHttp: () => ({ getRequest: () => ({ user: { permissions: [] } }) }), getHandler: () => Open.prototype.all, getClass: () => Open } as unknown as ExecutionContext;
    assert.equal(codeOf(() => tenant.canActivate(c)), 'TENANT_001');
  });
  it('público y autenticado no lo exigen', () => {
    assert.equal(tenant.canActivate(ctx(Open as never, 'open', null)), true);
    assert.equal(tenant.canActivate(ctx(Open as never, 'mine', null)), true);
  });
});
