/**
 * Motor de lectura de PDFs con **un bloque por registro** (extractos de préstamos).
 *
 * GENÉRICO A PROPÓSITO: este archivo no sabe de ningún banco. Todo lo específico de un
 * formato —qué etiqueta abre un registro, cómo se llama cada campo, dónde está el cuadro de
 * columnas— llega por parámetro (`PdfBlocksProfile` + `FieldMap`), y esos parámetros son
 * DATOS de `importConfig`, no código. Sumar un formato nuevo = configurarlo en la app.
 * Ver `docs/epics/F10/plans/import/FIELD-RULES.md` §1 y §4 (C12).
 *
 * Lee por **coordenadas** (pdfjs), no por texto plano: el layout es de dos columnas y hay
 * columnas contiguas que sólo la posición X distingue (ej. días de interés vs días de mora).
 *
 * Devuelve valores CRUDOS (strings tal cual salen del PDF). Normalizar a los tipos del dominio
 * es responsabilidad del catálogo de campos, no del motor.
 */

export interface PdfBlocksProfile {
  /** Textos que deben aparecer en el archivo. Vacío/ausente = no se valida (§4.2). */
  signature?: string[];
  /** Etiqueta que ABRE cada registro. Es lo que corta el PDF en bloques. */
  recordStart: string;
  /** Primera etiqueta del cuadro de columnas, si el formato tiene uno. */
  tableAnchor?: string;
}

/** Dónde buscar el valor de un campo dentro del bloque. */
export type FieldWhere =
  | 'header' // etiqueta → valor a la derecha (lo habitual)
  | 'table' // columna del cuadro, última fila (el movimiento más reciente)
  | 'below'; // el renglón de abajo, misma columna (ej. un co-titular)

export interface FieldSource {
  from: string; // la etiqueta/encabezado TAL CUAL aparece en el archivo
  in?: FieldWhere; // default: 'header'
}

/** campo canónico (§2) → de dónde sale. Es `importConfig.fields`, sin los flags de UI. */
export type FieldMap = Record<string, FieldSource>;

/** Una columna del cuadro que podría ser "días de atraso", con valores reales (§6.5.1). */
export interface ColumnCandidate {
  header: string;
  samples: { label: string; value: number | null }[];
}

export interface PdfBlocksResult {
  /** Un registro por bloque: campo canónico → valor crudo. */
  records: Record<string, string | null>[];
  /** Etiquetas de cabecera detectadas en el archivo — la lista para emparejar (§6.5). */
  labels: string[];
  /** Columnas del cuadro que parecen días, con muestras reales para calibrar (§6.5.1). */
  columnCandidates: ColumnCandidate[];
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  page: number;
}

// pdfjs v6 es ESM-only; el runtime de la API es CommonJS (tsc→require).
// `new Function` preserva un import() nativo que tsc NO reescribe a require().
// ponytail: si algún día la API pasa a ESM, esto se vuelve un import estático normal.
type PdfjsModule = {
  getDocument(src: { data: Uint8Array; useSystemFonts?: boolean }): { promise: Promise<PdfDoc> };
};
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage> };
type PdfPage = { getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[] }> }> };
const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<PdfjsModule>;

// Topes anti-DoS: un PDF de terceros (aun ≤15 MB) puede expandir a miles de páginas/items y
// bloquear el event loop (Node es single-thread → degradaría a TODOS los tenants). Un extracto
// real queda muy por debajo (~40 items por crédito).
const MAX_PAGES = 2000;
const MAX_ITEMS = 500_000;

const Y_BAND = 6; // tolerancia vertical para considerar dos items "en la misma línea"
const LABEL_GAP = 35; // hasta acá se extiende una etiqueta hacia la izquierda ("Fecha Desembolso")
const CANDIDATE_SAMPLES = 3;

/** Carga el PDF y devuelve todos los items de texto con su posición (x,y,page). */
export async function loadItems(data: Uint8Array): Promise<TextItem[]> {
  const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  if (doc.numPages > MAX_PAGES) throw new Error(`PDF_TOO_MANY_PAGES (${doc.numPages})`);
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      const str = (it.str ?? '').trim();
      if (str === '' || !it.transform) continue;
      items.push({ str, x: Math.round(it.transform[4]!), y: Math.round(it.transform[5]!), page: p });
      if (items.length > MAX_ITEMS) throw new Error('PDF_TOO_MANY_ITEMS');
    }
  }
  return items;
}

/**
 * ¿El archivo trae los textos que el perfil espera? Sin `signature` no valida nada —
 * es opcional a propósito: exigirla convertiría cada formato nuevo en un pedido de soporte.
 */
export function matchesSignature(items: TextItem[], signature?: string[]): boolean {
  if (!signature || signature.length === 0) return true;
  const text = items.map((i) => i.str).join(' ');
  return signature.every((s) => text.includes(s));
}

export async function parsePdfBlocks(
  data: Uint8Array,
  profile: PdfBlocksProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): Promise<PdfBlocksResult> {
  const items = await loadItems(data);
  if (!matchesSignature(items, profile.signature)) throw new Error('SIGNATURE_MISMATCH');
  return readBlocks(items, profile, fields, opts);
}

