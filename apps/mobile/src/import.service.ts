/**
 * Configuración de importación (Ajustes › Importación).
 *
 * El móvil NO lee archivos: los sube y dibuja lo que la API le devuelve (D-PARSER). Por eso acá
 * no hay nada de parseo — sólo el contrato con `GET/PATCH /api/imports/portfolio/config`.
 * Ver `docs/epics/F10/plans/import/FIELD-RULES.md` §6.
 */
import * as SecureStore from 'expo-secure-store';
import { apiMutate, apiQuery, refreshSession, type MutateResult, type QueryResult } from '@/api-client';
import { API_BASE } from '@/api';
import { getSession } from '@/session';

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

/** Candidatos de `scope.ref` — los devuelve el mismo GET de config (§6.4). */
export interface ScopeMember {
  id: string;
  name: string;
  role: string;
}

export interface ScopeBranch {
  id: string;
  name: string;
}

export interface ConfigScreen {
  config: ImportConfig;
  catalog: Record<string, FieldDef>;
  presets: ImportPreset[];
  lastRun: LastRun | null;
  members: ScopeMember[];
  branches: ScopeBranch[];
}

export interface ColumnCandidate {
  header: string;
  samples: { label: string; value: number | null }[];
}

// API_BASE ya termina en /api (ver `api.ts`) — acá va sólo la ruta.
const BASE = '/imports/portfolio/config';

export const importService = {
  /** Todo lo que la pantalla necesita para dibujarse, en una sola llamada. */
  getConfig(): Promise<QueryResult<ConfigScreen>> {
    return apiQuery<ConfigScreen>(BASE);
  },

  /** Guarda al toque. El backend valida los invariantes y devuelve la config resultante. */
  patch(patch: Partial<ImportConfig>): Promise<MutateResult<{ config: ImportConfig }>> {
    return apiMutate<{ config: ImportConfig }>(BASE, 'PATCH', patch);
  },

  /**
   * Sube un archivo de muestra y devuelve QUÉ trae, sin importar nada (`?columnsOnly=true`).
   * Es la pieza que hace configurable un formato que nunca vimos: el usuario sube SU archivo y
   * la app le muestra las etiquetas/columnas encontradas para que empareje (§6.5).
   */
  readColumns(file: PickedFile): Promise<FileResult<ColumnsPayload>> {
    return postFile<ColumnsPayload>('?columnsOnly=true', file);
  },

  /** Sube el archivo del día. `dryRun` = Vista Previa; sin él, se aplica. */
  run(file: PickedFile, dryRun: boolean): Promise<FileResult<PortfolioSummary>> {
    return postFile<PortfolioSummary>('', file, dryRun);
  },
};

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
}

/** Elegirlo del dispositivo: `pickImportFile()` de `@/file-picker` (aparte, y ahí está el por qué). */

export interface ColumnsPayload {
  labels: string[];
  columnCandidates: ColumnCandidate[];
}

export interface PortfolioSummary {
  dryRun: boolean;
  idempotentSkip: boolean;
  counts: { created: number; updated: number; setCurrent: number; invalid: number };
  preview: {
    toCreate: { code: string; clientName: string }[];
    toUpdate: { code: string }[];
    toSetCurrent: { code: string | null }[];
    invalid: { index: number; reason: string }[];
    warnings: { index?: number; code: string; detail?: string }[];
  };
}

