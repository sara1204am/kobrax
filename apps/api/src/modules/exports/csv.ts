/** Una celda de CSV: comillada sólo si hace falta (coma, comilla o salto de línea adentro). */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const BOM = String.fromCharCode(0xfeff);

/**
 * Serializa filas a CSV, sin dependencias. El BOM inicial es lo que hace que Excel en Windows
 * abra los acentos bien en vez de mostrar «Contrase\xF1a» — sin él, asume Latin-1.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${BOM}${header}\n${body}\n`;
}

/** El BOM + la cabecera: el primer tramo de un CSV que se escribe por partes. */
export function csvHeader(columns: string[]): string {
  return BOM + columns.map(csvCell).join(',') + '\n';
}

/** Sólo las filas, cada una terminada en salto de línea: los tramos siguientes de un CSV por partes. */
export function csvRows(rows: Record<string, unknown>[], columns: string[]): string {
  return rows.map((r) => columns.map((c) => csvCell(r[c])).join(',') + '\n').join('');
}

/**
 * Un texto que viene de afuera (un nombre importado, una nota) y va a una celda: si empieza con "=", "+",
 * "-" o "@", Excel lo ejecuta como fórmula. Se le antepone una comilla simple, que Excel muestra como texto.
 * No se aplica a números ni a fechas: sólo a lo que alguien pudo escribir.
 */
export function csvSafeText(v: string | undefined): string {
  if (!v) return '';
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
