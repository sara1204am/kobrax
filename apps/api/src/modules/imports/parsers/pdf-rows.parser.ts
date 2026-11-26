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

/**
 * Hasta cuánto pueden diferir en X dos items de la misma fila y seguir siendo la misma celda: los
 * renglones apilados de una celda partida arrancan en la misma X, con uno o dos píxeles de redondeo.
 */
const STACKED_BAND = 4;

/** Separación horizontal hasta la que dos items del mismo renglón son pedazos de un mismo texto (px). */
const GLUE_GAP = 0.8;

/** Una fecha o un importe: señal de que un renglón es un dato y no parte del encabezado ni una continuación. */
const DATA_VALUE = /\d{1,2}\/\d{1,2}\/\d{2,4}|\d[.,]\d{2}(?!\d)/;

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

/**
 * Arregla textos que el PDF entrega en pedazos, antes de armar filas y columnas:
 *  · en el mismo renglón, pegados uno al otro ("706" "-" "1" "-" "46682") → un solo valor;
 *  · una fecha cortada porque no entraba en la celda ("20/04/202" arriba de "6") → la fecha entera.
 * Sin esto cada pedazo abría su propia columna.
 */
export function joinFragments(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
    const prev = out[out.length - 1];
    if (prev?.width !== undefined && prev.page === it.page && prev.y === it.y) {
      const gap = it.x - (prev.x + prev.width);
      // El piso evita unir dos textos DIBUJADOS uno encima del otro, que no son una palabra partida.
      if (gap <= GLUE_GAP && gap >= -2) {
        out[out.length - 1] = { ...prev, str: prev.str + it.str, width: it.x + (it.width ?? 0) - prev.x };
        continue;
      }
    }
    out.push(it);
  }

  const used = new Set<TextItem>();
  const dated = out.map((it) => {
    const year = /^\d{1,2}\/\d{1,2}\/(\d{1,3})$/.exec(it.str)?.[1];
    if (year === undefined) return it;
    const rest = out.find(
      (o) => !used.has(o) && o.page === it.page && it.y > o.y && it.y - o.y <= ROW_BAND && Math.abs(o.x - it.x) <= COLUMN_BAND && /^\d+$/.test(o.str) && year.length + o.str.length === 4,
    );
    if (!rest) return it;
    used.add(rest);
    return { ...it, str: it.str + rest.str };
  });
  return dated.filter((_, i) => !used.has(out[i]!));
}

const isLabelRow = (row: TextItem[]) => row.every((i) => !DATA_VALUE.test(i.str));
const topOf = (row: TextItem[]) => Math.max(...row.map((i) => i.y));
const bottomOf = (row: TextItem[]) => Math.min(...row.map((i) => i.y));
const touches = (upper: TextItem[], lower: TextItem[]) => upper[0]!.page === lower[0]!.page && bottomOf(upper) - topOf(lower) <= ROW_BAND;

/**
 * El encabezado completo alrededor de la fila señalada. Un título de columna puede ocupar tres o cuatro renglones: se suman los
 * pegados, arriba y abajo, mientras no traigan fechas ni importes.
 */
function headerRange(rows: TextItem[][], at: number): { from: number; to: number } {
  let from = at;
  let to = at;
  while (from > 0 && isLabelRow(rows[from - 1]!) && touches(rows[from - 1]!, rows[from]!)) from--;
  while (to + 1 < rows.length && isLabelRow(rows[to + 1]!) && touches(rows[to]!, rows[to + 1]!)) to++;
  return { from, to };
}

/**
 * Une a su registro los renglones que sólo continúan celdas largas (el resto de un nombre o de una dirección): son pocos, sin
 * fechas ni importes y pegados al de arriba. Sin esto cada uno aparecía como un registro rechazado.
 */
function mergeContinuations(rows: TextItem[][]): TextItem[][] {
  if (rows.length === 0) return rows;
  const typical = median(rows.map((r) => r.length).sort((a, b) => a - b));
  const out: TextItem[][] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (prev && row.length < typical / 2 && isLabelRow(row) && touches(prev, row)) prev.push(...row);
    else out.push([...row]);
  }
  // En orden de lectura dentro de cada columna: primero el renglón de arriba.
  return out.map((r) => r.sort((a, b) => b.y - a.y || a.x - b.x));
}

