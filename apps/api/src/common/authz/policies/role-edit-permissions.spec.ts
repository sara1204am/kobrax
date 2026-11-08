import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { roleEditPermissions } from './role-edit-permissions.policy';
import type { RoleEditFacts } from '../facts-loader';
import { actorWith, codeOf } from './policy-test-utils';

const catalog: RoleEditFacts['catalog'] = [
  { code: 'client:read', reserved: null, requires: [] },
  { code: 'client:write', reserved: null, requires: ['client:read'] },
  { code: 'report:export', reserved: null, requires: [] },
  { code: 'user:write', reserved: 'ADMIN_CORE', requires: [] },
  { code: 'role:write', reserved: 'ADMIN_CORE', requires: [] },
  { code: 'data:scope:all', reserved: null, requires: [] },
  { code: 'data:scope:subtree', reserved: null, requires: [] },
];
const facts = (over: Partial<RoleEditFacts> = {}): RoleEditFacts => ({
  role: { id: 'r-mgr', key: 'MANAGER', version: 3, permissions: ['client:read', 'data:scope:subtree'] },
  catalog,
  actorInTargetRole: false,
  ...over,
});
const admin = actorWith([Permission.ROLE_WRITE, 'client:read', 'client:write', 'report:export', 'user:write', 'role:write', 'data:scope:all', 'data:scope:subtree']);
const run = (actor = admin, f = facts(), permissions = ['client:read', 'data:scope:subtree']) => roleEditPermissions.decide(actor, f, { key: 'MANAGER', permissions });

describe('role.editPermissions (F14 · F7, D-3)', () => {
  it('sin role:write → ROLE_WRITE_FORBIDDEN', () => {
    assert.equal(codeOf(run(actorWith([]))), 'ROLE_WRITE_FORBIDDEN');
  });

  it('un rol que no existe en la cuenta → 404 ROLE_NOT_FOUND', () => {
    const d = run(admin, facts({ role: null }));
    assert.equal(codeOf(d), 'ROLE_NOT_FOUND');
    assert.equal(d.allow === false && d.status, 404);
  });

  it('un cambio válido se permite y devuelve la versión y los permisos actuales', () => {
    const d = run(admin, facts(), ['client:read', 'client:write', 'report:export', 'data:scope:subtree']);
    assert.equal(d.allow, true);
    assert.deepEqual(d.allow && d.data, { roleId: 'r-mgr', version: 3, current: ['client:read', 'data:scope:subtree'] });
  });

  it('🔴 el rol de administrador no se edita', () => {
    const d = roleEditPermissions.decide(admin, facts({ role: { id: 'r-adm', key: 'ACCOUNT_ADMIN', version: 1, permissions: ['client:read'] } }), { key: 'ACCOUNT_ADMIN', permissions: ['client:read'] });
    assert.equal(codeOf(d), 'ROLE_PROTECTED');
  });

  it('🔴 un permiso reservado no se añade', () => {
    assert.equal(codeOf(run(admin, facts(), ['client:read', 'data:scope:subtree', 'role:write'])), 'ROLE_RESERVED');
  });

  it('🔴 no concede lo que no tiene (aunque tenga role:write)', () => {
    const limited = actorWith([Permission.ROLE_WRITE, 'client:read', 'data:scope:subtree']);
    assert.equal(codeOf(run(limited, facts(), ['client:read', 'report:export', 'data:scope:subtree'])), 'ROLE_GRANT_EXCEEDS_ACTOR');
  });

  it('🔴 quien pertenece al rol que edita sólo puede quitar', () => {
    const mine = facts({ actorInTargetRole: true });
    assert.equal(codeOf(run(admin, mine, ['client:read', 'report:export', 'data:scope:subtree'])), 'ROLE_SELF_ELEVATION');
    assert.equal(run(admin, mine, ['client:read', 'data:scope:subtree']).allow, true);
  });

  it('🔴 dependencia no satisfecha → 422 con los permisos implicados', () => {
    const d = run(admin, facts(), ['client:write', 'data:scope:subtree']);
    assert.equal(codeOf(d), 'ROLE_DEPENDENCY');
    assert.equal(d.allow === false && d.status, 422);
    assert.deepEqual(d.allow === false && d.details, { violations: [{ code: 'ROLE_DEPENDENCY', permissions: ['client:read', 'client:write'] }] });
  });

  it('🔴 a lo sumo un alcance de datos (ninguno es válido: alcance propio)', () => {
    assert.equal(run(admin, facts(), ['client:read']).allow, true);
    assert.equal(codeOf(run(admin, facts(), ['client:read', 'data:scope:all', 'data:scope:subtree'])), 'ROLE_SCOPE');
  });

  it('un código que no existe → 422', () => {
    assert.equal(codeOf(run(admin, facts(), ['client:read', 'data:scope:subtree', 'nada:nada'])), 'ROLE_UNKNOWN_PERMISSION');
  });
});
