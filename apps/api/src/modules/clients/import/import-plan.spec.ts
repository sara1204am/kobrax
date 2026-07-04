import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planImport, type ExistingRef, type ImportRow } from './import-plan';

const row = (index: number, documentHash: string | null): ImportRow => ({ index, documentHash, data: {} });
const existing: ExistingRef[] = [
  { id: 'e1', nationalIdHash: 'h1' },
  { id: 'e2', nationalIdHash: 'h2' },
];

describe('planImport — RECONCILE', () => {
  it('actualiza los que siguen, crea los nuevos, da de baja los ausentes', () => {
    const plan = planImport([row(0, 'h1'), row(1, 'h3')], existing, {
      mode: 'RECONCILE',
      activeObligationIds: new Set(),
    });
    assert.deepEqual(plan.toUpdate.map((u) => u.id), ['e1']);
    assert.deepEqual(plan.toCreate.map((r) => r.documentHash), ['h3']);
    assert.deepEqual(plan.toSoftDelete, ['e2']); // ausente del archivo
    assert.deepEqual(plan.needsReview, []);
  });

  it('NO da de baja a un ausente con obligaciones activas → needsReview', () => {
    const plan = planImport([row(0, 'h1')], existing, {
      mode: 'RECONCILE',
      activeObligationIds: new Set(['e2']),
    });
    assert.deepEqual(plan.needsReview, ['e2']);
    assert.deepEqual(plan.toSoftDelete, []);
  });

  it('existente sin documento (hash null) nunca se da de baja', () => {
    const plan = planImport([], [{ id: 'x', nationalIdHash: null }], {
      mode: 'RECONCILE',
      activeObligationIds: new Set(),
    });
    assert.deepEqual(plan.toSoftDelete, []);
    assert.deepEqual(plan.needsReview, []);
  });
});

describe('planImport — UPSERT_ONLY', () => {
  it('actualiza/crea pero nunca da de baja', () => {
    const plan = planImport([row(0, 'h1'), row(1, 'h3')], existing, {
      mode: 'UPSERT_ONLY',
      activeObligationIds: new Set(),
    });
    assert.deepEqual(plan.toUpdate.map((u) => u.id), ['e1']);
    assert.deepEqual(plan.toCreate.map((r) => r.documentHash), ['h3']);
    assert.deepEqual(plan.toSoftDelete, []);
    assert.deepEqual(plan.needsReview, []);
  });
});

describe('planImport — casos de fila', () => {
  it('documento repetido dentro del archivo → la 2ª es inválida (DUP_IN_FILE)', () => {
    const plan = planImport([row(0, 'h1'), row(1, 'h1')], [], {
      mode: 'RECONCILE',
      activeObligationIds: new Set(),
    });
    assert.equal(plan.toCreate.length, 1);
    assert.deepEqual(plan.invalid, [{ index: 1, reason: 'DUP_IN_FILE' }]);
  });

  it('fila sin documento → siempre se crea', () => {
    const plan = planImport([row(0, null)], existing, {
      mode: 'UPSERT_ONLY',
      activeObligationIds: new Set(),
    });
    assert.equal(plan.toCreate.length, 1);
  });
});
