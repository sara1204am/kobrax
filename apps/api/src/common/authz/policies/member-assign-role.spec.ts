import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { memberAssignRole, type MemberAssignRoleFacts, type MemberAssignRoleInput } from './member-assign-role.policy';
import { actorWith, branch, codeOf, member } from './policy-test-utils';

const WRITE = [Permission.USER_WRITE];
const facts = (over: Partial<MemberAssignRoleFacts> = {}): MemberAssignRoleFacts => ({
  actor: member('me', 'MANAGER', 70, ['/r/']),
  target: member('t', 'COLLECTOR', 30, ['/r/a/']),
  newRole: null,
  seesAll: false,
  newBranch: null,
  ...over,
});
const decide = (f: MemberAssignRoleFacts, input: Partial<MemberAssignRoleInput> = {}, perms = WRITE) =>
  memberAssignRole.decide(actorWith(perms), f, { userId: 't', ...input });

describe('member.assignRole (F14 · F2, H-3/H-13)', () => {
  it('sin user:write → MEMBER_WRITE_FORBIDDEN', () => {
    assert.equal(codeOf(decide(facts(), {}, [])), 'MEMBER_WRITE_FORBIDDEN');
  });

  it('una persona que no existe en la cuenta → 404', () => {
    const d = decide(facts({ target: null }));
    assert.equal(codeOf(d), 'MEMBER_NOT_VISIBLE');
    assert.equal((d as { status?: number }).status, 404);
  });

  it('🔴 no edita a un par ni a un superior', () => {
    assert.equal(codeOf(decide(facts({ target: member('t', 'MANAGER', 70, ['/r/a/']) }))), 'MEMBER_TIER_NOT_LOWER');
    assert.equal(codeOf(decide(facts({ target: member('t', 'ACCOUNT_ADMIN', 90, ['/r/']) }))), 'MEMBER_TIER_NOT_LOWER');
  });

  it('asigna un rol de tier inferior al suyo', () => {
    assert.equal(decide(facts({ newRole: { name: 'SUPERVISOR', level: 50 } }), { roleId: 'x' }).allow, true);
  });

  it('🔴 no sube a nadie a un par ni otorga un rol reservado', () => {
    assert.equal(codeOf(decide(facts({ newRole: { name: 'MANAGER', level: 70 } }), { roleId: 'x' })), 'MEMBER_TIER_NOT_LOWER');
    assert.equal(
      codeOf(decide(facts({ actor: member('me', 'ACCOUNT_ADMIN', 90, ['/r/']), newRole: { name: 'ACCOUNT_ADMIN', level: 90 } }), { roleId: 'x' })),
      'MEMBER_ROLE_RESERVED',
    );
  });

  it('rol nuevo inexistente → 422', () => {
    assert.equal(codeOf(decide(facts({ newRole: null }), { roleId: 'x' })), 'MEMBER_ROLE_INVALID');
  });

  it('🔴 la oficina nueva tiene que caer en el alcance del actor', () => {
    assert.equal(decide(facts({ newBranch: branch('b') }), { branchId: 'b' }).allow, true);
    assert.equal(codeOf(decide(facts({ newBranch: branch('b', { inScope: false }) }), { branchId: 'b' })), 'MEMBER_OFFICE_OUT_OF_SCOPE');
    assert.equal(codeOf(decide(facts({ newBranch: null }), { branchId: 'b' })), 'MEMBER_OFFICE_INVALID');
  });

  it('quitar la oficina (null) sólo lo hace quien ve toda la cuenta', () => {
    assert.equal(codeOf(decide(facts(), { branchId: null })), 'MEMBER_OFFICE_REQUIRED');
    assert.equal(decide(facts({ seesAll: true }), { branchId: null }).allow, true);
  });
});
