/**
 * Categorías de mora (A / B / C…) en el editor de Administración (F4/08 · D1-b).
 *
 * Funciones puras: pasan los rangos de la API a filas editables (todo texto, como lo escribe la persona),
 * validan con **`validateArrearCategories` de shared** —la MISMA regla que aplica el servidor: empieza en 1,
 * sin huecos ni solapes, sólo la última sin tope— y arman el cuerpo del `PUT /arrear-categories`.
 * Ninguna regla de rangos vive acá.
 */
import { validateArrearCategories, type ArrearCategory, type ArrearCategoryError } from '@kobrax/shared';

/** Una fila del editor. Los números viajan como texto: un campo a medio escribir no es un número. */
export interface CategoryRow {
  /** Clave de React: estable aunque cambie el código. */
  key: string;
  code: string;
  name: string;
  fromDays: string;
  /** Vacío = sin límite (sólo la última). */
  toDays: string;
  /** Vacío = sin color. */
  color: string;
}

/** Lo que recibe `PUT /arrear-categories`. */
export interface ArrearCategoriesPayload {
  categories: { code: string; name: string; fromDays: number; toDays: number | null; color: string | null }[];
}

let seq = 0;
const nextKey = () => `row-${(seq += 1)}`;

/** Una fila vacía para «Agregar»: desde el día siguiente al último tope, si hay uno. */
export function blankRow(previous?: CategoryRow): CategoryRow {
  const prevTo = Number(previous?.toDays);
  const from = previous && previous.toDays.trim() !== '' && Number.isInteger(prevTo) ? String(prevTo + 1) : '';
  return { key: nextKey(), code: '', name: '', fromDays: from, toDays: '', color: '' };
}

/** Los rangos de la API → filas editables, en el orden en que vienen (ya ordenados por el servidor). */
export function rowsFromCategories(categories: readonly ArrearCategory[]): CategoryRow[] {
  return categories.map((c) => ({
    key: nextKey(),
    code: c.code,
    name: c.name,
    fromDays: String(c.fromDays),
    toDays: c.toDays === null ? '' : String(c.toDays),
    color: c.color ?? '',
  }));
}

/** Un campo de días → número. Vacío o no entero da `NaN`, que `validateArrearCategories` rechaza como `RANGE_INVALID`. */
function days(raw: string): number {
  const text = raw.trim();
  return text === '' ? Number.NaN : Number(text);
}

/** Las filas → lo que valida `validateArrearCategories`. El hasta vacío es «sin límite» (`null`). */
export function toRanges(rows: readonly CategoryRow[]): { code: string; fromDays: number; toDays: number | null }[] {
  return rows.map((r) => ({
    code: r.code,
    fromDays: days(r.fromDays),
    toDays: r.toDays.trim() === '' ? null : days(r.toDays),
  }));
}

/** Los códigos de error de las filas, o `[]` si el juego es válido (misma regla que el servidor). */
export function validateRows(rows: readonly CategoryRow[]): ArrearCategoryError[] {
  return validateArrearCategories(toRanges(rows));
}

/** El cuerpo del `PUT`. Sólo tiene sentido con `validateRows(rows).length === 0`. */
export function toPayload(rows: readonly CategoryRow[]): ArrearCategoriesPayload {
  return {
    categories: rows.map((r) => ({
      code: r.code.trim(),
      // Sin nombre se usa el código: es lo que hace el servidor, y así la pantalla no manda un vacío.
      name: r.name.trim() || r.code.trim(),
      fromDays: days(r.fromDays),
      toDays: r.toDays.trim() === '' ? null : days(r.toDays),
      color: r.color.trim() || null,
    })),
  };
}

/** ¿Cambió algo respecto de lo guardado? Sin cambios no hay nada que guardar. */
export function sameRows(a: readonly CategoryRow[], b: readonly CategoryRow[]): boolean {
  const strip = (rows: readonly CategoryRow[]) =>
    JSON.stringify(rows.map(({ code, name, fromDays, toDays, color }) => [code.trim(), name.trim(), fromDays.trim(), toDays.trim(), color.trim()]));
  return strip(a) === strip(b);
}
