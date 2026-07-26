/**
 * Motor de reconciliación de CARTERA por importación (puro, testeable sin DB).
 * Espejo de `clients/import/import-plan.ts`, pero con la regla de la premisa (§4 del
 * plan `docs/epics/F10/plans/import`): la llave de match es `Credit.code` (No.Credito),
 * y **NUNCA borra ni desactiva**.
 *
 *   - en archivo + existe (origin=import) → UPDATE
 *   - en archivo + no existe              → CREATE (cliente + crédito)
 *   - ausente del archivo + elegible (origin=import, en alcance) → AL DÍA
 *       (`daysPastDue=0`, `ACTIVE`, saldo intacto) — regla de ausentes = 'set-current'
 *   - crédito cargado a mano (origin≠import) → INTOCABLE
 *
 * El caller pasa TODOS los créditos de la cuenta (no solo los del alcance) porque el
 * `@@unique([accountId,code])` es account-wide: para no crear un duplicado que estalle con
 * P2002, el matching de colisión debe ver todo. El flag `eligible` (activo + en alcance)
 * distingue los que se pueden update/set-current de los que solo bloquean la creación.
 */
import { CreditOrigin } from '@kobrax/shared';

export type AbsentRule = 'set-current' | 'no-touch';

export interface PortfolioRow {
  index: number;
  code: string; // No.Credito → llave de match
  data: Record<string, unknown>; // datos parseados del bloque (cliente, montos, mora, estado…)
}

export interface ExistingCredit {
  id: string;
  code: string | null;
  origin: string; // metadata.origin del crédito ('import' | 'manual' | 'api' …)
  // El `@@unique([accountId,code])` es account-wide, así que `existing` debe cubrir TODA la cuenta
  // (todo scope, incl. borrados) para el matching de colisión. `eligible` = activo (no borrado) y
  // dentro del alcance → único candidato real a update / set-current. Un match no-elegible NO se crea
  // (violaría el unique) ni se toca → cae en `invalid`.
  eligible: boolean;
}

export interface PortfolioPlan {
  toCreate: PortfolioRow[];
  toUpdate: { id: string; row: PortfolioRow }[];
  toSetCurrent: string[]; // ids de créditos ausentes → al día
  invalid: { index: number; reason: string }[];
}

export function planPortfolioImport(
  rows: PortfolioRow[],
  existingAccount: ExistingCredit[],
  opts: { absentRule?: AbsentRule; required?: string[] } = {},
): PortfolioPlan {
  const absentRule = opts.absentRule ?? 'set-current';
  // Campos que el tenant marcó obligatorios (§3.1): sin ellos la fila no sirve. Llegan por
  // `opts` para que el motor siga siendo puro — no lee configuración, la recibe.
  const required = (opts.required ?? []).filter((f) => f !== 'code');
  const plan: PortfolioPlan = { toCreate: [], toUpdate: [], toSetCurrent: [], invalid: [] };

  // Índice de existentes por code (solo los que tienen code).
  const byCode = new Map<string, ExistingCredit>();
  for (const e of existingAccount) if (e.code) byCode.set(e.code, e);

  const matched = new Set<string>(); // ids emparejados por el archivo
  const seenInFile = new Set<string>();

  for (const row of rows) {
    const code = row.code?.trim();
    if (!code) {
      plan.invalid.push({ index: row.index, reason: 'NO_CODE' });
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
      const v = row.data[f];
      return v === undefined || v === null || v === '';
    });
    if (missing) {
      plan.invalid.push({ index: row.index, reason: `MISSING_${missing.toUpperCase()}` });
      continue;
    }

    const existing = byCode.get(code);
    if (!existing) {
      // El code no existe en NINGÚN lado de la cuenta → seguro crear (no viola el unique).
      plan.toCreate.push(row);
    } else if (existing.eligible && existing.origin === CreditOrigin.IMPORT) {
      plan.toUpdate.push({ id: existing.id, row });
      matched.add(existing.id);
    } else if (existing.origin !== CreditOrigin.IMPORT) {
      // Choca con un crédito cargado a mano: intocable y no se puede duplicar. Se reporta.
      plan.invalid.push({ index: row.index, reason: 'MATCHES_MANUAL' });
    } else {
      // Import pero fuera de alcance o borrado: no se puede crear (viola `@@unique([accountId,code])`)
      // ni tocar (está fuera del alcance de esta corrida). Se reporta en vez de crashear con P2002.
      plan.invalid.push({ index: row.index, reason: 'MATCHES_OUT_OF_SCOPE' });
    }
  }

  // Ausentes del archivo dentro del alcance: solo elegibles origin=import → al día. Nunca borrar.
  if (absentRule === 'set-current') {
    for (const e of existingAccount) {
      if (!e.eligible || e.origin !== CreditOrigin.IMPORT || matched.has(e.id)) continue;
      plan.toSetCurrent.push(e.id);
    }
  }

  return plan;
}
