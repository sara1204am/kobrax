/**
 * Parser del extracto de préstamos del Banco Unión (formulario `PRR0785A`).
 * Lee el PDF por **coordenadas** (pdfjs) — no por texto plano — porque el layout es
 * de dos columnas y, sobre todo, porque la columna `Dias Mora` y `Dias Int.` caen
 * contiguas: leerlas por posición X es lo único que distingue mora real de días de interés.
 * Ver la calibración en `banco-union.calibration.test.ts` y el riesgo R1 del plan import.
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
  daysPastDue: number; // columna Dias Mora (0 si la columna está vacía)
  branchLabel: string | null; // ej. "SUCRE" (cabecera MICROCREDITO AGENCIA X)
}

export interface BancoUnionParseResult {
  template: 'banco-union-pdf';
  blocks: ParsedCreditBlock[];
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

export async function parseBancoUnionPdf(data: Uint8Array): Promise<BancoUnionParseResult> {
  const items = await loadItems(data);
  if (!isBancoUnion(items)) {
    throw new Error('NOT_BANCO_UNION_TEMPLATE');
  }
  return { template: 'banco-union-pdf', blocks: parseBlocks(items) };
}

// ── Parseo puro sobre los items (testeable) ──────────────────────────────────

/** Orden de lectura: página asc, luego arriba→abajo (y desc), luego izq→der (x asc). */
function readingOrder(items: TextItem[]): TextItem[] {
  return [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

/** Segmenta en bloques de crédito. Delimitador: la etiqueta `Cliente` que abre cada bloque. */
export function parseBlocks(items: TextItem[]): ParsedCreditBlock[] {
  const ordered = readingOrder(items);
  const starts: number[] = [];
  ordered.forEach((it, i) => {
    if (it.str === 'Cliente') starts.push(i);
  });
  const blocks: ParsedCreditBlock[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : ordered.length;
    const block = ordered.slice(from, to);
    const parsed = parseOneBlock(block, items);
    if (parsed) blocks.push(parsed);
  }
  return blocks;
}

function parseOneBlock(block: TextItem[], allItems: TextItem[]): ParsedCreditBlock | null {
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
    daysPastDue: extractDaysPastDue(block),
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

/**
 * daysPastDue = columna `Dias Mora` (la más a la derecha del cuadro de movimientos).
 * Se ubica por la X del encabezado `Mora` y se leen solo enteros en esa columna, de la
 * ÚLTIMA fila de movimiento. Si no hay ningún valor en esa X → 0 (columna vacía = sin mora).
 * ⚠️ CALIBRACIÓN R1: la muestra disponible está VIGENTE (mora 0). Confirmar con un extracto
 * con mora real que un valor real cae bajo esta X y no bajo `Dias Int.` (x muy a la izquierda).
 */
export function extractDaysPastDue(block: TextItem[]): number {
  const moraHeader = block.find((i) => i.str === 'Mora');
  if (!moraHeader) return 0;
  const COL_TOL = 12; // la columna Mora es la última: aceptamos solo lo que cae en/ a la derecha de su X
  const threshold = moraHeader.x - COL_TOL;
  const candidates = block
    .filter((i) => i.y < moraHeader.y - Y_BAND && i.x >= threshold && /^\d{1,4}$/.test(i.str))
    .sort((a, b) => a.y - b.y); // última fila de movimiento = y más chico
  return candidates.length > 0 ? Number(candidates[0]!.str) : 0;
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
