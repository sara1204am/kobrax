import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { clientCreate, type ClientCreateFacts } from './client-create.policy';
import { actorWith, branch, codeOf } from './policy-test-utils';

const CREATE = [Permission.CLIENT_CREATE];
const REPARTE = [Permission.CLIENT_CREATE, Permission.ASSIGNMENT_WRITE];
const facts = (over: Partial<ClientCreateFacts> = {}): ClientCreateFacts => ({ soleLeaf: null, actorOffice: null, requested: null, actorOfficeFact: null, ...over });
const decide = (perms: string[], f: ClientCreateFacts, input: { branchId?: string | null } = {}) => clientCreate.decide(actorWith(perms), f, input);

describe('client.create (F14 · F2, H-7)', () => {
  it('sin client:create → CLIENT_CREATE_FORBIDDEN', () => {
    assert.equal(codeOf(decide([], facts({ soleLeaf: 'b1' }))), 'CLIENT_CREATE_FORBIDDEN');
  });

  it('cuenta de una sola oficina: registra ahí sin pedir nada (independiente/individual)', () => {
    assert.deepEqual(decide(CREATE, facts({ soleLeaf: 'b1' })), { allow: true, data: { registeredBranchId: 'b1' } });
  });

  it('cuenta con varias oficinas: usa la única oficina del actor', () => {
    const d = decide(CREATE, facts({ actorOffice: 'b2', actorOfficeFact: branch('b2') }));
    assert.deepEqual(d, { allow: true, data: { registeredBranchId: 'b2' } });
  });

  it('🔴 el actor sin oficina resuelta → CLIENT_BRANCH_UNRESOLVED (422)', () => {
    const d = decide(CREATE, facts());
    assert.equal(codeOf(d), 'CLIENT_BRANCH_UNRESOLVED');
    assert.equal((d as { status?: number }).status, 422);
  });

  it('🔴 nunca en la raíz de una cuenta con varias oficinas, ni por omisión ni a pedido', () => {
    assert.equal(codeOf(decide(CREATE, facts({ actorOffice: 'r', actorOfficeFact: branch('r', { isRoot: true }) }))), 'CLIENT_CREATE_AT_ROOT');
    assert.equal(codeOf(decide(REPARTE, facts({ requested: branch('r', { isRoot: true }) }), { branchId: 'r' })), 'CLIENT_CREATE_AT_ROOT');
  });

  it('quien reparte elige otra oficina dentro de su alcance', () => {
    const d = decide(REPARTE, facts({ actorOffice: 'b1', requested: branch('b2') }), { branchId: 'b2' });
    assert.deepEqual(d, { allow: true, data: { registeredBranchId: 'b2' } });
  });

  it('🔴 quien NO reparte (cobrador) sólo registra en su propia oficina', () => {
    assert.equal(codeOf(decide(CREATE, facts({ actorOffice: 'b1', requested: branch('b2') }), { branchId: 'b2' })), 'CLIENT_BRANCH_OUT_OF_SCOPE');
    assert.equal(decide(CREATE, facts({ actorOffice: 'b1', requested: branch('b1') }), { branchId: 'b1' }).allow, true);
  });

  it('🔴 oficina fuera del alcance, inexistente o inactiva se niega', () => {
    assert.equal(codeOf(decide(REPARTE, facts({ requested: branch('x', { inScope: false }) }), { branchId: 'x' })), 'CLIENT_BRANCH_OUT_OF_SCOPE');
    assert.equal(codeOf(decide(REPARTE, facts({ requested: null }), { branchId: 'x' })), 'CLIENT_BRANCH_INVALID');
    assert.equal(codeOf(decide(REPARTE, facts({ requested: branch('x', { active: false }) }), { branchId: 'x' })), 'CLIENT_BRANCH_INVALID');
  });
});