// ── Parseo puro sobre los items (testeable sin PDF) ──────────────────────────

/** Orden de lectura: página asc, luego arriba→abajo (y desc), luego izq→der (x asc). */
function readingOrder(items: TextItem[]): TextItem[] {
  return [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

export function readBlocks(
  items: TextItem[],
  profile: PdfBlocksProfile,
  fields: FieldMap,
  opts: { labelField?: string } = {},
): PdfBlocksResult {
  const ordered = readingOrder(items);
  const starts: number[] = [];
  ordered.forEach((it, i) => {
    if (it.str === profile.recordStart) starts.push(i);
  });

  const records: Record<string, string | null>[] = [];
  const labels = new Set<string>();
  const samples: RawSample[] = [];

  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : ordered.length;
    const block = ordered.slice(from, to);

    const record: Record<string, string | null> = {};
    for (const [canonical, src] of Object.entries(fields)) {
      record[canonical] = readField(block, profile, src);
    }
    // Un bloque del que no se pudo sacar NINGÚN valor no es un registro (cabecera, pie, ruido).
    if (Object.values(record).every((v) => v === null || v === '')) continue;
    records.push(record);

    for (const l of detectLabels(block)) labels.add(l);
    // Muestras para la calibración manual (§6.5.1): 3 registros alcanzan para que el usuario
    // reconozca sus datos y decida. Más no ayudan y engordan la respuesta.
    if (records.length <= CANDIDATE_SAMPLES) {
      const label = record[opts.labelField ?? 'clientName'] ?? record.code ?? '';
      collectSamples(block, profile, label, samples);
    }
  }

  return { records, labels: [...labels].sort(), columnCandidates: buildCandidates(samples) };
}

function readField(block: TextItem[], profile: PdfBlocksProfile, src: FieldSource): string | null {
  switch (src.in ?? 'header') {
    case 'table':
      return lastRowValue(block, profile, src.from);
    case 'below':
      return valueBelow(block, src.from);
    default:
      return valueRightOf(block, src.from);
  }
}

// ── Etiquetas de cabecera ────────────────────────────────────────────────────
// En estos PDFs una etiqueta es el texto a la izquierda de un `:`. El `:` a veces es un item
// suelto (`Cliente` `:`) y a veces viene pegado (`No.Credito:`), y la etiqueta puede estar
// partida en varios items (`Fecha` `Desembolso:`). Se resuelve por cercanía en X.

interface LabelAnchor {
  label: string;
  anchor: TextItem; // el item que lleva el `:`
}

function labelAnchors(block: TextItem[]): LabelAnchor[] {
  const out: LabelAnchor[] = [];
  for (const it of block) {
    if (!it.str.endsWith(':')) continue;
    const own = it.str.slice(0, -1).trim();
    const parts: string[] = own === '' ? [] : [own];
    if (own === '') {
      // `:` suelto → la etiqueta son los items pegados a su izquierda, en la misma línea.
      const left = block
        .filter((o) => o !== it && Math.abs(o.y - it.y) <= Y_BAND && o.x < it.x)
        .sort((a, b) => b.x - a.x);
      let edge = it.x;
      for (const l of left) {
        if (parts.length > 0 && edge - l.x > LABEL_GAP) break;
        parts.unshift(l.str);
        edge = l.x;
        if (parts.length >= 4) break; // una etiqueta no tiene más de 4 palabras sueltas
      }
    } else {
      // `Desembolso:` → puede venir precedido de `Fecha` a pocos px.
      const left = block
        .filter((o) => Math.abs(o.y - it.y) <= Y_BAND && o.x < it.x)
        .sort((a, b) => b.x - a.x);
      let edge = it.x;
      for (const l of left) {
        if (edge - l.x > LABEL_GAP) break;
        parts.unshift(l.str);
        edge = l.x;
      }
    }
    const label = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (label !== '') out.push({ label, anchor: it });
  }
  return out;
}

/** Etiquetas que el archivo ofrece para emparejar (§6.5). */
export function detectLabels(block: TextItem[]): string[] {
  return labelAnchors(block).map((a) => a.label);
}

/** Valor a la derecha de una etiqueta, en la misma banda vertical. */
function valueRightOf(block: TextItem[], label: string): string | null {
  const found = labelAnchors(block).find((a) => a.label === label);
  if (!found) return null;
  const right = block
    .filter(
      (i) => i !== found.anchor && Math.abs(i.y - found.anchor.y) <= Y_BAND && i.x > found.anchor.x && !/^:?$/.test(i.str),
    )
    .sort((a, b) => a.x - b.x);
  return right.length > 0 ? right[0]!.str : null;
}

/**
 * El renglón de abajo, en la MISMA COLUMNA QUE EL VALOR (ej. un co-titular bajo el titular).
 * La ventana arranca en la x del valor —no en la de la etiqueta— y es angosta: si arrancara en
 * el `:` se comería la etiqueta de la columna de al lado del layout de dos columnas.
 */
const BELOW_WIDTH = 150;

function valueBelow(block: TextItem[], label: string): string | null {
  const found = labelAnchors(block).find((a) => a.label === label);
  if (!found) return null;
  const value = block
    .filter((i) => Math.abs(i.y - found.anchor.y) <= Y_BAND && i.x > found.anchor.x && !/^:?$/.test(i.str))
    .sort((a, b) => a.x - b.x)[0];
  if (!value) return null;
  const parts = block
    .filter(
      (i) =>
        i.y < found.anchor.y - Y_BAND &&
        i.y > found.anchor.y - 20 &&
        i.x >= value.x - 4 &&
        i.x < value.x + BELOW_WIDTH,
    )
    .sort((a, b) => a.x - b.x);
  const text = parts.map((p) => p.str).join(' ').trim();
  return text === '' ? null : text;
}

// ── Cuadro de columnas ───────────────────────────────────────────────────────
// Los encabezados ocupan 2-3 renglones ("Dias"/"Mora" apilados en la misma X) y los valores
// vienen alineados a la derecha, así que una columna es un RANGO de X, no una X exacta.

const HEADER_BAND = 16; // alto del bloque de encabezados
const X_GROUP = 8; // dos etiquetas a menos de esto son el mismo encabezado apilado
const COL_PAD = 12; // los valores arrancan un poco a la izquierda de su etiqueta

interface MovementColumn {
  header: string;
  from: number; // x mínimo inclusive
  to: number; // x máximo exclusivo (Infinity en la última)
}

/** Columnas del cuadro, con su rango de X. Se ancla en `profile.tableAnchor`. */
export function movementColumns(block: TextItem[], profile: PdfBlocksProfile): MovementColumn[] {
  if (!profile.tableAnchor) return [];
  const anchor = block.find((i) => i.str === profile.tableAnchor);
  if (!anchor) return [];
  const heads = block
    .filter((i) => i.y <= anchor.y && i.y > anchor.y - HEADER_BAND)
    .sort((a, b) => a.x - b.x || b.y - a.y);

  const groups: { x: number; parts: TextItem[] }[] = [];
  for (const h of heads) {
    const last = groups[groups.length - 1];
    if (last && h.x - last.x <= X_GROUP) last.parts.push(h);
    else groups.push({ x: h.x, parts: [h] });
  }

  return groups.map((g, i) => ({
    header: g.parts
      .sort((a, b) => b.y - a.y) // de arriba hacia abajo: "Dias" + "Mora"
      .map((p) => p.str)
      .join(' '),
    from: g.x - COL_PAD,
    to: i + 1 < groups.length ? groups[i + 1]!.x - COL_PAD : Infinity,
  }));
}

/**
 * Valor de una columna en la ÚLTIMA fila del cuadro (el movimiento más reciente).
 * `null` = esa columna no existe. `''` = existe y está en blanco — la distinción importa:
 * ver el comentario de `days-past-due` en el catálogo de campos.
 */
export function lastRowValue(block: TextItem[], profile: PdfBlocksProfile, header: string): string | null {
  if (!profile.tableAnchor) return null;
  const anchor = block.find((i) => i.str === profile.tableAnchor);
  const col = movementColumns(block, profile).find((c) => c.header === header);
  if (!anchor || !col) return null;
  const top = anchor.y - HEADER_BAND;
  const rows = block
    .filter((i) => i.y < top && i.x >= col.from && i.x < col.to)
    .sort((a, b) => a.y - b.y); // y más chico = fila más abajo = movimiento más reciente
  if (rows.length === 0) return '';
  const y = rows[0]!.y;
  return rows
    .filter((r) => Math.abs(r.y - y) <= Y_BAND)
    .sort((a, b) => a.x - b.x)
    .map((r) => r.str)
    .join('')
    .trim();
}

interface RawSample {
  header: string;
  label: string;
  raw: string;
}

function collectSamples(block: TextItem[], profile: PdfBlocksProfile, label: string, into: RawSample[]): void {
  for (const col of movementColumns(block, profile)) {
    const raw = lastRowValue(block, profile, col.header);
    if (raw !== null) into.push({ header: col.header, label, raw });
  }
}

/**
 * Columnas que podrían ser "días de atraso", con valores reales para que el usuario elija.
 * Filtro: sólo columnas cuyos valores son enteros de 1-4 dígitos, o que están en blanco —
 * una columna de mora vacía (extracto sin mora) es justamente la que hay que poder elegir.
 * Deja afuera montos (tienen decimales), fechas, códigos largos y textos.
 */
function buildCandidates(samples: RawSample[]): ColumnCandidate[] {
  const isDayLike = (raw: string): boolean => raw === '' || /^\d{1,4}$/.test(raw);
  const out: ColumnCandidate[] = [];
  for (const s of samples) {
    if (!samples.every((o) => o.header !== s.header || isDayLike(o.raw))) continue;
    let col = out.find((c) => c.header === s.header);
    if (!col) out.push((col = { header: s.header, samples: [] }));
    col.samples.push({ label: s.label, value: s.raw === '' ? null : Number(s.raw) });
  }
  return out;
}