/** «número [código] Nombre»: el número con al menos 5 dígitos, un segundo código opcional (a veces con un «?») y un texto sin cifras. */
const CODE_AND_NAME = /^((?:[^\s\d]*\d){5}\S*)\s+(?:(\d{4,}\??)\s+)?(\p{L}[\p{L}\s.,'’-]*)$/u;

/** Qué parte de las filas con dato tienen que cumplir la forma para dar la columna por «número + nombre». */
const SPLIT_SHARE = 0.8;

/**
 * Hay reportes que ponen el número de operación y el nombre en UNA columna. Se agregan columnas derivadas
 * («X (número)», «X (código)», «X (nombre)») para poder emparejarlas por separado. La original queda intacta, así que
 * ningún emparejado ya guardado cambia; una columna que no tenga esa forma casi siempre no genera nada.
 */
export function splitCodeAndName(table: Record<string, string>[]): Record<string, string>[] {
  const out = table.map((r) => ({ ...r }));
  for (const header of Object.keys(table[0] ?? {})) {
    const filled = table.filter((r) => r[header]);
    const parts = table.map((r) => CODE_AND_NAME.exec(r[header] ?? ''));
    const matched = parts.filter(Boolean).length;
    if (matched === 0 || matched < filled.length * SPLIT_SHARE) continue;
    const hasSecond = parts.some((p) => p?.[2]);
    out.forEach((r, i) => {
      const p = parts[i];
      r[`${header} (número)`] = p?.[1] ?? '';
      if (hasSecond) r[`${header} (código)`] = p?.[2] ?? '';
      r[`${header} (nombre)`] = p?.[3]?.trim() ?? '';
    });
  }
  return out;
}

function readTable(
  items: TextItem[],
  profile: PdfRowsProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): PdfRowsResult {
  const rows = visualRows(joinFragments(items));
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
    return { records: [], labels: [], columnCandidates: [], samples: {}, headerCandidates };
  }

  const { from, to } = headerRange(rows, headerIndex);
  // Los rótulos se leen de arriba hacia abajo. Algunos generadores dejan escrito el salto de línea («Nombre del\ncliente»).
  const header = rows
    .slice(from, to + 1)
    .flat()
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const dataRows = mergeContinuations(rows.slice(to + 1)).filter((r) => r.length >= MIN_CELLS);
  const columns = columnRanges(dataRows, header);
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

  return { ...readRows(splitCodeAndName(table), fields, opts), headerCandidates };
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
function columnRanges(dataRows: TextItem[][], headerRow: TextItem[]): Column[] {
  const points = dataRows
    .flatMap((r, row) => r.map((i) => ({ x: i.x, row })))
    .sort((a, b) => a.x - b.x);
  if (points.length === 0) return [];

  /*
   * Agrupa las X en columnas: una X nueva abre columna si se despega de la anterior, **o si su fila
   * ya tiene un valor al lado en esta columna**. Lo segundo es lo que la hace estable: los números
   * van alineados a la derecha, así que su X de inicio baila con el ancho ("1,996.85" y "13,972.33"),
   * y encadenando por cercanía solamente, un día «Saldo» y «Cuota» quedaban en una sola columna y
   * otro día no — con el mismo formato de reporte. Dos valores de la misma fila, uno al lado del
   * otro, nunca son una sola celda. Uno ARRIBA del otro sí (una dirección partida en dos renglones):
   * esos empiezan en la misma X y no parten la columna.
   */
  const centers: number[] = [];
  let group: number[] = [points[0]!.x];
  let rowsInGroup = new Map<number, number>([[points[0]!.row, points[0]!.x]]);
  for (const p of points.slice(1)) {
    const sameRowX = rowsInGroup.get(p.row);
    const sideBySide = sameRowX !== undefined && p.x - sameRowX > STACKED_BAND;
    if (p.x - group[group.length - 1]! <= COLUMN_BAND && !sideBySide) {
      group.push(p.x);
      if (sameRowX === undefined) rowsInGroup.set(p.row, p.x);
    } else {
      centers.push(median(group));
      group = [p.x];
      rowsInGroup = new Map([[p.row, p.x]]);
    }
  }
  centers.push(median(group));

  // El corte entre dos columnas es el punto medio: reparte a mitad de camino el desalineo de una
  // fila cuyo valor arranca un poco corrido. La primera y la última se extienden hasta el borde,
  // para que ningún item quede afuera de la tabla por unos pocos píxeles.
  // Los encabezados son la CLAVE con la que después se empareja cada campo, así que tienen que ser
  // únicos. Un reporte con dos columnas "Teléfono" (una del cliente y otra del garante) es normal,
  // y sin desambiguar la segunda pisaría a la primera en el registro: el dato se perdería sin que
  // nadie lo note, que es el peor final posible para una lectura.
  const used = new Set<string>();
  return centers.map((c, i) => {
    const from = i === 0 ? -Infinity : (centers[i - 1]! + c) / 2;
    const to = i === centers.length - 1 ? Infinity : (c + centers[i + 1]!) / 2;
    const label = headerRow
      .filter((h) => h.x >= from && h.x < to)
      .map((h) => h.str)
      .join(' ')
      // Algunos generadores dejan escrito el salto de línea, a veces en dos pedazos («\» y «ncliente»): se quita del rótulo ya unido.
      .replace(/\\\s*n?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Una columna sin rótulo igual existe y puede traer el dato que al usuario le interesa; se la
    // nombra por su posición para que pueda emparejarla.
    let header = label || `Columna ${i + 1}`;
    for (let n = 2; used.has(header); n++) header = `${label} (${n})`;
    used.add(header);
    return { header, from, to };
  });
}

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}
