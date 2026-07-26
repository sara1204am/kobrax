/**
 * Parser del extracto de préstamos del Banco Unión (formulario `PRR0785A`).
 * Lee el PDF por **coordenadas** (pdfjs) — no por texto plano — porque el layout es
 * de dos columnas y, sobre todo, porque la columna `Dias Mora` y `Dias Int.` caen
 * contiguas: leerlas por posición X es lo único que distingue mora real de días de interés.
 * Ver la calibración en `banco-union.calibration.spec.ts` y el riesgo R1 del plan import.
 *
 * R1 se cierra por **calibración manual**: el extracto lo emite el banco (sólo lo leemos, no
 * podemos conseguir uno con mora para un test), así que la columna de días de atraso es
 * CONFIGURABLE y el usuario la confirma viendo `columnCandidates` — los valores reales de su
 * propio archivo. Ver `docs/epics/F10/plans/import/FIELD-RULES.md` §6.5.1.
 *
 * El parser devuelve valores CRUDOS (status "VIGENTE", currency "BOLIVIANOS"): el mapeo
 * a los enums de dominio (ACTIVE / BOB) lo hace el service con la tabla de equivalencias.
 */

export interface ParsedCreditBlock {
  code: string;
  clientName: string;
  coHolder: string | null;
  status: string; // crudo, ej. "VIGENTE"
  principalAmount: number | null;
  outstandingBalance: number | null;
  interestRate: number | null;
  currency: string | null; // crudo, ej. "BOLIVIANOS"
  disbursedAt: string | null; // ISO yyyy-mm-dd
  // `null` = no se encontró la columna (layout distinto) → el service NO escribe la columna.
  // `0` = la columna existe y está en blanco, que en este formato significa "sin mora".
  // La distinción es la que evita que un import ponga toda la cartera en 0 días (§2.1 del plan).
  daysPastDue: number | null;
  pastDueAmount: number | null; // columna `Moratorios` del cuadro de movimientos
  branchLabel: string | null; // ej. "SUCRE" (cabecera MICROCREDITO AGENCIA X)
}

/** Una columna del cuadro de movimientos que podría ser "días de atraso", con valores reales. */
export interface ColumnCandidate {
  header: string; // etiqueta tal cual sale del PDF, ej. "Dias Mora"
  samples: { clientName: string; value: number | null }[];
}

export interface BancoUnionParseResult {
  template: 'banco-union-pdf';
  blocks: ParsedCreditBlock[];
  columnCandidates: ColumnCandidate[];
}

/** Columna de días de atraso por defecto. Es una SUGERENCIA: el usuario la confirma (§6.5.1). */
export const DEFAULT_DAYS_PAST_DUE_COLUMN = 'Dias Mora';

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

/** Firma de plantilla: sin esto, no es un extracto Banco Unión `PRR0785A`. */
export function isBancoUnion(items: TextItem[]): boolean {
  const text = items.map((i) => i.str).join(' ');
  return text.includes('REPORTE DE EXTRACTO DE PRESTAMOS') && text.includes('PRR0785A');
}

/** Carga el PDF y devuelve todos los items de texto con su posición (x,y,page). */
// Topes anti-DoS: un PDF de terceros (aun ≤15 MB) puede expandir a miles de páginas/items y
// bloquear el event loop (Node es single-thread → degradaría a TODOS los tenants). Un extracto
// real queda muy por debajo (~40 items por crédito).
const MAX_PAGES = 2000;
const MAX_ITEMS = 500_000;

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

export async function parseBancoUnionPdf(
  data: Uint8Array,
  opts: { daysPastDueColumn?: string } = {},
): Promise<BancoUnionParseResult> {
  const items = await loadItems(data);
  if (!isBancoUnion(items)) {
    throw new Error('NOT_BANCO_UNION_TEMPLATE');
  }
  return { template: 'banco-union-pdf', ...parseBlocks(items, opts) };
}

// ── Parseo puro sobre los items (testeable) ──────────────────────────────────

