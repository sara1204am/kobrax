/**
 * Categoría de mora (A / B / C…): se CALCULA con los días de mora y los rangos que cada cuenta configura
 * en Administración (F4/08 · D1-b). No se guarda en el crédito, no la elige el usuario y la categoría de la
 * persona no interviene. **Ningún rango va escrito en otro lado**: todo consumidor llama a estas funciones.
 */
import type { ArrearCategoryDraft, ArrearRange } from '../types/sin-caso.types.js';

/**
 * Los rangos con que nace cada cuenta (espejo del backfill de `20261004000000_sin_caso_fundacion`).
 * Después se editan desde Administración.
 */
export const DEFAULT_ARREAR_CATEGORIES: readonly ArrearCategoryDraft[] = [
  { code: 'A', name: 'Categoría A', fromDays: 1, toDays: 30, color: null, sortOrder: 1 },
  { code: 'B', name: 'Categoría B', fromDays: 31, toDays: 60, color: null, sortOrder: 2 },
  { code: 'C', name: 'Categoría C', fromDays: 61, toDays: null, color: null, sortOrder: 3 },
];

/**
 * La categoría cuyo rango contiene `days`, o `null`: un crédito al día (`days < 1`), un dato inválido, o
 * unos rangos que no cubren ese número. No exige que `categories` venga ordenada.
 */
export function categoryForDays<T extends ArrearRange>(days: number, categories: readonly T[]): T | null {
  if (!Number.isFinite(days) || days < 1) return null;
  const d = Math.floor(days);
  for (const c of categories) {
    if (d >= c.fromDays && (c.toDays === null || d <= c.toDays)) return c;
  }
  return null;
}

/** Qué está mal en un juego de rangos. */
export const ARREAR_CATEGORY_ERRORS = [
  'EMPTY', // no hay ninguna categoría
  'CODE_EMPTY', // un código vacío
  'CODE_DUPLICATE', // dos categorías con el mismo código
  'RANGE_INVALID', // desde-días no es un entero >= 1, o hasta-días no es un entero
  'TO_BEFORE_FROM', // hasta-días menor que desde-días
  'NOT_STARTING_AT_1', // la primera no empieza en el día 1
  'GAP', // faltan días entre dos categorías
  'OVERLAP', // dos categorías comparten días
  'OPEN_ENDED_NOT_LAST', // una sin tope que no es la última
] as const;
export type ArrearCategoryError = (typeof ARREAR_CATEGORY_ERRORS)[number];

export type ArrearCategoryRow = ArrearRange & { code: string };

/**
 * Valida un juego de rangos: empieza en 1, sin huecos ni solapes, sólo la ÚLTIMA puede no tener tope y los
 * códigos son únicos y no vacíos. Devuelve los códigos de error presentes (sin repetir, en el orden de
 * `ARREAR_CATEGORY_ERRORS`); vacío = válido. Acepta las filas en cualquier orden: las ordena por `fromDays`.
 */
export function validateArrearCategories(rows: readonly ArrearCategoryRow[]): ArrearCategoryError[] {
  const found = new Set<ArrearCategoryError>();
  if (rows.length === 0) return ['EMPTY'];

  const codes = new Set<string>();
  for (const r of rows) {
    const code = typeof r.code === 'string' ? r.code.trim() : '';
    if (code === '') found.add('CODE_EMPTY');
    else if (codes.has(code)) found.add('CODE_DUPLICATE');
    codes.add(code);

    if (!Number.isInteger(r.fromDays) || r.fromDays < 1 || (r.toDays !== null && !Number.isInteger(r.toDays))) {
      found.add('RANGE_INVALID');
    } else if (r.toDays !== null && r.toDays < r.fromDays) {
      found.add('TO_BEFORE_FROM');
    }
  }

  // El orden de los rangos sólo tiene sentido si los números lo tienen.
  const sorted = rows.filter((r) => Number.isFinite(r.fromDays)).sort((a, b) => a.fromDays - b.fromDays);
  if (sorted.length > 0 && sorted[0]!.fromDays !== 1) found.add('NOT_STARTING_AT_1');

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    if (cur.toDays === null) {
      if (next) found.add('OPEN_ENDED_NOT_LAST');
      continue;
    }
    if (!next) continue;
    if (next.fromDays <= cur.toDays) found.add('OVERLAP');
    else if (next.fromDays > cur.toDays + 1) found.add('GAP');
  }

  return ARREAR_CATEGORY_ERRORS.filter((e) => found.has(e));
}
