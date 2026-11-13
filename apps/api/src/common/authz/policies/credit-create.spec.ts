import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { creditCreate } from './credit-create.policy';
import { actorWith, codeOf } from './policy-test-utils';

const decide = (perms: string[], input: { assignedManagerId?: string | null } = {}) => creditCreate.decide(actorWith(perms, 'me'), undefined, input);

describe('credit.create (F14 · F2, H-7)', () => {
  it('sin credit:create → CREDIT_CREATE_FORBIDDEN (credit:write ya no alcanza)', () => {
    assert.equal(codeOf(decide([])), 'CREDIT_CREATE_FORBIDDEN');
    assert.equal(codeOf(decide([Permission.CREDIT_WRITE])), 'CREDIT_CREATE_FORBIDDEN');
  });

  it('quien no reparte (cobrador) queda como responsable de lo que crea', () => {
    assert.deepEqual(decide([Permission.CREDIT_CREATE]), { allow: true, data: { responsibleId: 'me', needsAssign: false } });
  });

  it('quien reparte y no elige lo deja sin responsable (lo reparte después)', () => {
    assert.deepEqual(decide([Permission.CREDIT_CREATE, Permission.ASSIGNMENT_WRITE]), { allow: true, data: { responsibleId: undefined, needsAssign: false } });
  });

  it('elegirse a sí mismo no cuenta como asignar', () => {
    assert.deepEqual(decide([Permission.CREDIT_CREATE], { assignedManagerId: 'me' }), { allow: true, data: { responsibleId: 'me', needsAssign: false } });
  });

  it('elegir a OTRA persona exige assignment:write', () => {
    assert.equal(codeOf(decide([Permission.CREDIT_CREATE], { assignedManagerId: 'otra' })), 'ASSIGNMENT_FORBIDDEN');
    assert.deepEqual(decide([Permission.CREDIT_CREATE, Permission.ASSIGNMENT_WRITE], { assignedManagerId: 'otra' }), {
      allow: true,
      data: { responsibleId: 'otra', needsAssign: true },
    });
  });
});
