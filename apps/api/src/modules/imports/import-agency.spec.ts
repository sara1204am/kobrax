import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertImportAgency } from './import-agency';

function fake() {
  const calls = { assignable: [] as { users: string[]; credits?: string[] }[], inAgency: [] as string[][] };
  const assignment = {
    assertAssignable: async (_tx: unknown, users: (string | null)[], credits?: string[]) => void calls.assignable.push({ users: users as string[], credits }),
    assertAssigneesInAgency: async (_tx: unknown, users: string[]) => void calls.inAgency.push(users),
  };
  return { assignment: assignment as never, calls };
}

describe('assertImportAgency (el supervisor reparte sólo en su agencia al importar)', () => {
  it('quien no reparte (cobrador que importa lo suyo) no pasa por el chequeo', async () => {
    const { assignment, calls } = fake();
    await assertImportAgency(assignment, {} as never, { canAssign: false, createAssignees: ['me'], reassign: [{ creditId: 'c1', to: 'me' }] });
    assert.deepEqual(calls, { assignable: [], inAgency: [] });
  });

  it('reasignaciones de existentes: assertAssignable con los destinatarios y los ids de crédito', async () => {
    const { assignment, calls } = fake();
    await assertImportAgency(assignment, {} as never, { canAssign: true, createAssignees: [], reassign: [{ creditId: 'c1', to: 'juan' }, { creditId: 'c2', to: 'ana' }] });
    assert.deepEqual(calls.assignable, [{ users: ['juan', 'ana'], credits: ['c1', 'c2'] }]);
  });

  it('créditos nuevos: se verifica la agencia de los destinatarios', async () => {
    const { assignment, calls } = fake();
    await assertImportAgency(assignment, {} as never, { canAssign: true, createAssignees: ['juan', 'juan', 'ana'], reassign: [] });
    assert.deepEqual(calls.inAgency, [['juan', 'juan', 'ana']]);
    assert.equal(calls.assignable.length, 0);
  });

  it('propaga el 403 ASSIGNMENT_OUT_OF_AGENCY para que la transacción de la corrida se deshaga', async () => {
    const { assignment } = fake();
    const boom = { response: { code: 'ASSIGNMENT_OUT_OF_AGENCY' } };
    (assignment as unknown as { assertAssigneesInAgency: () => Promise<never> }).assertAssigneesInAgency = async () => Promise.reject(boom);
    await assert.rejects(assertImportAgency(assignment, {} as never, { canAssign: true, createAssignees: ['maria'], reassign: [] }), (e) => e === boom);
  });
});
