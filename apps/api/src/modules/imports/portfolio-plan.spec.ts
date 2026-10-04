import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planPortfolioImport, type ExistingCredit, type PortfolioRow } from './portfolio-plan';

const row = (index: number, code: string, data: Record<string, unknown> = { clientLastName: 'PEREZ' }): PortfolioRow => ({ index, code, data });
/** Una operación externa ya importada. */
const op = (id: string, externalId: string | null, over: Partial<ExistingCredit> = {}): ExistingCredit => ({
  id,
  externalId,
  eligible: true,
  syncStatus: 'PRESENT',
  ...over,
});

describe('planPortfolioImport — la llave es el nº de operación (D1)', () => {
  it('actualiza las que vienen, crea las nuevas, marca ausentes las que faltan', () => {
    const plan = planPortfolioImport([row(0, 'OP-1'), row(1, 'OP-9')], [op('e1', 'OP-1'), op('e2', 'OP-2')]);
    assert.deepEqual(plan.toUpdate.map((u) => u.id), ['e1']);
    assert.deepEqual(plan.toCreate.map((r) => r.code), ['OP-9']);
    assert.deepEqual(plan.toMarkAbsent, ['e2']);
    assert.deepEqual(plan.toSetCurrent, ['e2']);
  });

  it('un crédito de Kobrax con el mismo código no bloquea: son dos créditos distintos', () => {
    // Los de Kobrax no llegan a `existing` (no tienen external_id): el match sólo ve operaciones externas.
    const plan = planPortfolioImport([row(0, 'CRD-0001')], []);
    assert.deepEqual(plan.toCreate.map((r) => r.code), ['CRD-0001']);
    assert.deepEqual(plan.invalid, []);
  });

  it('un campo obligatorio vacío frena la fila entera (MISSING_<CAMPO>)', () => {
    const plan = planPortfolioImport([row(0, 'OP-1', { clientLastName: 'X', outstandingBalance: null })], [], { required: ['outstandingBalance'] });
    assert.deepEqual(plan.invalid, [{ index: 0, reason: 'MISSING_OUTSTANDINGBALANCE' }]);
    assert.equal(plan.toCreate.length, 0);
  });

  it('«Cliente» obligatorio se cumple con el nombre partido en apellido/nombre', () => {
    const plan = planPortfolioImport([row(0, 'OP-1', { clientLastName: 'Miriam Cruz Apaza' }), row(1, 'OP-2', { clientLastName: null })], [], {
      required: ['clientName'],
    });
    assert.deepEqual(plan.toCreate.map((r) => r.code), ['OP-1']);
    assert.deepEqual(plan.invalid, [{ index: 1, reason: 'MISSING_CLIENTNAME' }]);
  });

  it('cero es un valor válido: no confundir "sin mora" con "sin dato"', () => {
    const plan = planPortfolioImport([row(0, 'OP-1', { clientLastName: 'X', daysPastDue: 0 })], [], { required: ['daysPastDue'] });
    assert.equal(plan.toCreate.length, 1);
  });

  it('nº repetido en el archivo → la 2ª es DUP_IN_FILE', () => {
    const plan = planPortfolioImport([row(0, 'OP-1'), row(1, 'OP-1')], []);
    assert.deepEqual(plan.invalid, [{ index: 1, reason: 'DUP_IN_FILE' }]);
  });

  it('fila con nombre y sin nº → NO_CODE (no se crea a ciegas)', () => {
    const plan = planPortfolioImport([row(0, '')], []);
    assert.deepEqual(plan.invalid, [{ index: 0, reason: 'NO_CODE' }]);
  });

  it('lo que no es un registro se ignora: pie vacío, "TOTALES", notas debajo de la tabla', () => {
    const plan = planPortfolioImport(
      [row(0, '', {}), row(1, 'TOTALES', { clientLastName: '13 operaciones' }), row(2, 'Corte anterior: 28/09/2026 con 10 operaciones')],
      [],
    );
    assert.equal(plan.ignored, 3);
    assert.deepEqual(plan.invalid, []);
    assert.equal(plan.toCreate.length, 0);
  });

  it('NUNCA borra: el ausente se marca, no existe toSoftDelete', () => {
    const plan = planPortfolioImport([], [op('e1', 'OP-1')]);
    assert.ok(!('toSoftDelete' in plan));
    assert.deepEqual(plan.toMarkAbsent, ['e1']);
  });
});

describe('planPortfolioImport — ausencia y reaparición (D4)', () => {
  it('la ausencia se marca en la transición: el que ya estaba ausente no se vuelve a marcar', () => {
    const plan = planPortfolioImport([], [op('e1', 'OP-1', { syncStatus: 'ABSENT' }), op('e2', 'OP-2')]);
    assert.deepEqual(plan.toMarkAbsent, ['e2']);
  });

  it('cerrado (PAID/CANCELLED) ausente: se registra la ausencia pero su mora y estado no se tocan', () => {
    const plan = planPortfolioImport([], [op('e1', 'OP-1', { closed: true }), op('e2', 'OP-2')]);
    assert.deepEqual(plan.toMarkAbsent, ['e1', 'e2']);
    assert.deepEqual(plan.toSetCurrent, ['e2']);
  });

  it("absentRule 'no-touch': la ausencia igual se registra, la mora no se toca", () => {
    const plan = planPortfolioImport([], [op('e1', 'OP-1')], { absentRule: 'no-touch' });
    assert.deepEqual(plan.toMarkAbsent, ['e1']);
    assert.deepEqual(plan.toSetCurrent, []);
  });

  it('el que faltaba y vuelve a venir REAPARECE: se actualiza el mismo, no se crea otro', () => {
    const plan = planPortfolioImport([row(0, 'OP-1')], [op('e1', 'OP-1', { syncStatus: 'ABSENT' })]);
    assert.deepEqual(plan.toUpdate, [{ id: 'e1', row: row(0, 'OP-1'), reappeared: true }]);
    assert.equal(plan.toCreate.length, 0);
    assert.deepEqual(plan.toMarkAbsent, []);
  });

  it('cerrado que vuelve a venir en el archivo → se actualiza (la fuente manda)', () => {
    const plan = planPortfolioImport([row(0, 'OP-1')], [op('e1', 'OP-1', { closed: true })]);
    assert.deepEqual(plan.toUpdate.map((u) => u.id), ['e1']);
  });
});

describe('planPortfolioImport — alcance (D8)', () => {
  it('existe fuera del alcance o borrada (no elegible) → MATCHES_OUT_OF_SCOPE, NO crea', () => {
    const plan = planPortfolioImport([row(0, 'OP-1')], [op('e1', 'OP-1', { eligible: false })]);
    assert.deepEqual(plan.invalid, [{ index: 0, reason: 'MATCHES_OUT_OF_SCOPE' }]);
    assert.equal(plan.toCreate.length, 0);
  });

  it('las de otro asesor/alcance que faltan NO quedan ausentes', () => {
    const plan = planPortfolioImport([], [op('e1', 'OP-1', { eligible: false })]);
    assert.deepEqual(plan.toMarkAbsent, []);
    assert.deepEqual(plan.toSetCurrent, []);
  });
});
