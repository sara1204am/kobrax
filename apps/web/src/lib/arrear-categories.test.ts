import { describe, expect, it } from 'vitest';
import type { ArrearCategory } from '@kobrax/shared';
import { blankRow, rowsFromCategories, sameRows, toPayload, validateRows, type CategoryRow } from './arrear-categories';

const CATS: ArrearCategory[] = [
  { id: '1', code: 'A', name: 'Categoría A', fromDays: 1, toDays: 30, color: null, sortOrder: 1 },
  { id: '2', code: 'B', name: 'Categoría B', fromDays: 31, toDays: 60, color: '#E67E22', sortOrder: 2 },
  { id: '3', code: 'C', name: 'Categoría C', fromDays: 61, toDays: null, color: null, sortOrder: 3 },
];

const row = (over: Partial<CategoryRow>): CategoryRow => ({ key: 'k', code: 'X', name: '', fromDays: '1', toDays: '', color: '', ...over });

describe('validateRows (misma regla que el servidor: validateArrearCategories)', () => {
  it('los rangos de la cuenta son válidos', () => {
    expect(validateRows(rowsFromCategories(CATS))).toEqual([]);
  });

  it('detecta huecos', () => {
    const rows = rowsFromCategories(CATS);
    rows[1]!.fromDays = '35';
    expect(validateRows(rows)).toContain('GAP');
  });

  it('detecta solapes', () => {
    const rows = rowsFromCategories(CATS);
    rows[1]!.fromDays = '25';
    expect(validateRows(rows)).toContain('OVERLAP');
  });

  it('tiene que empezar en el día 1', () => {
    const rows = rowsFromCategories(CATS);
    rows[0]!.fromDays = '5';
    expect(validateRows(rows)).toContain('NOT_STARTING_AT_1');
  });

  it('sólo la última puede quedar sin límite', () => {
    const rows = rowsFromCategories(CATS);
    rows[0]!.toDays = '';
    expect(validateRows(rows)).toContain('OPEN_ENDED_NOT_LAST');
  });

  it('un campo a medio escribir es un rango inválido, no un cero', () => {
    expect(validateRows([row({ fromDays: '' })])).toContain('RANGE_INVALID');
    expect(validateRows([row({ toDays: 'abc' })])).toContain('RANGE_INVALID');
    expect(validateRows([row({ fromDays: '1.5' })])).toContain('RANGE_INVALID');
  });

  it('código vacío, código repetido y sin categorías', () => {
    expect(validateRows([row({ code: ' ' })])).toContain('CODE_EMPTY');
    expect(validateRows([row({ code: 'A', toDays: '30' }), row({ code: 'A', fromDays: '31' })])).toContain('CODE_DUPLICATE');
    expect(validateRows([])).toEqual(['EMPTY']);
  });
});

describe('toPayload', () => {
  it('arma el cuerpo del PUT: números, «sin límite» = null, color vacío = null', () => {
    expect(toPayload(rowsFromCategories(CATS))).toEqual({
      categories: [
        { code: 'A', name: 'Categoría A', fromDays: 1, toDays: 30, color: null },
        { code: 'B', name: 'Categoría B', fromDays: 31, toDays: 60, color: '#E67E22' },
        { code: 'C', name: 'Categoría C', fromDays: 61, toDays: null, color: null },
      ],
    });
  });

  it('sin nombre usa el código, y recorta espacios', () => {
    const body = toPayload([row({ code: ' D ', name: '  ', fromDays: ' 1 ', toDays: ' 10 ', color: ' ' })]);
    expect(body.categories[0]).toEqual({ code: 'D', name: 'D', fromDays: 1, toDays: 10, color: null });
  });
});

describe('filas', () => {
  it('«agregar» propone el día siguiente al tope de la última', () => {
    const rows = rowsFromCategories(CATS.slice(0, 2));
    expect(blankRow(rows[1]).fromDays).toBe('61');
    // Si la última no tiene tope no hay siguiente que proponer.
    expect(blankRow(rowsFromCategories(CATS)[2]).fromDays).toBe('');
  });

  it('sameRows ignora espacios y detecta cambios reales', () => {
    const a = rowsFromCategories(CATS);
    const b = rowsFromCategories(CATS);
    b[0]!.name = ' Categoría A ';
    expect(sameRows(a, b)).toBe(true);
    b[0]!.toDays = '20';
    expect(sameRows(a, b)).toBe(false);
  });
});
