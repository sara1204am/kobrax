import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NormalizedRecord } from './field-catalog';
import { creditCreateData, creditUpdateData } from './portfolio-credit';
import { serializeCredit } from '../credits/credits.serializer';

const ROW: NormalizedRecord = {
  code: 'C-1',
  clientLastName: 'PEREZ',
  clientFirstName: null,
  coHolder: null,
  phone: null,
  address: null,
  addressRef: null,
  status: 'VIGENTE',
  currency: 'BOLIVIANOS',
  branchLabel: null,
  principalAmount: null,
  outstandingBalance: 800,
  interestRate: null,
  installmentAmount: 150,
  pastDueAmount: 0,
  daysPastDue: 0,
  disbursedAt: null,
  nextDueDate: '2026-10-05',
};
const STAMP = { runId: 'run-1', at: '2026-09-25T12:00:00.000Z' };
const SCOPE = { kind: 'account' as const, ref: null };

/**
 * 🔴 F4/06 · Fase 4 — desconocido no es cero (D9). El importador marca lo que el archivo no trajo y
 * guarda la cuota y la próxima fecha, que antes se leían y se descartaban.
 */
describe('creditCreateData — alta desde el archivo', () => {
  it('guarda cuota, próxima fecha y la corrida; marca lo que no vino', () => {
    const data = creditCreateData('acc', 'cli', ROW, SCOPE as never, STAMP);
    const meta = data.metadata as Record<string, unknown>;
    assert.equal(meta.installmentAmount, 150);
    assert.equal(meta.nextDueDate, '2026-10-05');
    assert.equal(meta.importRunId, 'run-1');
    assert.equal(meta.importedAt, STAMP.at);
    assert.deepEqual(meta.importMissing, ['principalAmount', 'interestRate', 'installmentsCount', 'frequency', 'disbursedAt']);
    // El 0 de la columna NOT NULL es relleno: la lista de arriba dice que no significa nada.
    assert.equal(data.principalAmount, 0);
  });
});

describe('creditUpdateData — actualización desde el archivo', () => {
  it('lo que llega deja de faltar y se escribe; lo que no llega no se toca', () => {
    const prev = { origin: 'import', installmentAmount: 140, importMissing: ['principalAmount', 'interestRate', 'installmentsCount', 'frequency'] };
    const data = creditUpdateData({ ...ROW, principalAmount: 1000, installmentAmount: null, nextDueDate: null }, prev, STAMP);
    assert.equal(data.principalAmount, 1000);
    assert.equal(data.interestRate, undefined);
    const meta = data.metadata as Record<string, unknown>;
    assert.equal(meta.installmentAmount, 140); // el archivo no la trajo: queda la anterior
    assert.deepEqual(meta.importMissing, ['interestRate', 'installmentsCount', 'frequency']);
    assert.equal(meta.importRunId, 'run-1');
  });

  it('importado antes de la Fase 4 (sin lista): falta lo que este archivo tampoco trae', () => {
    const meta = creditUpdateData(ROW, { origin: 'import' }, STAMP).metadata as Record<string, unknown>;
    assert.deepEqual(meta.importMissing, ['principalAmount', 'interestRate', 'installmentsCount', 'frequency', 'disbursedAt']);
  });
});

describe('serializeCredit — importado con datos desconocidos', () => {
  it('expone unknownFields y no inventa frecuencia ni nº de cuotas', () => {
    const credit = {
      id: 'cr1',
      code: 'C-1',
      typeCode: null,
      clientId: 'cli',
      branchId: null,
      principalAmount: 0,
      outstandingBalance: 800,
      interestRate: 0,
      currency: 'BOB',
      installmentsCount: 0,
      status: 'ACTIVE',
      daysPastDue: 0,
      assignedManagerId: null,
      disbursedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { origin: 'import', installmentAmount: 150, importMissing: ['principalAmount', 'installmentsCount', 'frequency'], importedAt: STAMP.at },
    };
    const s = serializeCredit(credit as never);
    assert.deepEqual(s.unknownFields, ['principalAmount', 'installmentsCount', 'frequency']);
    assert.equal(s.frequency, undefined);
    assert.equal(s.installmentsCount, undefined);
    assert.equal(s.installmentAmount, 150);
    assert.equal(s.importedAt, STAMP.at);
    assert.equal(s.locked, true);
    assert.equal(s.totalToCollect, null);
  });

  /** 🔴 La columna nace en 1 (default) y el importador no la escribe: el total salía = una cuota. */
  it('importado anterior a la Fase 4: el nº de cuotas por default no inventa un total', () => {
    const s = serializeCredit({
      id: 'cr2',
      code: 'C-2',
      clientId: 'cli',
      principalAmount: 1000,
      outstandingBalance: 650,
      interestRate: 0,
      currency: 'BOB',
      installmentsCount: 1,
      status: 'ACTIVE',
      daysPastDue: 0,
      metadata: { origin: 'import', installmentAmount: 150 },
    } as never);
    assert.equal(s.installmentsCount, undefined);
    assert.equal(s.totalToCollect, null);
    assert.equal(s.frequency, undefined); // no «Mensual» por default
  });

  it('importado con cuota 0 de relleno: la cuota es desconocida, no Bs 0', () => {
    const s = serializeCredit({ id: 'cr3', principalAmount: 1, outstandingBalance: 1, interestRate: 0, currency: 'BOB', installmentsCount: 1, metadata: { origin: 'import', installmentAmount: 0 } } as never);
    assert.equal(s.installmentAmount, undefined);
  });
});
