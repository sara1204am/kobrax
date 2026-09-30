/**
 * Motor de reconciliación de CARTERA por importación (puro, testeable sin DB).
 *
 * La llave es la **operación externa** (D1): `(fuente, nº de operación)` → `credits.external_id`.
 * `code` es sólo el rótulo, así que un crédito cargado a mano con el mismo código ya no bloquea nada:
 * son dos créditos distintos. **Nunca borra ni desactiva.**
 *
 *   - en archivo + existe                → UPDATE (si estaba ausente, además REAPARECE)
 *   - en archivo + no existe             → CREATE (cliente según `client-match`, + crédito)
 *   - ausente del archivo + elegible     → AUSENTE (D4): `sync_status = ABSENT` en la transición.
 *       Estado y saldo intactos: faltar de un reporte de mora no dice si se puso al día o si canceló.
 *       Con la regla 'set-current' además la mora queda en 0 si el crédito sigue activo.
 *   - fila que no es un registro         → se ignora (totales y notas debajo de la tabla)
 *
 * El caller pasa TODAS las operaciones externas de la cuenta (incluidas las borradas y las de otros
 * alcances): el único parcial de la identidad las cubre a todas, y crear una que ya existe fuera del
 * alcance estallaría con P2002. `eligible` dice cuáles puede tocar esta corrida (D8).
 */
import { looksLikeOperationCode } from './field-catalog';

export type AbsentRule = 'set-current' | 'no-touch';

export interface PortfolioRow {
  index: number;
  code: string; // nº de operación, ya normalizado → llave de match
  data: Record<string, unknown>; // datos parseados de la fila (cliente, montos, mora, estado…)
}

export interface ExistingCredit {
  id: string;
  /** `credits.external_id`: el nº de operación. */
  externalId: string | null;
  /**
   * Activo (no borrado) y dentro del alcance de ESTA corrida (D8) → se puede actualizar y puede
   * quedar ausente. Un match no elegible no se crea (violaría la identidad) ni se toca → `invalid`.
   */
  eligible: boolean;
  /** Cerrado (PAID, CANCELLED, WRITTEN_OFF…): la ausencia no le cambia la mora (D4). */
  closed?: boolean;
  /** Si ya estaba ausente: la ausencia se registra en la transición, no en cada corrida. */
  syncStatus?: 'PRESENT' | 'ABSENT' | null;
}

export interface PortfolioPlan {
  toCreate: PortfolioRow[];
  toUpdate: { id: string; row: PortfolioRow; reappeared: boolean }[];
  /** Ausentes que pasan a `ABSENT` en esta corrida (la transición). */
  toMarkAbsent: string[];
  /** Ausentes activos cuya mora queda en 0 (regla 'set-current'). */
  toSetCurrent: string[];
  invalid: { index: number; reason: string }[];
  /** Filas que no son registros: totales, notas, renglones vacíos. */
  ignored: number;
}

export function planPortfolioImport(
  rows: PortfolioRow[],
  existing: ExistingCredit[],
  opts: { absentRule?: AbsentRule; required?: string[] } = {},
): PortfolioPlan {
  const absentRule = opts.absentRule ?? 'set-current';
  // Campos que el tenant marcó obligatorios (§3.1): sin ellos la fila no sirve. Llegan por
  // `opts` para que el motor siga siendo puro — no lee configuración, la recibe.
  const required = (opts.required ?? []).filter((f) => f !== 'code');
  const plan: PortfolioPlan = { toCreate: [], toUpdate: [], toMarkAbsent: [], toSetCurrent: [], invalid: [], ignored: 0 };

  const byExternalId = new Map<string, ExistingCredit>();
  for (const e of existing) if (e.externalId) byExternalId.set(e.externalId, e);

  const matched = new Set<string>();
  const seenInFile = new Set<string>();

  for (const row of rows) {
    const code = row.code?.trim();
    if (!code) {
      // Sin nº ni nombre es un renglón del pie (totales, notas): no es un registro fallado, no es nada.
      // Con nombre sí era un registro, y que le falte el número se avisa.
      if (row.data.clientLastName || row.data.clientFirstName) plan.invalid.push({ index: row.index, reason: 'NO_CODE' });
      else plan.ignored += 1;
      continue;
    }
    if (!looksLikeOperationCode(code)) {
      // "TOTALES", "Corte anterior: 28/09/2026 con 10 operaciones": texto debajo de la tabla.
      plan.ignored += 1;
      continue;
    }
    if (seenInFile.has(code)) {
      plan.invalid.push({ index: row.index, reason: 'DUP_IN_FILE' });
      continue;
    }
    seenInFile.add(code);

    // Un campo obligatorio vacío frena la fila ENTERA: o entra completa, o no entra. Importar
    // media fila deja un crédito con datos de dos días distintos, que es peor que no importarlo.
    const missing = required.find((f) => {
      // El nombre completo llega partido en apellido/nombre (`normalizeRecord`, §2.3): «Cliente»
      // obligatorio es que haya alguno de los dos. Mirar `clientName` rechazaba todas las filas.
      const v = f === 'clientName' ? (row.data.clientLastName ?? row.data.clientFirstName) : row.data[f];
      return v === undefined || v === null || v === '';
    });
    if (missing) {
      plan.invalid.push({ index: row.index, reason: `MISSING_${missing.toUpperCase()}` });
      continue;
    }

    const found = byExternalId.get(code);
    if (!found) {
      plan.toCreate.push(row);
    } else if (found.eligible) {
      plan.toUpdate.push({ id: found.id, row, reappeared: found.syncStatus === 'ABSENT' });
      matched.add(found.id);
    } else {
      // Existe pero fuera del alcance de esta corrida, o borrada: no se puede crear (la identidad ya
      // está tomada) ni tocar. Se reporta en vez de crashear con P2002.
      plan.invalid.push({ index: row.index, reason: 'MATCHES_OUT_OF_SCOPE' });
    }
  }

  // Ausentes del archivo dentro del alcance. Nunca se borra nada.
  for (const e of existing) {
    if (!e.eligible || matched.has(e.id)) continue;
    // Las dos cosas pasan una vez, en la transición: el que ya faltaba ya tiene su mora en 0.
    if (e.syncStatus === 'ABSENT') continue;
    plan.toMarkAbsent.push(e.id);
    if (absentRule === 'set-current' && !e.closed) plan.toSetCurrent.push(e.id);
  }

  return plan;
}
