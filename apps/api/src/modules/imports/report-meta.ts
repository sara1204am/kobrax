/**
 * Lo que un reporte dice **de sí mismo**, no de cada fila: a qué fecha de corte son sus números (D9)
 * y de qué asesor es (D8). Viene en el encabezado del documento ("Asesor: CQE (Cod. 1377) · Fecha de
 * corte: 28/09/2026"), así que no se empareja por columna como los demás datos.
 *
 * Funciones puras sobre renglones de texto → testeables sin PDF.
 */
import { loadItems, type TextItem } from './parsers/pdf-blocks.parser';
import { visualRows } from './parsers/pdf-rows.parser';
import type { ProfileKind } from './import-config';

export interface ReportMeta {
  /** YYYY-MM-DD. */
  reportDate?: string;
  /** Código del asesor tal como lo escribe el reporte ("CQE"). */
  advisorCode?: string;
}

/** Hasta cuántos renglones del principio se mira: el encabezado va arriba, no en la página 30. */
const HEADER_LINES = 15;

/** Sin tildes y en minúsculas: "Fecha de Corte" y "fecha de corte" son la misma etiqueta. */
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const DATE_LABEL = /(fecha\s+de\s+corte|fecha\s+de\s+reporte|fecha\s+corte|fecha\s+reporte|corte\s+al)\s*:?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/;
const ADVISOR_LABEL = /(?:asesor|oficial)\s*:?\s*([a-z0-9]{2,12})\b/;

export function readReportMeta(lines: readonly string[]): ReportMeta {
  const out: ReportMeta = {};
  for (const line of lines.slice(0, HEADER_LINES)) {
    const f = fold(line);
    if (!out.reportDate) {
      const m = DATE_LABEL.exec(f);
      if (m) {
        const [d, mo, y] = [Number(m[2]), Number(m[3]), Number(m[4])];
        const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        // Una fecha que no existe (31/02) no es una fecha de corte: mejor no tener ninguna.
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && new Date(`${iso}T00:00:00Z`).getUTCDate() === d) out.reportDate = iso;
      }
    }
    if (!out.advisorCode) {
      const m = ADVISOR_LABEL.exec(f);
      if (m) out.advisorCode = m[1]!.toUpperCase();
    }
  }
  return out;
}

/** Los renglones del principio del documento. Una planilla no trae encabezado de documento: []. */
export async function documentLines(file: Buffer, kind: ProfileKind): Promise<string[]> {
  if (kind === 'rows') return [];
  const items: TextItem[] = await loadItems(new Uint8Array(file));
  return visualRows(items)
    .slice(0, HEADER_LINES)
    .map((r) => r.map((i) => i.str).join(' '));
}
