import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { memberInvite, type MemberInviteFacts } from './member-invite.policy';
import { actorWith, branch, codeOf, member } from './policy-test-utils';

const INVITE = [Permission.USER_INVITE];
const MGR = member('me', 'MANAGER', 70, ['/r/']);
const COLLECTOR = { name: 'COLLECTOR', level: 30 };
const facts = (over: Partial<MemberInviteFacts> = {}): MemberInviteFacts => ({ actor: MGR, role: COLLECTOR, seesAll: false, branch: branch('a'), ...over });
const decide = (f: MemberInviteFacts, input: { roleId: string; branchId?: string | null } = { roleId: 'r', branchId: 'a' }, perms = INVITE) =>
  memberInvite.decide(actorWith(perms), f, input);

describe('member.invite (F14 · F2, H-3/H-13)', () => {
  it('sin user:invite → MEMBER_INVITE_FORBIDDEN', () => {
    assert.equal(codeOf(decide(facts(), undefined, [])), 'MEMBER_INVITE_FORBIDDEN');
  });

  it('el gerente invita a un rol de tier inferior en una oficina de su alcance', () => {
    assert.equal(decide(facts()).allow, true);
  });

  it('🔴 un gerente NO invita a otro gerente ni a un superior (tier igual o mayor)', () => {
    assert.equal(codeOf(decide(facts({ role: { name: 'MANAGER', level: 70 } }))), 'MEMBER_TIER_NOT_LOWER');
    assert.equal(codeOf(decide(facts({ role: { name: 'SOMETHING', level: 80 } }))), 'MEMBER_TIER_NOT_LOWER');
  });

  it('🔴 ACCOUNT_ADMIN y SUPER_ADMIN nunca se otorgan por invitación, ni siquiera quien está por encima', () => {
    const admin = member('me', 'ACCOUNT_ADMIN', 90, ['/r/']);
    assert.equal(codeOf(decide(facts({ actor: admin, role: { name: 'ACCOUNT_ADMIN', level: 90 }, seesAll: true }))), 'MEMBER_ROLE_RESERVED');
    assert.equal(codeOf(decide(facts({ actor: admin, role: { name: 'SUPER_ADMIN', level: 100 }, seesAll: true }))), 'MEMBER_ROLE_RESERVED');
  });

  it('rol inexistente → 422; actor sin membresía → sin permiso de nivel', () => {
    const d = decide(facts({ role: null }));
    assert.equal(codeOf(d), 'MEMBER_ROLE_INVALID');
    assert.equal((d as { status?: number }).status, 422);
    assert.equal(codeOf(decide(facts({ actor: null }))), 'MEMBER_TIER_NOT_LOWER');
  });

  it('🔴 la oficina destino tiene que estar dentro del alcance, y existir', () => {
    assert.equal(codeOf(decide(facts({ branch: branch('x', { inScope: false }) }))), 'MEMBER_OFFICE_OUT_OF_SCOPE');
    assert.equal(codeOf(decide(facts({ branch: null }))), 'MEMBER_OFFICE_INVALID');
  });

  it('sin oficina sólo invita quien ve toda la cuenta', () => {
    assert.equal(codeOf(decide(facts(), { roleId: 'r' })), 'MEMBER_OFFICE_REQUIRED');
    assert.equal(decide(facts({ seesAll: true }), { roleId: 'r' }).allow, true);
  });
});
