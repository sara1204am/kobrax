/**
 * Motor de lectura de archivos con **una fila por registro** (CSV y Excel).
 *
 * Igual que `pdf-blocks.parser.ts`: no sabe de ningún banco ni de ningún formato concreto.
 * Los encabezados salen del archivo del cliente y el emparejado llega por `FieldMap` (datos).
 * Ver FIELD-RULES §1 y §4 (C12).
 */
import { parseCsv } from '../../clients/import/csv';
import type { ColumnCandidate, FieldMap } from './pdf-blocks.parser';

export interface RowsProfile {
  signature?: string[];
  /** Fila (1-based) donde están los encabezados. Default 1. */
  headerRow?: number;
}

export interface RowsResult {
  records: Record<string, string | null>[];
  /** Encabezados encontrados — la lista para emparejar (§6.5). */
  labels: string[];
  columnCandidates: ColumnCandidate[];
}

const CANDIDATE_SAMPLES = 3;

/**
 * `rows` sobre CSV. Excel entra por acá cuando aterrice la dep `xlsx` (R7): sólo hay que
 * convertir la hoja a `Record<string,string>[]` y llamar a `readRows` — el resto es común.
 * ponytail: sin la dep instalada, escribir el adaptador de xlsx sería código muerto.
 */
export function parseCsvRows(
  content: string,
  profile: RowsProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): RowsResult {
  if (profile.signature?.length && !profile.signature.every((s) => content.includes(s))) {
    throw new Error('SIGNATURE_MISMATCH');
  }
  const skip = Math.max(0, (profile.headerRow ?? 1) - 1);
  const body = skip === 0 ? content : content.split(/\r\n?|\n/).slice(skip).join('\n');
  return readRows(parseCsv(body), fields, opts);
}

export function readRows(
  rows: Record<string, string>[],
  fields: FieldMap,
  opts: { labelField?: string } = {},
): RowsResult {
  const labels = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const records = rows.map((row) => {
    const record: Record<string, string | null> = {};
    for (const [canonical, src] of Object.entries(fields)) {
      // `undefined` (columna que no existe) → null: el service no escribe la columna.
      // `''` (celda vacía) se conserva: es un valor leído, no una columna faltante.
      record[canonical] = row[src.from] ?? null;
    }
    return record;
  });

  return { records, labels, columnCandidates: buildCandidates(rows, labels, records, opts.labelField) };
}

/**
 * Columnas que podrían ser "días de atraso", con valores reales para calibrar (§6.5.1).
 * Mismo criterio que en `pdf-blocks`: enteros de 1-4 dígitos o vacío; fuera montos y fechas.
 */
function buildCandidates(
  rows: Record<string, string>[],
  labels: string[],
  records: Record<string, string | null>[],
  labelField = 'clientName',
): ColumnCandidate[] {
  const isDayLike = (raw: string): boolean => raw.trim() === '' || /^\d{1,4}$/.test(raw.trim());
  const sample = rows.slice(0, CANDIDATE_SAMPLES);
  return labels
    .filter((h) => sample.every((r) => isDayLike(r[h] ?? '')))
    .map((h) => ({
      header: h,
      samples: sample.map((r, i) => ({
        label: records[i]?.[labelField] ?? records[i]?.code ?? '',
        value: (r[h] ?? '').trim() === '' ? null : Number(r[h]),
      })),
    }));
}
