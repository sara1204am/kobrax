import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NormalizedRecord } from './field-catalog';
import { creditCreateData, creditUpdateData, isWrittenOffLabel, mapStatus, storedStatus } from './portfolio-credit';
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

// D1: la identidad de la operación es (fuente, nº de operación); `code` queda como rótulo.
describe('identidad y sincronización de la operación externa', () => {
  it('el alta guarda origen, fuente, nº de operación y que vino en esta corrida', () => {
    const data = creditCreateData('acc', 'cli', ROW, SCOPE as never, STAMP);
    assert.equal(data.origin, 'IMPORT');
    assert.equal(data.externalSource, 'PSF');
    assert.equal(data.externalId, 'C-1');
    assert.equal(data.code, 'C-1');
    assert.equal(data.syncStatus, 'PRESENT');
    assert.equal(data.lastSeenRunId, 'run-1');
  });

  it('volver a venir en el reporte lo deja presente y borra la ausencia (reaparición, D4)', () => {
    const data = creditUpdateData(ROW, { origin: 'import' }, STAMP);
    assert.equal(data.syncStatus, 'PRESENT');
    assert.equal(data.absentSince, null);
    assert.equal(data.lastSeenRunId, 'run-1');
  });
});

describe('creditUpdateData — actualización desde el archivo', () => {
  /*
   * 🔴 La regla de oro de la importación: el reporte trae saldo y mora, nunca a quién le toca
   * cobrar. Que aparezca de nuevo en un reporte no le cambia el responsable ni la agencia; eso sólo
   * se hace con una reasignación explícita por `AssignmentService`.
   */
  it('nunca escribe el responsable ni la agencia de un crédito existente', () => {
    const data = creditUpdateData({ ...ROW, principalAmount: 1000 }, { origin: 'import' }, STAMP, { advisorCode: 'CQE' });
    assert.equal('assignedManagerId' in data, false);
    assert.equal('branchId' in data, false);
  });

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

/**
 * F4/08 · D1-a — el CASTIGADO del reporte marca `written_off_at` y deja el estado en ACTIVE: los días de mora
 * siguen corriendo y el job lo procesa como a cualquier otro. `WRITTEN_OFF` ya no se escribe como estado.
 */
describe('CASTIGADO del reporte PSF (D1-a)', () => {
  const CASTIGADO: NormalizedRecord = { ...ROW, status: 'CASTIGADO', daysPastDue: 240 };

  it('el mapa sigue reconociendo la etiqueta, pero lo que se guarda es ACTIVE', () => {
    assert.equal(mapStatus('CASTIGADO'), 'WRITTEN_OFF');
    assert.equal(isWrittenOffLabel('Castigado'), true);
    assert.equal(storedStatus('CASTIGADO'), 'ACTIVE');
    assert.equal(isWrittenOffLabel('VIGENTE'), false);
    assert.equal(isWrittenOffLabel(null), false);
    assert.equal(storedStatus('VENCIDO'), 'DEFAULTED', 'el resto del mapa no cambia');
  });

  it('alta: written_off_at puesto, estado ACTIVE y los días de mora del reporte', () => {
    const data = creditCreateData('acc', 'cli', CASTIGADO, SCOPE as never, STAMP);
    assert.equal(data.status, 'ACTIVE');
    assert.deepEqual(data.writtenOffAt, new Date(STAMP.at));
    assert.equal(data.writtenOffBy, null, 'lo marca el sistema');
    assert.ok(data.writtenOffReason);
    assert.equal(data.daysPastDue, 240);
  });

  it('alta de uno VIGENTE: sin castigo', () => {
    const data = creditCreateData('acc', 'cli', ROW, SCOPE as never, STAMP);
    assert.equal(data.writtenOffAt, undefined);
  });

  it('actualización: lo marca si todavía no estaba castigado y deja el estado como estaba', () => {
    const data = creditUpdateData(CASTIGADO, {}, STAMP, { prevStatus: 'ACTIVE' as never, prevWrittenOffAt: null });
    assert.deepEqual(data.writtenOffAt, new Date(STAMP.at));
    assert.equal(data.status, 'ACTIVE');
  });

  it('actualización: el castigo ya marcado no se pisa (conserva su fecha y su motivo)', () => {
    const data = creditUpdateData(CASTIGADO, {}, STAMP, { prevStatus: 'ACTIVE' as never, prevWrittenOffAt: new Date('2026-01-01') });
    assert.equal(data.writtenOffAt, undefined);
    assert.equal(data.writtenOffReason, undefined);
  });

  it('un viejo con estado WRITTEN_OFF que vuelve CASTIGADO: se marca y el estado pasa a ACTIVE', () => {
    const data = creditUpdateData(CASTIGADO, {}, STAMP, { prevStatus: 'WRITTEN_OFF' as never, prevWrittenOffAt: null });
    assert.equal(data.status, 'ACTIVE');
    assert.ok(data.writtenOffAt);
  });

  it('si el reporte deja de decir CASTIGADO, el castigo no se revierte solo (lo decide una persona)', () => {
    const data = creditUpdateData(ROW, {}, STAMP, { prevStatus: 'ACTIVE' as never, prevWrittenOffAt: new Date('2026-01-01') });
    assert.equal(data.writtenOffAt, undefined, 'no se toca la columna');
  });

  it('un mapa propio de la cuenta que apunta a WRITTEN_OFF también marca el castigo, sin escribir el estado', () => {
    const row = { ...ROW, status: 'EN EJECUCION' };
    const ctx = { statusMap: { 'EN EJECUCION': 'WRITTEN_OFF' as never } };
    const data = creditCreateData('acc', 'cli', row, SCOPE as never, STAMP, ctx);
    assert.equal(data.status, 'ACTIVE');
    assert.ok(data.writtenOffAt);
  });
});