/** Orden de lectura: página asc, luego arriba→abajo (y desc), luego izq→der (x asc). */
function readingOrder(items: TextItem[]): TextItem[] {
  return [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

/** Segmenta en bloques de crédito. Delimitador: la etiqueta `Cliente` que abre cada bloque. */
export function parseBlocks(
  items: TextItem[],
  opts: { daysPastDueColumn?: string } = {},
): { blocks: ParsedCreditBlock[]; columnCandidates: ColumnCandidate[] } {
  const daysColumn = opts.daysPastDueColumn ?? DEFAULT_DAYS_PAST_DUE_COLUMN;
  const ordered = readingOrder(items);
  const starts: number[] = [];
  ordered.forEach((it, i) => {
    if (it.str === 'Cliente') starts.push(i);
  });
  const blocks: ParsedCreditBlock[] = [];
  const samples: RawSample[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : ordered.length;
    const block = ordered.slice(from, to);
    const parsed = parseOneBlock(block, items, daysColumn);
    if (!parsed) continue;
    blocks.push(parsed);
    // Muestras para la calibración manual (§6.5.1): 3 créditos alcanzan para que el usuario
    // reconozca a sus clientes y decida. Más no ayudan y engordan la respuesta.
    if (blocks.length <= CANDIDATE_SAMPLES) collectSamples(block, parsed.clientName, samples);
  }
  return { blocks, columnCandidates: buildCandidates(samples) };
}

function parseOneBlock(block: TextItem[], allItems: TextItem[], daysColumn: string): ParsedCreditBlock | null {
  const code = valueRightOf(block, (s) => s.startsWith('No.Credito'));
  if (!code) return null; // un bloque sin No.Credito no es un crédito

  const clienteLabel = block.find((i) => i.str === 'Cliente');

  return {
    code,
    clientName: valueRightOf(block, (s) => s === 'Cliente') ?? '',
    coHolder: clienteLabel ? coHolderBelow(block, clienteLabel) : null,
    status: valueRightOf(block, (s) => s === 'Estado') ?? '',
    principalAmount: num(valueRightOf(block, (s) => s === 'Monto')),
    outstandingBalance: num(valueRightOf(block, (s) => s === 'Saldo Credito')),
    interestRate: num(valueRightOf(block, (s) => s === 'Tasa Interes')),
    currency: valueRightOf(block, (s) => s === 'Moneda'),
    disbursedAt: toIso(valueRightOf(block, (s) => s.startsWith('Desembolso'))),
    daysPastDue: extractDaysPastDue(block, daysColumn),
    pastDueAmount: num(lastRowValue(block, 'Moratorios')),
    branchLabel: branchForPage(allItems, block[0]!.page),
  };
}

const Y_BAND = 6; // tolerancia vertical para asociar etiqueta↔valor en la misma "línea"

/** Valor a la derecha de una etiqueta, en la misma banda vertical. Ignora los `:` sueltos. */
function valueRightOf(items: TextItem[], labelPred: (s: string) => boolean): string | null {
  const label = items.find((i) => labelPred(i.str));
  if (!label) return null;
  const candidates = items
    .filter((i) => i !== label && Math.abs(i.y - label.y) <= Y_BAND && i.x > label.x && !/^:?$/.test(i.str))
    .sort((a, b) => a.x - b.x);
  return candidates.length > 0 ? candidates[0]!.str : null;
}

/** Co-titular: 2ª línea del bloque Cliente (misma columna, justo debajo del titular). */
function coHolderBelow(block: TextItem[], clienteLabel: TextItem): string | null {
  const nameCol = clienteLabel.x + 40; // los nombres arrancan ~x63; la etiqueta en ~x3
  const parts = block
    .filter((i) => i.y < clienteLabel.y - Y_BAND && i.y > clienteLabel.y - 20 && i.x >= nameCol && i.x < 220)
    .sort((a, b) => a.x - b.x);
  const text = parts.map((p) => p.str).join(' ').trim();
  return text === '' ? null : text;
}

// ── Cuadro de movimientos: columnas por coordenada ───────────────────────────
// Los encabezados ocupan 2-3 renglones ("Dias"/"Mora" apilados en la misma X) y los valores
// vienen alineados a la derecha, así que una columna es un RANGO de X, no una X exacta.

const HEADER_ANCHOR = 'Capital'; // primera etiqueta del renglón superior del cuadro
const HEADER_BAND = 16; // alto del bloque de encabezados (3 renglones)
const X_GROUP = 8; // dos etiquetas a menos de esto son el mismo encabezado apilado
const COL_PAD = 12; // los valores arrancan un poco a la izquierda de su etiqueta
const CANDIDATE_SAMPLES = 3;

interface MovementColumn {
  header: string;
  from: number; // x mínimo inclusive
  to: number; // x máximo exclusivo (Infinity en la última)
}

/**
 * Columnas del cuadro de movimientos, con su rango de X. Se ancla en `Capital` (renglón
 * superior); todo lo que está debajo del bloque de encabezados son filas de movimiento.
 */
export function movementColumns(block: TextItem[]): MovementColumn[] {
  const anchor = block.find((i) => i.str === HEADER_ANCHOR);
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

/** Y por debajo del cual empiezan las filas de movimiento. */
function dataTop(block: TextItem[]): number | null {
  const anchor = block.find((i) => i.str === HEADER_ANCHOR);
  return anchor ? anchor.y - HEADER_BAND : null;
}

/**
 * Valor de una columna en la ÚLTIMA fila de movimiento (la más reciente).
 * `null` = no existe esa columna en el cuadro. `''` = existe y está en blanco.
 */
function lastRowValue(block: TextItem[], header: string): string | null {
  const top = dataTop(block);
  const col = movementColumns(block).find((c) => c.header === header);
  if (top === null || !col) return null;
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

/**
 * Días de atraso de la ÚLTIMA fila de movimiento, leídos de la columna `header`.
 *
 * ⚠️ R1: `Dias Mora` y `Dias Int.` caen contiguas en el cuadro, y con el único extracto de
 * muestra (VIGENTE, sin mora) ningún test puede distinguirlas — leer la equivocada daría el
 * mismo 0. Por eso la columna es un PARÁMETRO y no una constante: el usuario la confirma en
 * Ajustes viendo `columnCandidates` (FIELD-RULES §6.5.1). `Dias Mora` es sólo la sugerencia.
 *
 * `null` = la columna no está en el cuadro (layout distinto al esperado) → el service NO
 * escribe `days_past_due`. Blanco → 0: en este formato el banco no imprime nada cuando no
 * hay mora, así que la columna en blanco SÍ es un cero leído.
 */
export function extractDaysPastDue(block: TextItem[], header = DEFAULT_DAYS_PAST_DUE_COLUMN): number | null {
  const raw = lastRowValue(block, header);
  if (raw === null) return null;
  if (raw === '') return 0;
  return /^\d{1,4}$/.test(raw) ? Number(raw) : null;
}

interface RawSample {
  header: string;
  clientName: string;
  raw: string;
}

function collectSamples(block: TextItem[], clientName: string, into: RawSample[]): void {
  for (const col of movementColumns(block)) {
    const raw = lastRowValue(block, col.header);
    if (raw !== null) into.push({ header: col.header, clientName, raw });
  }
}

/**
 * Columnas que podrían ser "días de atraso", con valores reales para que el usuario elija.
 * Filtro: sólo columnas cuyos valores son enteros de 1-4 dígitos (o que están en blanco, como
 * `Dias Mora` en un extracto sin mora — que es justamente la que hay que poder elegir).
 * Deja afuera montos (tienen decimales), fechas, códigos largos y textos.
 */
function buildCandidates(samples: RawSample[]): ColumnCandidate[] {
  const isDayLike = (raw: string): boolean => raw === '' || /^\d{1,4}$/.test(raw);
  const out: ColumnCandidate[] = [];
  for (const s of samples) {
    if (!samples.every((o) => o.header !== s.header || isDayLike(o.raw))) continue;
    let col = out.find((c) => c.header === s.header);
    if (!col) out.push((col = { header: s.header, samples: [] }));
    col.samples.push({ clientName: s.clientName, value: s.raw === '' ? null : Number(s.raw) });
  }
  return out;
}

/** Sucursal/agencia de la página: cabecera "MICROCREDITO AGENCIA <X>". */
function branchForPage(items: TextItem[], page: number): string | null {
  const header = items.find((i) => i.page === page && i.str.includes('AGENCIA'));
  const m = header ? /AGENCIA\s+(.+)$/.exec(header.str) : null;
  return m ? m[1]!.trim() : null;
}

/** "859,743.98" → 859743.98 · "( 4,767.67)" → -4767.67 · "7.00 %" → 7. */
function num(s: string | null): number | null {
  if (!s) return null;
  let t = s.replace(/%/g, '').trim();
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/,/g, '').replace(/\s/g, '');
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

/** "27/06/2024" (dd/mm/yyyy) → "2024-06-27". Sin `Date` (evita corrimientos de TZ). */
function toIso(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
