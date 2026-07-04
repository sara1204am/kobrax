/**
 * Parser CSV mínimo pero correcto (campos entre comillas, comas y saltos de línea
 * dentro de comillas, comillas escapadas `""`). Devuelve un array de objetos usando
 * la primera fila como cabecera. Suficiente para padrones de clientes; sin dependencias.
 */
export function parseCsv(content: string): Record<string, string>[] {
  const rows = parseRows(content);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== '')) // ignora líneas vacías
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()));
      return obj;
    });
}

/** Tokeniza el CSV en filas de celdas, respetando comillas. */
function parseRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = content.replace(/\r\n?/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  // Última celda/fila (si el archivo no termina en \n).
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
