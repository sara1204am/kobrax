/**
 * Configuración de importación (Ajustes › Importación).
 *
 * El móvil NO lee archivos: los sube y dibuja lo que la API le devuelve (D-PARSER). Por eso acá
 * no hay nada de parseo — sólo el contrato con `GET/PATCH /api/imports/portfolio/config`.
 * Ver `docs/epics/F10/plans/import/FIELD-RULES.md` §6.
 */
import * as SecureStore from 'expo-secure-store';
import { apiMutate, apiQuery, refreshSession, type MutateResult, type QueryResult } from '@/api-client';
import { postMultipart, uploadFailure } from '@/api';
import { getSession } from '@/session';
import type {
  AbsentRule,
  ColumnsPayload,
  ConfigScreen,
  FieldState,
  ImportConfig,
  ImportConfigPatch,
  NameOrder,
  PortfolioSummary,
  ProfileKind,
  ScopeBranch,
  ScopeKind,
  ScopeMember,
} from '@kobrax/shared';

/**
 * El contrato del import y sus derivados puros viven en `packages/shared`: los consumen el móvil
 * y el panel web, y una segunda copia acá haría que el escritorio y el teléfono dijeran cosas
 * distintas sobre la misma cartera (BUILD-PLAN F9 §3.9).
 *
 * Se re-exportan para que las pantallas sigan importando de un solo lado.
 */
export { applyFieldState, fieldState, previewName, resultKind, setupStep, soleAssignee } from '@kobrax/shared';
export type {
  AbsentRule,
  ColumnCandidate,
  ColumnsPayload,
  ConfigScreen,
  FieldDef,
  FieldRule,
  FieldState,
  ImportConfig,
  ImportConfigPatch,
  LastRun,
  NameOrder,
  PortfolioSummary,
  ProfileKind,
  ResultKind,
  ScopeBranch,
  ScopeKind,
  ScopeMember,
  SetupStep,
} from '@kobrax/shared';

// API_BASE ya termina en /api (ver `api.ts`) — acá va sólo la ruta.
const BASE = '/imports/portfolio/config';

