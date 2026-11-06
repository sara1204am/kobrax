import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { creditAssign, type CreditAssignFacts } from './credit-assign.policy';
import { actorWith, codeOf, member } from './policy-test-utils';

// Niveles de la plataforma: COLLECTOR 30 < SUPERVISOR 50 < MANAGER 70 < ACCOUNT_ADMIN 90.
const SUP = (id: string, paths: string[]) => member(id, 'SUPERVISOR', 50, paths);
const COB = (id: string, paths: string[]) => member(id, 'COLLECTOR', 30, paths);
const MGR = (id: string, paths: string[]) => member(id, 'MANAGER', 70, paths);
const decide = (facts: CreditAssignFacts, targetIds: string[]) => creditAssign.decide(actorWith([], 'me'), facts, { targetIds });

describe('credit.assign (F14 · F2, R-13/H-8)', () => {
  it('asignarse a uno mismo o no asignar a nadie siempre pasa', () => {
    assert.equal(decide({ actor: null, targets: [] }, ['me']).allow, true);
    assert.equal(decide({ actor: null, targets: [] }, []).allow, true);
  });

  it('el actor tiene que existir en la cuenta', () => {
    assert.equal(codeOf(decide({ actor: null, targets: [COB('c1', ['/r/a/'])] }, ['c1'])), 'CREDIT_ASSIGN_FORBIDDEN');
  });

  it('el supervisor asigna a un cobrador (tier menor)', () => {
    assert.equal(decide({ actor: SUP('me', ['/r/a/']), targets: [COB('c1', ['/r/a/'])] }, ['c1']).allow, true);
  });

  it('🔴 un supervisor NO asigna a otro supervisor de su misma oficina (par)', () => {
    assert.equal(codeOf(decide({ actor: SUP('me', ['/r/a/']), targets: [SUP('s2', ['/r/a/'])] }, ['s2'])), 'CREDIT_ASSIGN_TIER');
  });

  it('el par sí es asignable si TODAS sus oficinas cuelgan estrictamente de las del actor (oficina hija)', () => {
    assert.equal(decide({ actor: SUP('me', ['/r/a/']), targets: [SUP('s2', ['/r/a/b/'])] }, ['s2']).allow, true);
    assert.equal(codeOf(decide({ actor: SUP('me', ['/r/a/']), targets: [SUP('s2', ['/r/a/b/', '/r/z/'])] }, ['s2'])), 'CREDIT_ASSIGN_TIER');
  });

  it('🔴 un par sin oficina vigente no cuelga de nadie', () => {
    assert.equal(codeOf(decide({ actor: SUP('me', ['/r/a/']), targets: [SUP('s2', [])] }, ['s2'])), 'CREDIT_ASSIGN_TIER');
  });

  it('🔴 nadie asigna hacia arriba: un supervisor no asigna a un gerente', () => {
    assert.equal(codeOf(decide({ actor: SUP('me', ['/r/a/']), targets: [MGR('g', ['/r/a/b/'])] }, ['g'])), 'CREDIT_ASSIGN_TIER');
  });

  it('el gerente asigna a un supervisor o a otro gerente de oficina hija', () => {
    assert.equal(decide({ actor: MGR('me', ['/r/']), targets: [SUP('s', ['/r/a/'])] }, ['s']).allow, true);
    assert.equal(decide({ actor: MGR('me', ['/r/']), targets: [MGR('g2', ['/r/a/'])] }, ['g2']).allow, true);
  });

  it('🔴 un destino inexistente o inactivo se niega aunque el resto sea válido (todo o nada)', () => {
    const facts = { actor: SUP('me', ['/r/a/']), targets: [COB('c1', ['/r/a/']), { ...COB('c2', ['/r/a/']), active: false }] };
    assert.equal(codeOf(decide(facts, ['c1', 'c2'])), 'CREDIT_ASSIGN_TIER');
    assert.equal(codeOf(decide(facts, ['c1', 'fantasma'])), 'CREDIT_ASSIGN_TIER');
  });
});
