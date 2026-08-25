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
