import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOtherCredits } from './other-credits';

const names = new Map([
  ['u1', 'Zoila Vargas'],
  ['u2', 'Ana Rojas'],
]);

describe('summarizeOtherCredits (F14 · F2, D-6)', () => {
  it('sin créditos escondidos no hay aviso', () => {
    assert.equal(summarizeOtherCredits([], names), null);
  });

  it('cuenta, suma el saldo (a 2 decimales) y lista a los responsables sin repetir, por nombre', () => {
    const r = summarizeOtherCredits(
      [
        { outstandingBalance: 100.1, responsibleIds: ['u1'] },
        { outstandingBalance: 200.2, responsibleIds: ['u1', 'u2'] },
      ],
      names,
    );
    assert.deepEqual(r, {
      count: 2,
      totalOutstanding: 300.3,
      responsibles: [
        { userId: 'u2', name: 'Ana Rojas' },
        { userId: 'u1', name: 'Zoila Vargas' },
      ],
    });
  });

  it('un responsable sin nombre conocido no filtra su id como nombre', () => {
    const r = summarizeOtherCredits([{ outstandingBalance: 5, responsibleIds: ['u9'] }], names);
    assert.deepEqual(r?.responsibles, [{ userId: 'u9', name: 'Alguien del equipo' }]);
  });

  it('🔴 sólo agregados: el resultado nunca trae detalle del crédito ajeno', () => {
    const r = summarizeOtherCredits([{ outstandingBalance: 5, responsibleIds: [] }], names);
    assert.deepEqual(Object.keys(r!).sort(), ['count', 'responsibles', 'totalOutstanding']);
    assert.deepEqual(r!.responsibles, []);
  });
});
