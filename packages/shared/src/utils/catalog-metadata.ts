import { CatalogType } from '../enums/agenda.enum.js';
import { INCOME_CYCLES, INCOME_SOURCE_CODES } from '../enums/income.enum.js';

/**
 * Validación del `metadata` de los catálogos de F4/13.
 *
 * `catalog_items.metadata` es un JSON libre que la API aceptaba tal cual (`@IsObject`). Para los tipos nuevos el
 * contenido **decide comportamiento** (qué motivos se ofrecen, qué ciclo se propone), así que se valida acá, una
 * sola vez, para la API y para quien arme la pantalla. Los demás tipos siguen aceptando cualquier objeto.
 *
 * Devuelve `null` si es válido, o un código (no una frase: cada lado la dice en su idioma).
 */
export type CatalogMetadataError =
  | 'METADATA_NOT_OBJECT'
  | 'INCOME_SOURCE_INVALID'
  | 'CYCLE_INVALID'
  | 'SYNONYMS_INVALID'
  | 'APPLIES_TO_INVALID'
  | 'SUGGESTION_INVALID'
  | 'FLAG_INVALID';

export const CATALOG_SYNONYMS_MAX = 40;
export const CATALOG_SYNONYM_MAX_LENGTH = 60;
export const CATALOG_SUGGESTION_MAX_LENGTH = 280;

/** Banderas booleanas que puede traer un motivo de no pago. */
const REASON_FLAGS = ['asksExpectedIncomeDate', 'triggersContactUpdate', 'sensitive', 'declaredOnly'] as const;

const isIncomeSource = (v: unknown): boolean => (INCOME_SOURCE_CODES as readonly string[]).includes(String(v));

export function validateCatalogMetadata(catalog: string, metadata: unknown): CatalogMetadataError | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return 'METADATA_NOT_OBJECT';
  const m = metadata as Record<string, unknown>;

  if (catalog === CatalogType.OCCUPATION) {
    if (m.incomeSource !== undefined && !isIncomeSource(m.incomeSource)) return 'INCOME_SOURCE_INVALID';
    if (m.defaultCycle !== undefined && !(INCOME_CYCLES as readonly string[]).includes(String(m.defaultCycle))) return 'CYCLE_INVALID';
    if (m.synonyms !== undefined) {
      const s = m.synonyms;
      if (!Array.isArray(s) || s.length > CATALOG_SYNONYMS_MAX) return 'SYNONYMS_INVALID';
      if (!s.every((x) => typeof x === 'string' && x.trim().length > 0 && x.length <= CATALOG_SYNONYM_MAX_LENGTH)) return 'SYNONYMS_INVALID';
    }
    return null;
  }

  if (catalog === CatalogType.NO_PAYMENT_REASON) {
    if (m.appliesTo !== undefined) {
      const a = m.appliesTo;
      if (!Array.isArray(a) || !a.every(isIncomeSource)) return 'APPLIES_TO_INVALID';
    }
    if (m.suggestion !== undefined && (typeof m.suggestion !== 'string' || m.suggestion.length > CATALOG_SUGGESTION_MAX_LENGTH)) return 'SUGGESTION_INVALID';
    for (const flag of REASON_FLAGS) if (m[flag] !== undefined && typeof m[flag] !== 'boolean') return 'FLAG_INVALID';
    return null;
  }

  return null;
}

/**
 * Los motivos que se ofrecen para una fuente de ingreso. Un motivo sin `appliesTo` es para todos; si no se conoce
 * la fuente (`undefined`), se ofrecen todos: no se esconde una opción por falta de un dato.
 */
export function reasonsFor<T extends { metadata?: object | null }>(reasons: readonly T[], incomeSource?: string | null): T[] {
  if (!incomeSource) return [...reasons];
  return reasons.filter((r) => {
    // `object` y no `Record<string, unknown>`: el móvil tipa su metadata como una interfaz cerrada (sin firma de índice).
    const applies = (r.metadata as Record<string, unknown> | null | undefined)?.appliesTo;
    return !Array.isArray(applies) || applies.length === 0 || applies.includes(incomeSource);
  });
}
