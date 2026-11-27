/**
 * Motor de lectura de **JSON** (el que devuelve una API, o el mismo guardado como archivo).
 *
 * No sabe de ningún banco: busca la lista de registros, aplana lo anidado (`cliente.nombre`) y
 * entrega filas a `readRows`, así que de ahí en adelante es el mismo camino que una planilla.
 */
import type { FieldMap } from './pdf-blocks.parser';
import { readRows, type RowsResult } from './rows.parser';

export interface JsonRowsProfile {
  /** Dónde está la lista, con puntos (`data.creditos`). `''` = el documento ES la lista. Ausente = sin elegir. */
  recordsPath?: string;
}

export interface JsonRowsResult extends RowsResult {
  /** Las listas de objetos que trae el documento, de la más larga a la más corta. */
  recordsCandidates: { path: string; count: number }[];
  /**
   * Por registro, los campos cuyo valor venía como **número** en el JSON. Ya son exactos: el lector
   * de montos de reportes leería `1234.567` como un millón (tres cifras tras el punto = miles).
   */
  exactNumbers: Set<string>[];
}

export const MAX_JSON_RECORDS = 50_000;
const MAX_DEPTH = 8;
const MAX_COLUMNS = 500;
/** Igual que el separador que `splitPhones` ya entiende. */
const LIST_SEPARATOR = ' - ';

interface Cell {
  value: string;
  numeric: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseJsonRows(
  content: string,
  profile: JsonRowsProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): JsonRowsResult {
  let doc: unknown;
  try {
    doc = JSON.parse(content.replace(/^﻿/, ''));
  } catch {
    throw new Error('El archivo no es un JSON válido');
  }

  const lists = findLists(doc);
  const recordsCandidates = lists
    .map(({ path, items }) => ({ path, count: items.length }))
    .sort((a, b) => b.count - a.count);
  // Con una sola lista no hay nada que preguntar. Con varias, elige la persona: adivinar mal importa otra cosa.
  const path = profile.recordsPath ?? (lists.length === 1 ? lists[0]!.path : undefined);
  const list = lists.find((l) => l.path === path);
  if (!list) {
    return { records: [], labels: [], columnCandidates: [], samples: {}, recordsCandidates, exactNumbers: [] };
  }
  if (list.items.length > MAX_JSON_RECORDS) throw new Error(`JSON_TOO_MANY_RECORDS (${list.items.length})`);

  const columns = new Set<string>();
  const flat = list.items.map((item) => {
    const cells = new Map<string, Cell[]>();
    flatten(item, '', 0, cells);
    for (const key of cells.keys()) columns.add(key);
    if (columns.size > MAX_COLUMNS) throw new Error('JSON_TOO_MANY_COLUMNS');
    return cells;
  });

  const rows = flat.map((cells) => {
    // Sin prototipo: una clave del documento llamada `__proto__` o `constructor` es sólo una columna.
    const row = Object.create(null) as Record<string, string>;
    // Lo que el registro no trae (o trae `null`) queda sin celda → `null`, que NO es cero.
    for (const [key, values] of cells) row[key] = values.map((c) => c.value).join(LIST_SEPARATOR);
    return row;
  });

  const exactNumbers = flat.map((cells) => {
    const out = new Set<string>();
    for (const [canonical, src] of Object.entries(fields)) {
      const values = cells.get(src.from);
      if (values?.length === 1 && values[0]!.numeric) out.add(canonical);
    }
    return out;
  });

  // Las columnas son la unión de todos los registros: una API suele omitir lo vacío.
  return { ...readRows(rows, fields, { ...opts, labels: [...columns] }), recordsCandidates, exactNumbers };
}

/** Las listas con al menos un objeto. No entra dentro de una lista: eso es detalle de un registro. */
function findLists(doc: unknown): { path: string; items: Record<string, unknown>[] }[] {
  const out: { path: string; items: Record<string, unknown>[] }[] = [];
  const walk = (node: unknown, path: string, depth: number): void => {
    if (Array.isArray(node)) {
      const items = node.filter(isObject);
      if (items.length > 0) out.push({ path, items });
      return;
    }
    if (!isObject(node) || depth >= MAX_DEPTH) return;
    for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key, depth + 1);
  };
  walk(doc, '', 0);
  return out;
}

/** Un registro → columnas. Una lista adentro (teléfonos, garantes) junta sus valores en la misma columna. */
function flatten(node: unknown, path: string, depth: number, out: Map<string, Cell[]>): void {
  if (node === null || node === undefined) return;
  if (depth > MAX_DEPTH) throw new Error('JSON_TOO_DEEP');
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, path, depth + 1, out);
    return;
  }
  if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) flatten(value, path ? `${path}.${key}` : key, depth + 1, out);
    return;
  }
  // Un entero así de largo ya llegó redondeado: un nº de crédito cambiado es peor que un error.
  if (typeof node === 'number' && Number.isInteger(node) && !Number.isSafeInteger(node)) {
    throw new Error(`El número de "${path}" es demasiado largo: la API tiene que enviarlo como texto`);
  }
  const cells = out.get(path) ?? [];
  cells.push({ value: String(node).trim(), numeric: typeof node === 'number' });
  out.set(path, cells);
}
