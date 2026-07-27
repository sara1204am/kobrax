/**
 * Motor de lectura de PDFs con **una tabla adentro**: una fila de encabezados y una fila por
 * registro, en columnas por coordenada X. Es la tercera forma de archivo (§4.1).
 *
 * Por qué existe aparte de las otras dos: un reporte de mora tabular no es ninguna.
 *  - `rows` es una fila por registro pero en TEXTO (CSV) — acá los bytes son un PDF;
 *  - `pdf-blocks` es un PDF pero de bloques etiquetados (`Cliente: …`) — una tabla no tiene
 *    ni una etiqueta con `:`, así que ese motor devuelve cero columnas.
 *
 * Lo único propio de este archivo es convertir la tabla en `Record<encabezado, valor>[]`. De ahí
 * en adelante llama a `readRows`, la MISMA función que usa el CSV: emparejado, etiquetas y
 * candidatas de calibración salen idénticas, sin una segunda implementación que mantener.
 *
 * Como los otros dos, no sabe de ningún formato concreto (C12): qué fila son los encabezados lo
 * dice el usuario con `tableAnchor`, y las columnas se deducen del propio archivo.
 */
import { loadItems, matchesSignature, type FieldMap, type TextItem } from './pdf-blocks.parser';
import { readRows, type RowsResult } from './rows.parser';

export interface PdfRowsProfile {
  signature?: string[];
  /** Un texto CUALQUIERA de la fila de encabezados: sirve para encontrarla. El resto se deduce. */
  tableAnchor?: string;
}

export interface PdfRowsResult extends RowsResult {
  /**
   * Las primeras filas del documento, para que el usuario señale cuál es la de encabezados.
   * Sin eso no se sabe dónde empieza la tabla: un reporte trae título, código de asesor y fecha
   * antes de la primera columna, y ninguna regla general distingue eso de un encabezado.
   */
  headerCandidates: { anchor: string; preview: string }[];
}

/**
 * Distancia vertical hasta la que dos items se consideran de la misma fila.
 *
 * Sostiene dos cosas a la vez: los encabezados partidos en varias líneas ("No de" arriba de
 * "Oper.") caen juntos, y las filas de datos —bastante más separadas entre sí— no se fusionan.
 *
 * ponytail: constante, no parámetro. Sale de la separación real entre líneas de un reporte
 * (~4 px dentro de un encabezado, ~13 entre filas). Si aparece un archivo con filas más juntas,
 * el arreglo es exponerlo en el `profile` como los demás — no tocar el número a ciegas.
 */
const ROW_BAND = 8;

/** Tolerancia horizontal para decidir que dos items de filas distintas son la misma columna. */
const COLUMN_BAND = 20;

/** Cuántas filas se le ofrecen al usuario para que señale la de encabezados. */
const HEADER_CANDIDATES = 12;

/**
 * Mínimo de celdas para tomar una fila como registro. Debajo de eso es pie de página ("Pagina 1"),
 * un total o una nota suelta. Sin este corte, cada pie aparecería en la Vista Previa como un
 * registro rechazado, que es ruido sobre algo que el usuario no puede arreglar.
 */
const MIN_CELLS = 3;

export async function parsePdfRows(
  data: Uint8Array,
  profile: PdfRowsProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): Promise<PdfRowsResult> {
  const items = await loadItems(data);
  if (!matchesSignature(items, profile.signature)) throw new Error('SIGNATURE_MISMATCH');
  return readTable(items, profile, fields, opts);
}

// ── Parseo puro sobre los items (testeable sin PDF) ──────────────────────────

/** Items agrupados en filas visuales, de arriba hacia abajo. */
export function visualRows(items: TextItem[]): TextItem[][] {
  const ordered = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  let current: TextItem[] = [];
  let anchorY: number | null = null;
  let page = -1;

  for (const it of ordered) {
    const sameRow = anchorY !== null && it.page === page && anchorY - it.y <= ROW_BAND;
    if (!sameRow) {
      if (current.length > 0) rows.push(current);
      current = [];
      anchorY = it.y;
      page = it.page;
    }
    current.push(it);
  }
  if (current.length > 0) rows.push(current);
  return rows.map((r) => [...r].sort((a, b) => a.x - b.x || b.y - a.y));
}

