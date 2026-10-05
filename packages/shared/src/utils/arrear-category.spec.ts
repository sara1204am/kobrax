import { describe, expect, it } from 'vitest';
import {
  ARREAR_CATEGORY_ERRORS,
  DEFAULT_ARREAR_CATEGORIES,
  categoryForDays,
  validateArrearCategories,
} from './arrear-category.js';

const defaults = DEFAULT_ARREAR_CATEGORIES;
const row = (code: string, fromDays: number, toDays: number | null) => ({ code, fromDays, toDays });

describe('categoryForDays', () => {
  it('🔴 los bordes de A/B/C caen donde tienen que caer', () => {
    const code = (d: number) => categoryForDays(d, defaults)?.code ?? null;
    expect(code(1)).toBe('A');
    expect(code(30)).toBe('A');
    expect(code(31)).toBe('B');
    expect(code(60)).toBe('B');
    expect(code(61)).toBe('C');
    expect(code(10000)).toBe('C');
  });

  it('🔴 un crédito al día o un dato inválido no tiene categoría', () => {
    expect(categoryForDays(0, defaults)).toBeNull();
    expect(categoryForDays(-5, defaults)).toBeNull();
    expect(categoryForDays(Number.NaN, defaults)).toBeNull();
  });

  it('no exige que los rangos vengan ordenados', () => {
    const unsorted = [defaults[2]!, defaults[0]!, defaults[1]!];
    expect(categoryForDays(45, unsorted)?.code).toBe('B');
  });

  it('devuelve null si los rangos configurados no cubren el número', () => {
    expect(categoryForDays(500, [row('A', 1, 30)])).toBeNull();
    expect(categoryForDays(10, [])).toBeNull();
  });

  it('respeta rangos propios de la cuenta, no los de ejemplo', () => {
    const custom = [row('X', 1, 5), row('Y', 6, null)];
    expect(categoryForDays(5, custom)?.code).toBe('X');
    expect(categoryForDays(6, custom)?.code).toBe('Y');
  });
});

describe('validateArrearCategories', () => {
  it('los valores iniciales son válidos', () => {
    expect(validateArrearCategories(defaults)).toEqual([]);
  });

  it('acepta las filas desordenadas', () => {
    expect(validateArrearCategories([row('C', 61, null), row('A', 1, 30), row('B', 31, 60)])).toEqual([]);
  });

  it('sin filas no hay configuración', () => {
    expect(validateArrearCategories([])).toEqual(['EMPTY']);
  });

  it('🔴 tiene que empezar en el día 1', () => {
    expect(validateArrearCategories([row('A', 2, 30), row('B', 31, null)])).toEqual(['NOT_STARTING_AT_1']);
  });

  it('detecta un hueco', () => {
    expect(validateArrearCategories([row('A', 1, 30), row('B', 35, null)])).toEqual(['GAP']);
  });

  it('detecta un solape, también el de un solo día', () => {
    expect(validateArrearCategories([row('A', 1, 30), row('B', 30, null)])).toEqual(['OVERLAP']);
    expect(validateArrearCategories([row('A', 1, 30), row('B', 20, 40), row('C', 41, null)])).toEqual(['OVERLAP']);
  });

  it('🔴 sólo la última puede quedar sin tope', () => {
    expect(validateArrearCategories([row('A', 1, null), row('B', 31, null)])).toContain('OPEN_ENDED_NOT_LAST');
  });

  it('la última puede tener tope (los días de más quedan sin categoría)', () => {
    expect(validateArrearCategories([row('A', 1, 30), row('B', 31, 60)])).toEqual([]);
  });

  it('códigos vacíos y repetidos', () => {
    expect(validateArrearCategories([row('A', 1, 30), row('A', 31, null)])).toEqual(['CODE_DUPLICATE']);
    expect(validateArrearCategories([row('  ', 1, null)])).toEqual(['CODE_EMPTY']);
  });

  it('hasta antes que desde, y desde menor a 1', () => {
    expect(validateArrearCategories([row('A', 10, 5)])).toEqual(['TO_BEFORE_FROM', 'NOT_STARTING_AT_1']);
    expect(validateArrearCategories([row('A', 0, 30)])).toContain('RANGE_INVALID');
    expect(validateArrearCategories([row('A', 1, 30.5)])).toContain('RANGE_INVALID');
  });

  it('devuelve los errores en el orden del catálogo y sin repetir', () => {
    const errors = validateArrearCategories([row('A', 2, 30), row('A', 40, null), row('B', 50, null)]);
    expect(errors).toEqual(ARREAR_CATEGORY_ERRORS.filter((e) => errors.includes(e)));
    expect(new Set(errors).size).toBe(errors.length);
  });
});
