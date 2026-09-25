import { describe, expect, it } from 'vitest';
import { IMPORT_TRACKED_FIELDS, importCompleteness, isUnknownField, nextImportMissing } from './credit-import.js';
import { readCreditMetadata } from './loan.js';

describe('nextImportMissing — qué sigue sin conocerse (D9)', () => {
  it('alta: falta todo lo que el archivo no trajo', () => {
    expect(nextImportMissing(undefined, { outstandingBalance: true, daysPastDue: true })).toEqual([
      'principalAmount',
      'interestRate',
      'installmentAmount',
      'installmentsCount',
      'frequency',
      'nextDueDate',
      'disbursedAt',
    ]);
  });

  it('actualización: lo que llega deja de faltar', () => {
    expect(nextImportMissing(['installmentAmount', 'nextDueDate'], { installmentAmount: true })).toEqual(['nextDueDate']);
  });

  it('un dato conocido no se vuelve desconocido porque el próximo archivo no lo traiga', () => {
    expect(nextImportMissing(['nextDueDate'], {})).toEqual(['nextDueDate']);
  });

  it('con todo presente no falta nada', () => {
    const all = Object.fromEntries(IMPORT_TRACKED_FIELDS.map((f) => [f, true]));
    expect(nextImportMissing(undefined, all)).toEqual([]);
  });
});

describe('lectura y consulta', () => {
  it('readCreditMetadata descarta nombres de campo desconocidos', () => {
    const m = readCreditMetadata({ origin: 'import', importMissing: ['principalAmount', 'foo', 3], importRunId: 'r1', importedAt: '2026-09-25T00:00:00Z' });
    expect(m.importMissing).toEqual(['principalAmount']);
    expect(m.importRunId).toBe('r1');
  });

  it('isUnknownField e importCompleteness', () => {
    const credit = { unknownFields: ['principalAmount' as const, 'frequency' as const] };
    expect(isUnknownField(credit, 'principalAmount')).toBe(true);
    expect(isUnknownField(credit, 'outstandingBalance')).toBe(false);
    expect(isUnknownField({}, 'principalAmount')).toBe(false);
    expect(importCompleteness(credit.unknownFields)).toEqual({ known: 7, total: 9 });
  });
});
