import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planPortfolioImport, type ExistingCredit, type PortfolioRow } from './portfolio-plan';

const row = (index: number, code: string): PortfolioRow => ({ index, code, data: {} });
const imp = (id: string, code: string | null, eligible = true): ExistingCredit => ({ id, code, origin: 'import', eligible });
const man = (id: string, code: string | null, eligible = true): ExistingCredit => ({ id, code, origin: 'manual', eligible });

describe('planPortfolioImport — premisa', () => {
  it('actualiza los del archivo, crea los nuevos, pone al día los ausentes', () => {
    const plan = planPortfolioImport([row(0, 'C1'), row(1, 'C9')], [imp('e1', 'C1'), imp('e2', 'C2')]);
    assert.deepEqual(
      plan.toUpdate.map((u) => u.id),
      ['e1'],
    );
    assert.deepEqual(
      plan.toCreate.map((r) => r.code),
      ['C9'],
    );
    assert.deepEqual(plan.toSetCurrent, ['e2']); // ausente → al día
  });

  it('NUNCA borra: el ausente va a toSetCurrent, no existe toSoftDelete', () => {
    const plan = planPortfolioImport([], [imp('e1', 'C1')]);
    assert.deepEqual(plan.toSetCurrent, ['e1']);
    assert.equal('toSoftDelete' in plan, false);
  });

  it('crédito manual ausente → intocable (no se pone al día)', () => {
    const plan = planPortfolioImport([], [man('m1', 'C1'), imp('e1', 'C2')]);
    assert.deepEqual(plan.toSetCurrent, ['e1']); // solo el de origin=import
  });

  it('code del archivo que choca con un manual → MATCHES_MANUAL (no dup, no toca manual)', () => {
    const plan = planPortfolioImport([row(0, 'C1')], [man('m1', 'C1')]);
    assert.deepEqual(plan.toCreate, []);
    assert.deepEqual(plan.toUpdate, []);
    assert.deepEqual(plan.invalid, [{ index: 0, reason: 'MATCHES_MANUAL' }]);
  });

  it('code repetido en el archivo → la 2ª es DUP_IN_FILE (idempotencia intra-archivo)', () => {
    const plan = planPortfolioImport([row(0, 'C1'), row(1, 'C1')], []);
    assert.equal(plan.toCreate.length, 1);
    assert.deepEqual(plan.invalid, [{ index: 1, reason: 'DUP_IN_FILE' }]);
  });

  it('fila sin code → NO_CODE inválida (no se crea a ciegas)', () => {
    const plan = planPortfolioImport([row(0, '')], []);
    assert.deepEqual(plan.invalid, [{ index: 0, reason: 'NO_CODE' }]);
    assert.deepEqual(plan.toCreate, []);
  });

  it("absentRule 'no-touch' → no pone al día a nadie", () => {
    const plan = planPortfolioImport([], [imp('e1', 'C1')], { absentRule: 'no-touch' });
    assert.deepEqual(plan.toSetCurrent, []);
  });
});

describe('planPortfolioImport — unique account-wide (fix P2002)', () => {
  it('code de import fuera de alcance o borrado (no elegible) → MATCHES_OUT_OF_SCOPE, NO crea', () => {
    // Sin este chequeo iría a toCreate y credit.create estallaría con P2002 (el @@unique es account-wide).
    const plan = planPortfolioImport([row(0, 'C1')], [imp('e1', 'C1', /* eligible */ false)]);
    assert.deepEqual(plan.toCreate, []);
    assert.deepEqual(plan.toUpdate, []);
    assert.deepEqual(plan.invalid, [{ index: 0, reason: 'MATCHES_OUT_OF_SCOPE' }]);
  });

  it('import no elegible ausente del archivo → NO se pone al día (fuera de alcance)', () => {
    const plan = planPortfolioImport([], [imp('e1', 'C1', false)]);
    assert.deepEqual(plan.toSetCurrent, []);
  });
});