export const importService = {
  /** Todo lo que la pantalla necesita para dibujarse, en una sola llamada. */
  getConfig(): Promise<QueryResult<ConfigScreen>> {
    return apiQuery<ConfigScreen>(BASE);
  },

  /**
   * Guarda al toque. El backend valida los invariantes y devuelve la config resultante.
   * Un campo en `null` se **quita** del emparejado (apagarlo lo deja en la lista; quitarlo, no).
   */
  patch(patch: ImportConfigPatch): Promise<MutateResult<{ config: ImportConfig }>> {
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
    return postMultipart(`/imports/portfolio${query}`, form, token);
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
  } catch (e) {
    return uploadFailure(e);
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
const SAMPLE = 'k_import_sample';

// ── Archivo de muestra recordado ─────────────────────────────────────────────

/**
 * El archivo de muestra queda a mano entre visitas a Ajustes: emparejar columnas son varias
 * pasadas, y volver a buscarlo en Drive en cada una es el trabajo aburrido que el teléfono puede
 * ahorrar.
 *
 * Se guarda la RUTA, no el contenido: el picker ya dejó una copia en el cache de la app
 * (`copyToCacheDirectory`), así que el archivo YA está en el teléfono; guardar los bytes sería
 * duplicar lo que está al lado. El precio es que el sistema puede limpiar ese cache cuando
 * necesita espacio y dejar la ruta muerta — no hay forma de saberlo sin intentar leerla, así que
 * quien la use tiene que estar listo para que falle y llamar a `forgetSampleFile()`.
 */
export async function rememberSampleFile(file: PickedFile): Promise<void> {
  await SecureStore.setItemAsync(SAMPLE, JSON.stringify(file));
}

export async function recallSampleFile(): Promise<PickedFile | null> {
  const raw = await SecureStore.getItemAsync(SAMPLE);
  if (!raw) return null;
  try {
    const file = JSON.parse(raw) as PickedFile;
    return file?.uri && file?.name ? file : null;
  } catch {
    return null; // guardado a medias o de una versión vieja: se descarta, no se rompe la pantalla
  }
}

export async function forgetSampleFile(): Promise<void> {
  await SecureStore.deleteItemAsync(SAMPLE);
}

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

export const FIELD_STATE_META: Record<FieldState, { label: string; hint: string }> = {
  required: { label: 'Obligatorio', hint: 'Si el archivo no lo trae, ese crédito no se importa.' },
  optional: { label: 'Opcional', hint: 'Si no viene, se deja como está.' },
  off: { label: 'No importar', hint: 'Se ignora lo que diga el archivo.' },
};

/**
 * Todo lo que la pantalla dice de un alcance, en una sola entrada. `refTitle` es qué se le pide
 * después de elegirlo (§6.4); `null` = nada, el alcance ya está completo.
 */
export const SCOPE_META: Record<ScopeKind, { label: string; hint: string; refTitle: string | null }> = {
  official: {
    label: 'Oficial de crédito',
    hint: 'El archivo trae la cartera de un solo oficial.',
    refTitle: 'Oficial de crédito',
  },
  branch: {
    label: 'Agencia o sucursal',
    hint: 'El archivo trae la cartera de una agencia. Sólo se reconcilia esa agencia.',
    refTitle: 'Agencia o sucursal',
  },
  account: {
    label: 'Empresa (todos)',
    hint: 'El archivo trae toda la cartera de la empresa.',
    refTitle: null,
  },
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
 * Todo lo que se dice de una forma de archivo, en una entrada.
 *
 * `label` describe cómo está dispuesto el dato y no la extensión: el usuario reconoce su archivo
 * por cómo se ve. `hint` da el ejemplo, que desambigua mejor que cualquier definición. `format` es
 * lo que se le pide al momento de subir, y nombra las dos extensiones que la API lee de verdad:
 * `parseRowsFile` decide por los bytes (`PK\x03\x04` → Excel, si no CSV). El `.xls` de 97-2003 se
 * rechaza a propósito y con el arreglo adentro del mensaje, así que no se nombra acá.
 */
export const PROFILE_META: Record<ProfileKind, { label: string; hint: string; format: string }> = {
  rows: {
    label: 'Una fila por crédito (CSV o Excel)',
    hint: 'Una planilla o un archivo de texto separado por comas.',
    format: 'CSV o Excel (.xlsx) · hasta 15 MB',
  },
  'pdf-rows': {
    label: 'Una tabla adentro de un PDF',
    hint: 'Un reporte con encabezados arriba y una fila por crédito.',
    format: 'Reporte PDF con una tabla · hasta 15 MB',
  },
  'pdf-blocks': {
    label: 'Un bloque por crédito (extracto PDF)',
    hint: 'Un extracto donde cada crédito ocupa su propio bloque, con etiquetas y dos puntos.',
    format: 'Extracto PDF · hasta 15 MB',
  },
};

export const ABSENT_RULE_META: Record<AbsentRule, { label: string; hint: string }> = {
  'set-current': {
    label: 'Ponerlos al día',
    hint: 'Quedan vigentes, sin días de retraso. El saldo no se toca y el crédito sigue en tu cartera.',
  },
  'no-touch': { label: 'Dejarlos como están', hint: 'No se modifican.' },
  ask: { label: 'Decidir en cada importación', hint: 'Te muestro la lista antes de confirmar y elegís.' },
};

export const NAME_ORDER_LABEL: Record<NameOrder, string> = {
  full: 'Todo junto',
  'surnames-first': 'Dos apellidos y después los nombres',
  'split-columns': 'Vienen en columnas separadas',
};

/**
 * Advertencias de corrida, en palabras del usuario. Vive acá porque lo usan la Vista Previa y el
 * Resultado; el código crudo (`MORA_SIN_CONFIRMAR`) no se le muestra nunca a nadie.
 */
const WARNING_TEXT: Record<string, string> = {
  MORA_SIN_CONFIRMAR: '⚠ Todavía no confirmaste cuál columna son los días de atraso.',
  MORA_COLUMNA_SOSPECHOSA: '⚠ Puede que la columna de días de atraso esté mal elegida.',
  MORA_INCONSISTENTE: '⚠ Hay créditos vigentes y sin cargos, pero con días de atraso.',
};

export function warningText(code: string, detail?: string): string {
  // Código desconocido = backend más nuevo que la app: se muestra crudo, no se esconde.
  return `${WARNING_TEXT[code] ?? code}${detail ? ` (${detail})` : ''}`;
}

/**
 * Por qué un registro quedó afuera, en palabras del usuario. `NO_CODE` no le dice nada a nadie,
 * y es el motivo más común: el identificador del archivo no siempre se llama "N° de crédito".
 * Por eso este texto además dice dónde se arregla.
 */
const REJECT_TEXT: Record<string, string> = {
  NO_CODE: 'No se encontró el N° de crédito. Revisá de qué columna se lee en Ajustes › Emparejar columnas.',
  DUP_IN_FILE: 'El N° de crédito viene repetido en el archivo.',
  MATCHES_MANUAL: 'Ese N° de crédito ya existe cargado a mano. El import no lo toca.',
  MATCHES_OUT_OF_SCOPE: 'Ese N° de crédito existe fuera del alcance de este archivo.',
};

export function rejectText(reason: string): string {
  // `MISSING_<CAMPO>` viene con el nombre interno en mayúsculas (`MISSING_OUTSTANDINGBALANCE`),
  // que es peor que no decirlo. Cuáles son obligatorios se ve en Ajustes.
  if (reason.startsWith('MISSING_')) return 'Le falta un dato que marcaste obligatorio.';
  return REJECT_TEXT[reason] ?? reason;
}

/** Cuántos ítems de una lista larga se dibujan antes de ofrecer el resto (gama baja, §9). */
export const LIST_LIMIT = 8;

/** Texto del "ver el resto", o `null` si entran todos. */
export function moreLabel(total: number, shown: number): string | null {
  return total > shown ? `Mostrar ${total - shown} más de ${total}` : null;
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
