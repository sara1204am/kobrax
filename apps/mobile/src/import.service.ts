/**
 * Configuración de importación (Ajustes › Importación).
 *
 * El móvil NO lee archivos: los sube y dibuja lo que la API le devuelve (D-PARSER). Por eso acá
 * no hay nada de parseo — sólo el contrato con `GET/PATCH /api/imports/portfolio/config`.
 * Ver `docs/epics/F10/plans/import/FIELD-RULES.md` §6.
 */
import { apiMutate, apiQuery, type MutateResult, type QueryResult } from '@/api-client';

export type ProfileKind = 'pdf-blocks' | 'rows';
export type AbsentRule = 'set-current' | 'no-touch' | 'ask';
export type ScopeKind = 'official' | 'branch' | 'account';
export type NameOrder = 'full' | 'surnames-first' | 'split-columns';

export interface FieldRule {
  enabled?: boolean;
  required?: boolean;
  from?: string;
  in?: 'header' | 'table' | 'below';
  calibrated?: boolean;
}

export interface ImportConfig {
  source: 'manual' | 'file';
  profile: { kind: ProfileKind; signature?: string[]; recordStart?: string; tableAnchor?: string; headerRow?: number };
  fields: Record<string, FieldRule>;
  nameOrder: NameOrder;
  scope: { kind: ScopeKind; ref: string | null };
  absentRule: AbsentRule;
  carriesAssignee: boolean;
  askOnLogin: boolean;
  preset?: string;
}

export interface FieldDef {
  label: string;
  type: 'text' | 'number' | 'int' | 'date';
  starred?: boolean;
  locked?: boolean;
}

export interface ImportPreset {
  id: string;
  label: string;
  kind: ProfileKind;
  profile: ImportConfig['profile'];
  fields: Record<string, { from: string; in?: 'header' | 'table' | 'below' }>;
  daysPastDueColumn?: string;
}

export interface LastRun {
  at: string;
  template: string | null;
  scope: string | null;
  created: number;
  updated: number;
  setCurrent: number;
  errors: number;
}

export interface ConfigScreen {
  config: ImportConfig;
  catalog: Record<string, FieldDef>;
  presets: ImportPreset[];
  lastRun: LastRun | null;
}

export interface ColumnCandidate {
  header: string;
  samples: { label: string; value: number | null }[];
}

const BASE = '/api/imports/portfolio/config';

export const importService = {
  /** Todo lo que la pantalla necesita para dibujarse, en una sola llamada. */
  getConfig(): Promise<QueryResult<ConfigScreen>> {
    return apiQuery<ConfigScreen>(BASE);
  },

  /** Guarda al toque. El backend valida los invariantes y devuelve la config resultante. */
  patch(patch: Partial<ImportConfig>): Promise<MutateResult<{ config: ImportConfig }>> {
    return apiMutate<{ config: ImportConfig }>(BASE, 'PATCH', patch);
  },
};

// ── Derivados para la UI (puros, testeables sin red) ─────────────────────────

/** Los tres estados de un campo (§6.5). Un solo control, no dos toggles. */
export type FieldState = 'required' | 'optional' | 'off';

export function fieldState(rule: FieldRule | undefined): FieldState {
  if (!rule || rule.enabled === false) return 'off';
  return rule.required ? 'required' : 'optional';
}

export function applyFieldState(rule: FieldRule | undefined, state: FieldState): FieldRule {
  const from = rule?.from;
  const where = rule?.in;
  if (state === 'off') return { ...rule, enabled: false, required: false, from, in: where };
  return { ...rule, enabled: true, required: state === 'required', from, in: where };
}

export const FIELD_STATE_HINT: Record<FieldState, string> = {
  required: 'Si el archivo no lo trae, ese crédito no se importa.',
  optional: 'Si no viene, se deja como está.',
  off: 'Se ignora lo que diga el archivo.',
};

export const FIELD_STATE_LABEL: Record<FieldState, string> = {
  required: 'Obligatorio',
  optional: 'Opcional',
  off: 'No importar',
};

/**
 * Paso del asistente de primera vez (§6.9): el primer dato que falta.
 * `null` = ya está configurado, la pantalla se dibuja normal.
 */
export type SetupStep = 'source' | 'scope' | 'profile' | 'fields' | null;

export function setupStep(config: ImportConfig): SetupStep {
  if (config.source !== 'file') return 'source';
  if (config.scope.kind !== 'account' && !config.scope.ref) return 'scope';
  if (!config.profile.kind) return 'profile';
  // Sin ningún campo emparejado no hay nada que importar: falta el paso de columnas.
  if (Object.values(config.fields).every((r) => !r.from)) return 'fields';
  return null;
}

export const SETUP_STEPS: Exclude<SetupStep, null>[] = ['source', 'scope', 'profile', 'fields'];

/** "Paso 3 de 4" para la barra del asistente. */
export function setupProgress(step: SetupStep): { current: number; total: number } | null {
  if (!step) return null;
  return { current: SETUP_STEPS.indexOf(step) + 1, total: SETUP_STEPS.length };
}

export const SCOPE_LABEL: Record<ScopeKind, string> = {
  official: 'Oficial de crédito',
  branch: 'Agencia o sucursal',
  account: 'Empresa (todos)',
};

export const SCOPE_HINT: Record<ScopeKind, string> = {
  official: 'El archivo trae la cartera de un solo oficial.',
  branch: 'El archivo trae la cartera de una agencia. Sólo se reconcilia esa agencia.',
  account: 'El archivo trae toda la cartera de la empresa.',
};

export const PROFILE_LABEL: Record<ProfileKind, string> = {
  rows: 'Una fila por crédito (Excel o CSV)',
  'pdf-blocks': 'Un bloque por crédito (extracto PDF)',
};

export const ABSENT_RULE_LABEL: Record<AbsentRule, string> = {
  'set-current': 'Ponerlos al día',
  'no-touch': 'Dejarlos como están',
  ask: 'Decidir en cada importación',
};

export const ABSENT_RULE_HINT: Record<AbsentRule, string> = {
  'set-current': 'Quedan vigentes, sin días de retraso. El saldo no se toca y el crédito sigue en tu cartera.',
  'no-touch': 'No se modifican.',
  ask: 'Te muestro la lista antes de confirmar y elegís.',
};

export const NAME_ORDER_LABEL: Record<NameOrder, string> = {
  full: 'Todo junto',
  'surnames-first': 'Dos apellidos y después los nombres',
  'split-columns': 'Vienen en columnas separadas',
};

/**
 * Cómo quedaría un nombre según la regla elegida — se muestra con un nombre REAL del archivo
 * de muestra, que es lo único que deja decidir sin adivinar (§2.3). Espejo de `splitName` de la
 * API; acá es sólo para la vista previa del BottomSheet.
 */
const PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y']);

export function previewName(full: string, order: NameOrder): { lastName: string; firstName: string } {
  if (order !== 'surnames-first') return { lastName: full, firstName: '—' };
  const words = full.split(/\s+/).filter(Boolean);
  const surnames: string[] = [];
  let i = 0;
  while (i < words.length && surnames.filter((w) => !PARTICLES.has(w)).length < 2) {
    surnames.push(words[i]!);
    i++;
  }
  if (words.length < 3 || i >= words.length) return { lastName: full, firstName: '—' };
  return { lastName: surnames.join(' '), firstName: words.slice(i).join(' ') };
}

/** Fecha corta para la tarjeta de última importación: "Hoy 08:14" / "24 jul 08:14". */
export function lastRunWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Hoy ${hh}:${mm}`;
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d.getDate()} ${MES[d.getMonth()]} ${hh}:${mm}`;
}