export type FileResult<T> =
  | ({ status: 'ok' } & T)
  | { status: 'offline' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

/**
 * POST multipart a `/imports/portfolio`. No pasa por `apiMutate` (que serializa JSON) — mismo
 * patrón que `uploads.service.ts`, incluido el 401 → refresh → retry una vez.
 */
async function postFile<T>(query: string, file: PickedFile, dryRun?: boolean): Promise<FileResult<T>> {
  const session = await getSession();
  if (!session) return { status: 'unauthenticated' };

  const post = (token: string) => {
    const form = new FormData();
    // En React Native el file part es { uri, name, type } (no un Blob).
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? 'application/octet-stream',
    } as unknown as Blob);
    if (dryRun !== undefined) form.append('dryRun', String(dryRun));
    return fetch(`${API_BASE}/imports/portfolio${query}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-client-type': 'mobile' },
      body: form,
    });
  };

  try {
    let res = await post(session.accessToken);
    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (!refreshed) return { status: 'unauthenticated' };
      res = await post(refreshed.accessToken);
    }
    const json = (await res.json().catch(() => ({ data: null, error: null }))) as {
      data: T | null;
      error: { message: string } | null;
    };
    if (res.ok && json.data) return { status: 'ok', ...json.data };
    if (res.status === 401) return { status: 'unauthenticated' };
    return { status: 'error', message: json.error?.message ?? 'No se pudo leer el archivo' };
  } catch {
    return { status: 'offline' };
  }
}

// ── Gate post-login (§6.7) ───────────────────────────────────────────────────
// Flags locales en SecureStore, mismo patrón que `biometric.ts` (cero deps nuevas).
// Dos claves separadas a propósito: **saltar no es importar**. El gate no vuelve a molestar hoy,
// pero la app sigue sabiendo que el import está pendiente. El logout NO las borra: son estado
// operativo, no credencial.
//
// ponytail: claves globales, no por usuario — igual que los flags biométricos, que son más
// sensibles que estos. Un teléfono compartido por dos cobradores haría que el segundo no reciba
// el ofrecimiento ese día; si eso aparece de verdad, se le sufija el userId y listo.

const LAST_DAY = 'k_import_last_day';
const SKIP_DAY = 'k_import_skip_day';

const today = (now = new Date()): string =>
  `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;

export async function markImported(now = new Date()): Promise<void> {
  await SecureStore.setItemAsync(LAST_DAY, today(now));
}

export async function markImportSkipped(now = new Date()): Promise<void> {
  await SecureStore.setItemAsync(SKIP_DAY, today(now));
}

/**
 * ¿Corresponde ofrecer el import al entrar? Se decide con la config del tenant + los flags del
 * día. Puro salvo la lectura: la parte decidible se testea en `shouldOfferImport` sin red.
 */
export function decideImportGate(
  config: Pick<ImportConfig, 'source' | 'askOnLogin'>,
  flags: { lastDay: string | null; skipDay: string | null },
  now = new Date(),
): boolean {
  if (config.source !== 'file') return false; // carga a mano → el módulo no existe para este tenant
  if (!config.askOnLogin) return false; // se entra sólo por el menú (§6.7)
  const hoy = today(now);
  return flags.lastDay !== hoy && flags.skipDay !== hoy;
}

/** Versión con IO: lee la config del tenant y los flags del día. Falla cerrado (no molesta). */
export async function shouldOfferImport(now = new Date()): Promise<boolean> {
  const [lastDay, skipDay] = await Promise.all([
    SecureStore.getItemAsync(LAST_DAY),
    SecureStore.getItemAsync(SKIP_DAY),
  ]);
  // Si ya importó o saltó hoy, ni se consulta la config: es una llamada de red menos en el
  // arranque, que es justo donde el cobrador no quiere esperar.
  if (!decideImportGate({ source: 'file', askOnLogin: true }, { lastDay, skipDay }, now)) return false;
  const res = await importService.getConfig();
  if (res.status !== 'ok') return false; // sin config legible (offline, error) no se interrumpe el login
  return decideImportGate(res.data.config, { lastDay, skipDay }, now);
}

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

/** Qué se le pide al usuario después de elegir el alcance (§6.4). `null` = nada. */
export const SCOPE_REF_TITLE: Record<ScopeKind, string | null> = {
  official: 'Oficial de crédito',
  branch: 'Agencia o sucursal',
  account: null,
};

/**
 * Nombre del `scope.ref` elegido, para el subtítulo de la fila. `null` cuando el alcance no pide
 * ref (`account`); el texto de "todavía no elegiste" lo pone la pantalla.
 */
export function scopeRefName(
  scope: ImportConfig['scope'],
  members: ScopeMember[],
  branches: ScopeBranch[],
): string | null {
  if (scope.kind === 'account' || !scope.ref) return null;
  const found =
    scope.kind === 'official'
      ? members.find((m) => m.id === scope.ref)?.name
      : branches.find((b) => b.id === scope.ref)?.name;
  // Si el ref guardado ya no existe (usuario dado de baja, sucursal cerrada) se dice, en vez de
  // dibujar una fila vacía que parece configurada.
  return found ?? 'El elegido ya no está disponible';
}

/**
 * §2.4: con alcance `Empresa (todos)` y un solo miembro activo, la cartera se autoasigna a esa
 * persona y no hay paso de reparto.
 *
 * ponytail: "un solo miembro activo", no "un solo usuario con capacidad de cobrar". El rol que
 * cobra se llama distinto en cada tenant (COLLECTOR, oficial de crédito, gestor) y acá esto sólo
 * pinta un subtítulo — el autoasignado real lo decide el backend al reconciliar. Si algún día el
 * subtítulo miente en una cuenta con admin + 1 cobrador, se filtra por rol.
 */
export function soleAssignee(members: ScopeMember[]): ScopeMember | null {
  return members.length === 1 ? members[0]! : null;
}

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

/**
 * Advertencias de corrida, en palabras del usuario. Vive acá porque lo usan la Vista Previa y el
 * Resultado; el código crudo (`MORA_SIN_CONFIRMAR`) no se le muestra nunca a nadie.
 */
export const WARNING_TEXT: Record<string, string> = {
  MORA_SIN_CONFIRMAR: '⚠ Todavía no confirmaste cuál columna son los días de atraso.',
  MORA_COLUMNA_SOSPECHOSA: '⚠ Puede que la columna de días de atraso esté mal elegida.',
  MORA_INCONSISTENTE: '⚠ Hay créditos vigentes y sin cargos, pero con días de atraso.',
};

export function warningText(code: string, detail?: string): string {
  // Código desconocido = backend más nuevo que la app: se muestra crudo, no se esconde.
  return `${WARNING_TEXT[code] ?? code}${detail ? ` (${detail})` : ''}`;
}

/** Qué formatos acepta ESTE tenant — sale de la forma elegida en Ajustes, no de un literal (S3-R5). */
export const FORMAT_HINT: Record<ProfileKind, string> = {
  rows: 'Excel (.xlsx) o CSV · hasta 15 MB',
  'pdf-blocks': 'Extracto PDF · hasta 15 MB',
};

/** Cuántos ítems de una lista larga se dibujan antes de ofrecer el resto (gama baja, §9). */
export const LIST_LIMIT = 8;

/** Texto del "ver el resto", o `null` si entran todos. */
export function moreLabel(total: number, shown: number): string | null {
  return total > shown ? `Mostrar ${total - shown} más de ${total}` : null;
}

/**
 * Qué pantalla de resultado corresponde. `skipped` NO es "no pasó nada": es "este archivo ya se
 * había aplicado", y por eso llega con los conteos de aquella corrida y sin listas.
 */
export type ResultKind = 'ok' | 'warned' | 'skipped';

export function resultKind(invalid: number, idempotentSkip: boolean): ResultKind {
  if (idempotentSkip) return 'skipped';
  return invalid > 0 ? 'warned' : 'ok';
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