export function readTable(
  items: TextItem[],
  profile: PdfRowsProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): PdfRowsResult {
  const rows = visualRows(items);
  const headerCandidates = rows.slice(0, HEADER_CANDIDATES).map((r) => ({
    anchor: r[0]!.str,
    preview: r.map((i) => i.str).join(' · '),
  }));

  const headerIndex = profile.tableAnchor
    ? rows.findIndex((r) => r.some((i) => i.str === profile.tableAnchor))
    : -1;
  // Sin señalar la fila de encabezados no hay tabla que leer, pero sí se puede mostrar el archivo
  // para que el usuario la señale. Devolver "no se pudo leer" sería mentir: se leyó perfecto.
  if (headerIndex === -1) {
    return { records: [], labels: [], columnCandidates: [], headerCandidates };
  }

  const dataRows = rows.slice(headerIndex + 1).filter((r) => r.length >= MIN_CELLS);
  const columns = columnRanges(dataRows, rows[headerIndex]!);
  const table = dataRows.map((row) => {
    const record: Record<string, string> = {};
    for (const col of columns) record[col.header] = '';
    for (const it of row) {
      const col = columns.find((c) => it.x >= c.from && it.x < c.to);
      if (!col) continue;
      // Una celda puede venir partida en varias líneas (una dirección larga): se concatenan en
      // orden de lectura en vez de quedarse con la última, que perdería media dirección.
      record[col.header] = record[col.header] ? `${record[col.header]} ${it.str}` : it.str;
    }
    return record;
  });

  return { ...readRows(table, fields, opts), headerCandidates };
}

interface Column {
  header: string;
  from: number; // x mínimo inclusive
  to: number; // x máximo exclusivo
}

/**
 * Dónde empieza y termina cada columna, y cómo se llama.
 *
 * Los límites salen de los DATOS y no de los encabezados, porque un encabezado suele estar
 * centrado sobre una columna cuyos valores van pegados a la izquierda: en un reporte real el
 * rótulo "Cliente" cae en x=119 y sus valores en x=75, así que cortar por la posición del
 * encabezado le asignaría los nombres a la columna anterior. Los valores, en cambio, se repiten
 * fila tras fila en la misma X: son la señal firme.
 *
 * Recién después se pregunta qué encabezado cae dentro de cada tramo. Los partidos en dos líneas
 * ("No de" + "Oper.") caen en el mismo tramo y se unen solos.
 */
export function columnRanges(dataRows: TextItem[][], headerRow: TextItem[]): Column[] {
  const xs = dataRows.flatMap((r) => r.map((i) => i.x)).sort((a, b) => a - b);
  if (xs.length === 0) return [];

  // Agrupa las X en columnas: una X nueva abre columna sólo si se despega de la anterior.
  const centers: number[] = [];
  let group: number[] = [xs[0]!];
  for (const x of xs.slice(1)) {
    if (x - group[group.length - 1]! <= COLUMN_BAND) {
      group.push(x);
    } else {
      centers.push(median(group));
      group = [x];
    }
  }
  centers.push(median(group));

  // El corte entre dos columnas es el punto medio: reparte a mitad de camino el desalineo de una
  // fila cuyo valor arranca un poco corrido. La primera y la última se extienden hasta el borde,
  // para que ningún item quede afuera de la tabla por unos pocos píxeles.
  return centers.map((c, i) => {
    const from = i === 0 ? -Infinity : (centers[i - 1]! + c) / 2;
    const to = i === centers.length - 1 ? Infinity : (c + centers[i + 1]!) / 2;
    const header = headerRow
      .filter((h) => h.x >= from && h.x < to)
      .map((h) => h.str)
      .join(' ');
    // Una columna sin rótulo igual existe y puede traer el dato que al usuario le interesa; se la
    // nombra por su posición para que pueda emparejarla.
    return { header: header || `Columna ${i + 1}`, from, to };
  });
}

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}
