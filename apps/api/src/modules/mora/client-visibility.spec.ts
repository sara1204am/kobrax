import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visibleClientIdsSql, type MoraScope } from './mora-query';

/**
 * F14 · F2 (H-7): el cliente no tiene dueño; se ve por sus créditos visibles, por la oficina donde se registró
 * (`registered_branch_id`) o, sin crédito vivo, por quien lo dio de alta (`created_by`).
 */
const base = { accountId: 'acc', userId: 'u1', ownOnly: false, canAssign: true };
const sqlOf = (s: MoraScope) => {
  const q = visibleClientIdsSql(s);
  return { text: q.sql.replace(/\s+/g, ' '), values: q.values };
};
const NO_LIVE_CREDIT = /NOT EXISTS \(SELECT 1 FROM credits cx WHERE cx\.client_id = c0\.id AND cx\.deleted_at IS NULL\)/;

describe('visibleClientIdsSql — visibilidad derivada (F14 · F2)', () => {
  it('siempre incluye a los clientes con algún crédito visible', () => {
    for (const kind of ['ALL', 'SUBTREE', 'BRANCH', 'OWN'] as const) {
      const { text } = sqlOf({ ...base, kind, ownOnly: kind === 'OWN' });
      assert.match(text, /SELECT cr\.client_id FROM credits cr WHERE/);
    }
  });

  it('ALL ve además a los clientes sin crédito vivo, sin mirar oficina ni creador', () => {
    const { text } = sqlOf({ ...base, kind: 'ALL' });
    assert.match(text, NO_LIVE_CREDIT);
    assert.doesNotMatch(text, /created_by|registered_branch_id/);
  });

  it('SUBTREE ve por oficina de registro en su subárbol, la raíz sin oficina y lo que él creó sin crédito', () => {
    const { text, values } = sqlOf({ ...base, kind: 'SUBTREE' });
    assert.match(text, /c0\.registered_branch_id/);
    assert.match(text, /c0\.created_by = \? AND NOT EXISTS/);
    assert.match(text, /rb\.is_root = true/);
    assert.ok(values.includes('u1'));
  });

  it('BRANCH ve por oficina de registro en su subárbol, pero NO el cliente sin oficina (eso es de la raíz)', () => {
    const { text } = sqlOf({ ...base, kind: 'BRANCH' });
    assert.match(text, /c0\.registered_branch_id/);
    assert.doesNotMatch(text, /rb\.is_root = true/);
  });

  it('🔴 OWN (cobrador) sólo ve al cliente sin crédito vivo que él creó: sin oficina de registro', () => {
    const { text, values } = sqlOf({ ...base, kind: 'OWN', ownOnly: true });
    assert.match(text, /c0\.created_by = \? AND NOT EXISTS/);
    assert.doesNotMatch(text, /registered_branch_id/);
    assert.ok(values.includes('u1'));
  });

  it('sin usuario en el contexto falla cerrado: nadie ve clientes por oficina ni por creador', () => {
    const { text } = sqlOf({ ...base, kind: 'SUBTREE', userId: undefined });
    assert.match(text, /AND \(FALSE\)/);
    assert.doesNotMatch(text, /created_by|registered_branch_id/);
  });

  it('🔴 sin accesos residuales: no consulta ninguna tabla de accesos del cliente, sólo créditos vigentes y la oficina', () => {
    const { text } = sqlOf({ ...base, kind: 'OWN', ownOnly: true });
    assert.doesNotMatch(text, /client_access|client_owners|client_assignments/);
  });

  it('no abre clientes de otra cuenta: siempre filtra por account_id', () => {
    const { text, values } = sqlOf({ ...base, kind: 'ALL' });
    assert.match(text, /c0\.account_id = \?/);
    assert.ok(values.includes('acc'));
  });
});
