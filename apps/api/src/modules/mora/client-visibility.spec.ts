import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visibleClientIdsSql, type MoraScope } from './mora-query';

/** F14 · F1 (N-12 interino): un cliente sin crédito vivo ya no es visible para toda la cuenta. */
const base = { accountId: 'acc', userId: 'u1', ownOnly: false, canAssign: true };
const sqlOf = (s: MoraScope) => {
  const q = visibleClientIdsSql(s);
  return { text: q.sql.replace(/\s+/g, ' '), values: q.values };
};

describe('visibleClientIdsSql — clientes sin crédito vivo (F14 · F1)', () => {
  it('ALL y SUBTREE siguen viendo a los clientes sin crédito (sin condición extra)', () => {
    for (const kind of ['ALL', 'SUBTREE'] as const) {
      const { text } = sqlOf({ ...base, kind });
      assert.match(text, /AND TRUE AND NOT EXISTS/);
      assert.doesNotMatch(text, /created_by/);
    }
  });

  it('BRANCH y OWN sólo ven al cliente sin crédito que ellos dieron de alta', () => {
    for (const kind of ['BRANCH', 'OWN'] as const) {
      const { text, values } = sqlOf({ ...base, kind, ownOnly: kind === 'OWN' });
      assert.match(text, /c0\.created_by = \? AND NOT EXISTS/);
      assert.ok(values.includes('u1'));
    }
  });

  it('sin usuario en el contexto falla cerrado: nadie ve clientes huérfanos', () => {
    const { text } = sqlOf({ ...base, kind: 'OWN', userId: undefined, ownOnly: true });
    assert.match(text, /AND FALSE AND NOT EXISTS/);
  });

  it('no abre clientes de otra cuenta: siempre filtra por account_id', () => {
    const { text, values } = sqlOf({ ...base, kind: 'ALL' });
    assert.match(text, /c0\.account_id = \?/);
    assert.ok(values.includes('acc'));
  });
});
