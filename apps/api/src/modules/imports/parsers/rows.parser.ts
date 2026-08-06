/**
 * Motor de lectura de archivos con **una fila por registro** (CSV y Excel).
 *
 * Igual que `pdf-blocks.parser.ts`: no sabe de ningún banco ni de ningún formato concreto.
 * Los encabezados salen del archivo del cliente y el emparejado llega por `FieldMap` (datos).
 * Ver FIELD-RULES §1 y §4 (C12).
 */
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
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
 * La forma `rows` viene en dos envases: CSV (texto) y Excel (un zip). **No son dos formas de
 * archivo distintas**: el usuario configuró `rows` y exportó su planilla como se le dio la gana,
 * así que la decisión la toman los bytes y no la config — mismo criterio que `detectFileShape`.
 * Los dos llamadores (la preview y la corrida) entran por acá y no vuelven a elegir motor.
 */
export function parseRowsFile(
  file: Buffer,
  profile: RowsProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): Promise<RowsResult> {
  return isZip(file)
    ? parseXlsxRows(file, profile, fields, opts)
    : Promise.resolve(parseCsvRows(file.toString('utf8'), profile, fields, opts));
}

/** Un `.xlsx`/`.ods` es un zip: empieza con `PK\x03\x04`. Un CSV nunca. */
function isZip(file: Buffer): boolean {
  return file.length >= 4 && file[0] === 0x50 && file[1] === 0x4b && file[2] === 0x03 && file[3] === 0x04;
}

/**
 * Excel → las mismas filas que produce el CSV, para que `readRows` no sepa de dónde vinieron.
 * Sólo la **primera hoja**: el extracto que manda un banco es una hoja, y elegir entre varias es
 * una pregunta más en Ajustes que hoy nadie pidió.
 *
 * ponytail: `xlsx` (SheetJS) quedó en 0.18.5 en npm, con prototype pollution y ReDoS sin arreglar
 * ahí (los fixes viven sólo en su CDN). Como esto parsea archivos que sube el usuario, va `exceljs`,
 * que está mantenido y publicado. Corrige la dep aprobada en import R7.
 */
export async function parseXlsxRows(
  file: Buffer,
  profile: RowsProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): Promise<RowsResult> {
  // Por stream y no por `load(buffer)`: exceljs trae su propia copia de `@types/node` y sus dos
  // `Buffer` no son el mismo tipo. `Readable.from` evita el choque sin apagar el chequeo con un cast.
  const wb = await new ExcelJS.Workbook().xlsx.read(Readable.from(file));
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('EMPTY_WORKBOOK');

  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // `row.values` viene 1-based con un hueco en [0]; `slice(1)` lo alinea con las columnas.
    const cells = (row.values as unknown[]).slice(1).map(cellText);
    if (cells.some((c) => c !== '')) matrix.push(cells);
  });

  if (profile.signature?.length) {
    const texto = matrix.flat().join('\n');
    if (!profile.signature.every((s) => texto.includes(s))) throw new Error('SIGNATURE_MISMATCH');
  }

  const skip = Math.max(0, (profile.headerRow ?? 1) - 1);
  const [header, ...body] = matrix.slice(skip);
  if (!header) return { records: [], labels: [], columnCandidates: [] };

  // Encabezado repetido (dos columnas "SALDO") pisaría la primera: se desambigua como hace el CSV.
  const labels = header.map((h, i) => (h === '' ? `Columna ${i + 1}` : h));
  const rows = body.map((cells) => {
    const row: Record<string, string> = {};
    labels.forEach((label, i) => {
      row[label] = cells[i] ?? '';
    });
    return row;
  });
  return readRows(rows, fields, opts);
}

/**
 * Una celda como la vería el usuario. Excel no guarda texto: guarda números, fechas, fórmulas con
 * su resultado, texto enriquecido e hipervínculos — y el resto del import trabaja con strings.
 * Las fechas van a `YYYY-MM-DD` porque es lo que `normalizeRecord` sabe leer.
 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellText(o.result); // fórmula: vale el resultado, no la fórmula
    if ('text' in o) return cellText(o.text); // hipervínculo
    // El trim va al final y no por fragmento: "QUISPE " + "ROSA" son dos tramos con distinto
    // formato de una sola celda, y recortar cada uno pega las palabras ("QUISPEROSA").
    if (Array.isArray(o.richText)) {
      return o.richText.map((r) => String((r as { text?: unknown }).text ?? '')).join('').trim();
    }
    if ('error' in o) return ''; // #N/A, #REF! — una celda rota es una celda vacía
    return '';
  }
  return String(v).trim();
}

/** `rows` sobre CSV. Excel entra por `parseXlsxRows`; ambos terminan en `readRows`. */
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
