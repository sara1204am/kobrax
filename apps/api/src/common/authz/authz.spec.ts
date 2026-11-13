import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { AuthorizationService } from './authorization.service';
import { PolicyService } from './policy.service';
import { allow, deny, type PolicyDefinition } from './authz.types';
import { POLICIES, POLICY_NAMES } from './policies';

const tenantWith = (perms: string[]) => ({ accountId: 'acc', userId: 'u1', permissions: perms, can: (p: string) => perms.includes(p) });
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return ((e as { getResponse?: () => { code?: string } }).getResponse?.() ?? {}).code;
  }
};

describe('AuthorizationService (F14 · F3)', () => {
  const svc = new AuthorizationService(tenantWith(['a:read', 'b:read']) as never);
  it('can / canAny / canAll', () => {
    assert.equal(svc.can('a:read'), true);
    assert.equal(svc.can('x:read'), false);
    assert.equal(svc.canAny('x:read', 'b:read'), true);
    assert.equal(svc.canAny('x:read', 'y:read'), false);
    assert.equal(svc.canAll('a:read', 'b:read'), true);
    assert.equal(svc.canAll('a:read', 'x:read'), false);
  });
  it('assert: 403 AUTH_002 si falta alguno', () => {
    assert.doesNotThrow(() => svc.assert('a:read'));
    assert.equal(codeOf(() => svc.assert('a:read', 'x:read')), 'AUTH_002');
  });
  it('política desconocida = error de programación (no se niega en silencio)', () => {
    assert.throws(() => svc.decide('no.existe'), /desconocida/);
  });
});

describe('credit.writeOff (política pura)', () => {
  const run = (perms: string[]) => new AuthorizationService(tenantWith(perms) as never).decide('credit.writeOff');
  it('gerente (subárbol) y administrador (todo) con credit:write → permitido', () => {
    assert.deepEqual(run([Permission.CREDIT_WRITE, Permission.DATA_SCOPE_SUBTREE]), { allow: true });
    assert.deepEqual(run([Permission.CREDIT_WRITE, Permission.DATA_SCOPE_ALL]), { allow: true });
  });
  it('🔴 supervisor (agencia), cobrador o sin credit:write → WRITE_OFF_FORBIDDEN', () => {
    for (const perms of [[Permission.CREDIT_WRITE, Permission.DATA_SCOPE_BRANCH], [Permission.DATA_SCOPE_ALL], [Permission.CREDIT_WRITE]]) {
      const d = run(perms);
      assert.equal(d.allow, false);
      assert.equal((d as { code: string }).code, 'WRITE_OFF_FORBIDDEN');
    }
  });
  it('assertPolicy lanza 403 con el código del dominio', () => {
    const svc = new AuthorizationService(tenantWith([Permission.DATA_SCOPE_BRANCH]) as never);
    assert.equal(codeOf(() => svc.assertPolicy('credit.writeOff')), 'WRITE_OFF_FORBIDDEN');
  });
  it('el registro no repite nombres', () => {
    assert.equal(new Set(POLICY_NAMES).size, POLICIES.length);
  });
});

describe('PolicyService: carga hechos y decide con una función pura', () => {
  it('pasa los hechos del FactsLoader a la decisión; sin hechos no toca el loader', async () => {
    let loaded = 0;
    const loader = { officePathsOf: async () => { loaded++; return ['/r/a/']; } };
    const def: PolicyDefinition<{ user: string }, string[]> = {
      name: 'test.sameOffice',
      loadFacts: (l, i) => (l as unknown as typeof loader).officePathsOf(i.user),
      decide: (_a, facts) => (facts.includes('/r/a/') ? allow() : deny('X', 'no')),
    };
    (POLICIES as unknown as PolicyDefinition<never, unknown>[]).push(def as never);
    try {
      const svc = new PolicyService(loader as never, tenantWith([]) as never);
      assert.deepEqual(await svc.check('test.sameOffice', { user: 'u2' }), { allow: true });
      assert.equal(loaded, 1);
      await svc.check('credit.writeOff');
      assert.equal(loaded, 1, 'una política sin hechos no consulta la DB');
      assert.equal(svc.has('test.sameOffice'), true);
    } finally {
      (POLICIES as unknown as PolicyDefinition[]).pop();
    }
  });
});

describe('AuthorizationService — lista vacía niega', () => {
  it('canAll() / assert() sin permisos no abren la puerta', () => {
    const svc = new AuthorizationService({ can: () => true } as never);
    assert.equal(svc.canAll(), false);
    assert.throws(() => svc.assert());
  });
});
