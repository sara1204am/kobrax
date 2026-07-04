/**
 * Motor de reconciliación de importación (puro, testeable). Empareja las filas del
 * archivo con los clientes existentes por su **blind index** del documento y decide
 * qué crear / actualizar / dar de baja, con la regla de seguridad fintech:
 * un cliente ausente del archivo pero con obligaciones activas NO se da de baja → needsReview.
 */
export type ImportMode = 'RECONCILE' | 'UPSERT_ONLY' | 'REPLACE';

export interface ImportRow {
  index: number;
  documentHash: string | null;
  data: Record<string, unknown>;
}

export interface ExistingRef {
  id: string;
  nationalIdHash: string | null;
}

export interface ImportPlan {
  toCreate: ImportRow[];
  toUpdate: { id: string; row: ImportRow }[];
  toSoftDelete: string[];
  needsReview: string[];
  invalid: { index: number; reason: string }[];
}

export function planImport(
  rows: ImportRow[],
  existing: ExistingRef[],
  opts: { mode: ImportMode; activeObligationIds: Set<string> },
): ImportPlan {
  const plan: ImportPlan = { toCreate: [], toUpdate: [], toSoftDelete: [], needsReview: [], invalid: [] };

  // Índice de existentes por hash de documento (solo los que tienen documento).
  const byHash = new Map<string, string>();
  for (const e of existing) if (e.nationalIdHash) byHash.set(e.nationalIdHash, e.id);

  const matched = new Set<string>();
  const seenInFile = new Set<string>();

  for (const row of rows) {
    if (row.documentHash) {
      if (seenInFile.has(row.documentHash)) {
        plan.invalid.push({ index: row.index, reason: 'DUP_IN_FILE' });
        continue;
      }
      seenInFile.add(row.documentHash);
      const existingId = byHash.get(row.documentHash);
      if (existingId) {
        plan.toUpdate.push({ id: existingId, row });
        matched.add(existingId);
      } else {
        plan.toCreate.push(row);
      }
    } else {
      // Sin documento no se puede emparejar/deduplicar → siempre se crea.
      plan.toCreate.push(row);
    }
  }

  // Bajas: solo en RECONCILE/REPLACE, y solo sobre existentes CON documento (clave) no emparejados.
  if (opts.mode === 'RECONCILE' || opts.mode === 'REPLACE') {
    for (const e of existing) {
      if (!e.nationalIdHash || matched.has(e.id)) continue;
      if (opts.activeObligationIds.has(e.id)) plan.needsReview.push(e.id);
      else plan.toSoftDelete.push(e.id);
    }
  }

  return plan;
}
