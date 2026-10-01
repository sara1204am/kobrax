import {
  IMPORT_RUN_ITEM_ACTIONS,
  type FieldDef,
  type ImportAssignments,
  type PortfolioSummary,
  type FieldRule,
  type ImportConfig,
  type ImportConfigPatch,
  type ImportRunItemAction,
  type ScopeBranch,
  type ScopeMember,
} from '@kobrax/shared';
import { sendJson } from './client';
import { PAGE_SIZES } from './table-prefs';
import type { ApiError, Translator } from './api-error';

/**
 * Lo que el panel pone del import y `shared` no.
 *
 * Dos cosas, y conviene no confundirlas:
 *
 * 1. **Texto en un idioma** — la traducción de los códigos que devuelve la API. En el panel son
 *    dos idiomas y en el teléfono uno, así que nunca sube a `shared`.
 * 2. **Cómo se lee la config para dibujar ESTA pantalla** (`fieldStatus`, `trackedFields`,
 *    `configProgress`, `usedColumns`). No está en `shared` porque el móvil no lo pide: su pantalla
 *    de columnas es una lista corta sin contador ni progreso. El día que lo pida, sube tal cual —
 *    son funciones puras sobre `ImportConfig` y el catálogo.
 *
 * El **contrato** (qué campos hay, qué significa `locked` / `starred` / `calibrated`) sí vive en
 * `@kobrax/shared`, y es lo único que los tres tienen que compartir.
 */

/**
 * Por qué un registro quedó afuera. `NO_CODE` no le dice nada a nadie y es el motivo más común,
 * así que su texto además dice dónde se arregla.
 */
export function rejectText(reason: string, t: Translator): string {
  // `MISSING_<CAMPO>` llega con el nombre interno en mayúsculas (`MISSING_OUTSTANDINGBALANCE`),
  // que es peor que no decirlo. Cuáles son obligatorios se ve en Ajustes.
  if (reason.startsWith('MISSING_')) return t('rejects.MISSING');
  return t.has(`rejects.${reason}`) ? t(`rejects.${reason}`) : reason;
}

/** Advertencia de corrida: no frena la fila, se importa igual y se avisa. */
export function warningText(warning: { code: string; detail?: string }, t: Translator): string {
  const key = `warnings.${warning.code}`;
  const text = t.has(key) ? t(key) : warning.code;
  return warning.detail ? `${text} (${warning.detail})` : text;
}

export interface GroupedWarning {
  code: string;
  detail?: string;
  /** Cuántas filas dispararon exactamente este aviso. */
  count: number;
}

/**
 * Los avisos, agrupados por lo que dicen.
 *
 * `MORA_INCONSISTENTE` se emite **una vez por fila sospechosa** y no lleva detalle, así que un
 * archivo de 3.000 créditos puede traer 700 avisos idénticos. Dibujados uno por uno, empujan
 * fuera de la pantalla a los dos que salen una sola vez por corrida y que sí son accionables
 * (`MORA_SIN_CONFIRMAR`, `MORA_COLUMNA_SOSPECHOSA`) — justo donde la persona decide si confirma.
 *
 * El `index` de la fila no se pierde por acá: nunca se mostraba. Lo que se muestra es cuántas son.
 */
export function groupWarnings(warnings: { code: string; detail?: string }[]): GroupedWarning[] {
  const groups = new Map<string, GroupedWarning>();
  for (const { code, detail } of warnings) {
    // El separador importa: sin él, `{code:'A', detail:'B'}` y `{code:'AB'}` caerían en el mismo
    // grupo y se contarían juntos. Es una barra y no un espacio porque los códigos no la usan.
    const key = `${code}|${detail ?? ''}`;
    const found = groups.get(key);
    if (found) found.count++;
    else groups.set(key, { code, detail, count: 1 });
  }
  return [...groups.values()];
}

// ── Llamadas al BFF (lado navegador) ─────────────────────────────────────────

/** Guarda un parche de config. Los invariantes los valida el servidor; acá sólo se despacha. */
export async function patchConfig(
  patch: ImportConfigPatch,
): Promise<{ ok: boolean; config?: ImportConfig; error?: ApiError }> {
  const { ok, data } = await sendJson<{ config: ImportConfig }>('/api/imports/config', patch, 'PATCH');
  return ok && data.config ? { ok: true, config: data.config } : { ok: false, error: data.error };
}

/**
 * Sube el archivo al import.
 *
 * 🔴 `dryRun` va **como campo del multipart** y `columnsOnly` **como query**: así los lee el
 * controller. Mandar `dryRun` por query hace que la corrida se aplique de verdad creyendo que
 * previsualiza.
 */
export async function postImportFile<T>(
  file: File,
  options: { columnsOnly?: boolean; dryRun?: boolean; assignments?: ImportAssignments } = {},
): Promise<{ ok: boolean; data?: T; error?: ApiError }> {
  const form = new FormData();
  form.append('file', withDeducedType(file));
  if (options.dryRun !== undefined) form.append('dryRun', String(options.dryRun));
  // Campo del multipart, como `dryRun`: el BFF reenvía el FormData tal cual.
  if (options.assignments) form.append('assignments', JSON.stringify(options.assignments));

  // Sin red `fetch` rechaza, y el rechazo se llevaría puesto el `setBusy(false)` de quien llamó:
  // la pantalla entera queda gris y muda hasta recargar. Sin `error`, el banner dice `errors.generic`.
  const res = await fetch(`/api/imports/run${options.columnsOnly ? '?columnsOnly=true' : ''}`, {
    method: 'POST',
    body: form,
  }).catch(() => null);
  if (!res) return { ok: false };

  const body = (await res.json().catch(() => ({}))) as T & { error?: ApiError };
  return res.ok ? { ok: true, data: body } : { ok: false, error: body.error };
}

/** El campo que se calibra. Es el único con `calibrated`, y el que decide quién está en mora. */
export const DAYS_PAST_DUE = 'daysPastDue';

/**
 * Elegir la columna de días de atraso. **Nunca confirma**: el usuario todavía no vio los valores
 * de la columna nueva, así que `calibrated` vuelve a `false`.
 *
 * 🔴 `where` dice **dónde** está esa columna, y no es cosmético. En un extracto `pdf-blocks` las
 * candidatas salen del cuadro de movimientos, así que van con `in: 'table'`; sin eso el motor la
 * busca como etiqueta del encabezado del bloque, no la encuentra, y **toda la cartera entra con
 * cero días de atraso** — nadie aparece en mora y la pantalla igual dice «Confirmada». Se pasa
 * explícito (y no se hereda de la regla anterior) porque la misma columna se puede elegir desde
 * dos lugares distintos: el cuadro y las etiquetas del bloque.
 *
 * El merge de `fields` del servidor es superficial y reemplaza la regla entera, así que la regla
 * anterior se esparce o se pierden `enabled`/`required`.
 */
export function pickDaysPastDue(
  rule: FieldRule | undefined,
  from: string,
  where?: FieldRule['in'],
): ImportConfigPatch {
  return { fields: { [DAYS_PAST_DUE]: { ...rule, from, in: where, calibrated: false } } };
}

/**
 * Confirmar la columna, ya con los valores a la vista. Es un `PATCH` aparte a propósito: si se
 * pudiera elegir y confirmar en la misma llamada, «confirmado» no significaría nada — el
 * servidor lo rechaza con `CALIBRATION_STALE`.
 */
export function confirmDaysPastDue(rule: FieldRule | undefined): ImportConfigPatch {
  return { fields: { [DAYS_PAST_DUE]: { ...rule, calibrated: true } } };
}

/**
 * Extensiones que el controller acepta, por si el navegador no le pone tipo al archivo.
 *
 * En Windows un `.csv` llega seguido con `type: ''`, el `fileFilter` de la API lo rechaza y
 * devuelve `FILE_REQUIRED` — «falta el archivo» ante un archivo que la persona claramente eligió.
 */
const MIME_BY_EXT: Record<string, string> = {
  csv: 'text/csv',
  txt: 'text/plain',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

/**
 * Para el `accept` del `<input type="file">`. Filtrar en el navegador **antes** de subir 15 MB
 * evita el peor error del módulo: el `fileFilter` de la API descarta lo que no reconoce y el
 * controller contesta `FILE_REQUIRED` — «falta el archivo» ante un archivo que la persona acaba
 * de elegir, y sin decirle cuáles se aceptan.
 */
export const ACCEPTED_FILES = Object.keys(MIME_BY_EXT)
  .map((ext) => `.${ext}`)
  .join(',');

/** El mismo archivo con un tipo deducido de la extensión, cuando el navegador no lo puso. */
export function withDeducedType(file: File): File {
  if (file.type) return file;
  const type = MIME_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return type ? new File([file], file.name, { type }) : file;
}

// ── Estado del emparejado ────────────────────────────────────────────────────

/**
 * En qué anda un campo. Es lo que la pantalla pinta al lado de cada fila y lo que suma el
 * contador de arriba — no hay dos definiciones de «listo».
 */
export type FieldStatus = 'ready' | 'review' | 'missing' | 'off';

export function fieldStatus(field: string, rule: FieldRule | undefined): FieldStatus {
  if (rule?.enabled === false) return 'off';
  if (!rule?.from) return 'missing';
  /*
   * La mora es el único campo que además de emparejarse se CONFIRMA, y por eso es el único que
   * puede estar emparejado y no estar listo: elegida y sin confirmar, la corrida importa igual y
   * sólo avisa (`MORA_SIN_CONFIRMAR`) — pero de que esa columna sea la correcta depende quién
   * aparece en mora.
   */
  if (field === DAYS_PAST_DUE && !rule.calibrated) return 'review';
  return 'ready';
}

/**
 * Los campos que la pantalla lista y cuenta: **los esenciales siempre**, estén configurados o no,
 * más los que se hayan agregado.
 *
 * 🔴 El «siempre» no es cosmético. `DEFAULT_IMPORT_CONFIG.fields` es `{}`, así que en una cuenta
 * nueva —o después de un reset— listar sólo `config.fields` deja la pantalla vacía y manda la
 * llave y el cliente al fondo de un desplegable de 19 opciones, sin nada que diga que son los dos
 * que el import no puede suplir. Así se llega a una cartera entera de «SIN NOMBRE» sin que nada
 * haya avisado.
 *
 * El móvil hace lo mismo con un conjunto más chico: lista siempre los `locked` (la llave y el
 * cliente) y no los `starred`. No es un descuido — su pantalla no configura, sólo empareja lo que
 * ya no se puede evitar.
 */
export function trackedFields(config: ImportConfig, catalog: Record<string, FieldDef>): string[] {
  const essential = Object.keys(catalog).filter((field) => catalog[field]?.starred);
  const added = Object.keys(config.fields).filter((field) => !catalog[field]?.starred);
  return [...essential, ...added];
}

export interface ConfigProgress {
  fields: string[];
  ready: number;
  review: number;
  missing: number;
  /** Cuántos cuentan para la barra: los apagados son una decisión tomada, no una tarea pendiente. */
  total: number;
  /**
   * Sin columna y sin los cuales la corrida no sirve: los bloqueados (la llave, el cliente) y los
   * que se marcaron obligatorios. Es lo que decide si se puede probar el archivo.
   */
  blocking: string[];
}

export function configProgress(config: ImportConfig, catalog: Record<string, FieldDef>): ConfigProgress {
  const fields = trackedFields(config, catalog);
  const counts = { ready: 0, review: 0, missing: 0 };
  const blocking: string[] = [];

  for (const field of fields) {
    const rule = config.fields[field];
    const status = fieldStatus(field, rule);
    if (status === 'off') continue;
    counts[status]++;
    if (status === 'missing' && (catalog[field]?.locked || rule?.required)) blocking.push(field);
  }

  return { fields, ...counts, total: counts.ready + counts.review + counts.missing, blocking };
}

/**
 * Qué etiqueta del archivo ya alimenta a otro dato, para no ofrecerla dos veces.
 *
 * La llave es `dónde:etiqueta`, **igual que el servidor**: la misma etiqueta puede alimentar dos
 * campos si se lee en dos lugares distintos (el encabezado del bloque y el cuadro de movimientos),
 * y bloquearla de más sacaría una combinación que el servidor acepta.
 */
export function usedColumns(config: ImportConfig, except: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [field, rule] of Object.entries(config.fields)) {
    if (field === except || !rule.from || rule.enabled === false) continue;
    out.set(`${rule.in ?? 'header'}:${rule.from}`, field);
  }
  return out;
}

/**
 * Nombre de la persona o la sucursal elegida como alcance. `null` cuando el alcance no pide ref
 * (`account`) o todavía no se eligió — ese texto lo pone la pantalla.
 */
export function scopeRefName(
  scope: ImportConfig['scope'],
  members: ScopeMember[],
  branches: ScopeBranch[],
  t: Translator,
): string | null {
  if (scope.kind === 'account' || !scope.ref) return null;
  const found =
    scope.kind === 'official'
      ? members.find((m) => m.id === scope.ref)?.name
      : branches.find((b) => b.id === scope.ref)?.name;
  // Si el ref guardado ya no existe (persona dada de baja, sucursal cerrada) se dice, en vez de
  // dibujar una fila vacía que parece configurada.
  return found ?? t('settings.scopeRefGone');
}

// ── Historial de importaciones ─────────────────────────────────────────────

/** Cuántas corridas por página si nadie eligió otra cosa. Es uno de los tamaños que ofrece la tabla. */
export const HISTORY_PAGE_SIZE = 25;
/** Cuántos movimientos por página en el detalle de una corrida. */
export const RUN_ITEMS_PAGE_SIZE = 50;

/** El filtro de movimientos que llegó por la URL, si es uno que existe. Otro no viaja: sería un 400. */
export function runItemAction(value: string | undefined): ImportRunItemAction | undefined {
  return value && (IMPORT_RUN_ITEM_ACTIONS as readonly string[]).includes(value) ? (value as ImportRunItemAction) : undefined;
}

/** La query de una página: el tamaño elegido si es uno de los que ofrece la tabla, o el default. */
function pageQuery(params: { page?: string; pageSize?: string }, fallback: number): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : fallback;
  return new URLSearchParams({ page: String(page), limit: String(limit) });
}

/**
 * Lo que el historial deja buscar y filtrar, tal cual lo recibe la API: el texto (`q`, que pone el
 * `SearchBox`), cuándo se importó, la fecha de corte del reporte y quién importó.
 */
export const HISTORY_FILTER_KEYS = ['q', 'from', 'to', 'reportFrom', 'reportTo', 'createdBy'] as const;

export function hasHistoryFilters(params: Record<string, string | undefined>): boolean {
  return HISTORY_FILTER_KEYS.some((k) => params[k]?.trim());
}

export function historyQuery(params: Record<string, string | undefined>): URLSearchParams {
  const query = pageQuery(params, HISTORY_PAGE_SIZE);
  for (const k of HISTORY_FILTER_KEYS) {
    const v = params[k]?.trim();
    if (v) query.set(k, v);
  }
  return query;
}

export function runItemsQuery(params: { action?: string; page?: string; pageSize?: string }): URLSearchParams {
  const query = pageQuery(params, RUN_ITEMS_PAGE_SIZE);
  const action = runItemAction(params.action);
  if (action) query.set('action', action);
  return query;
}

/** «2,4 MB» / «830 KB»: el tamaño del documento, como se lee en un explorador de archivos. */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── Responsables al importar ─────────────────────────────────────────────────

/**
 * Quién queda responsable de cada crédito en la vista previa, por **nº de operación**.
 *
 * - `create`: los nuevos. Arranca en la sugerencia del servidor (el asesor del reporte); `null` =
 *   sin responsable, y con alguno así no se confirma.
 * - `update`: los existentes. Arranca en su responsable de HOY; distinto de ese = reasignación.
 *
 * 🔴 Por nº de operación y no por fila: al confirmar el servidor vuelve a leer el archivo, y la
 * posición de una fila no es una identidad.
 */
export interface AssignState {
  create: Record<string, string | null>;
  update: Record<string, string | null>;
}

export function initialAssignState(summary: PortfolioSummary): AssignState {
  return {
    create: Object.fromEntries(summary.preview.toCreate.map((r) => [r.code, r.suggestedAssigneeId ?? null])),
    update: Object.fromEntries(summary.preview.toUpdate.map((r) => [r.code, r.currentAssigneeId ?? null])),
  };
}

/** Pone a `userId` como responsable de `codes` en una de las dos listas. Devuelve un estado nuevo. */
export function assignCodes(state: AssignState, list: keyof AssignState, codes: string[], userId: string | null): AssignState {
  const next = { ...state[list] };
  for (const c of codes) if (c in next) next[c] = userId;
  return { ...state, [list]: next };
}

/** Cuántos nuevos tienen responsable, cuántos no, y el reparto por persona (de más a menos). */
export function assignmentStats(create: AssignState['create']): {
  assigned: number;
  unassigned: number;
  byUser: { userId: string; count: number }[];
} {
  const counts = new Map<string, number>();
  let unassigned = 0;
  for (const userId of Object.values(create)) {
    if (userId) counts.set(userId, (counts.get(userId) ?? 0) + 1);
    else unassigned += 1;
  }
  const byUser = [...counts].map(([userId, count]) => ({ userId, count })).sort((a, b) => b.count - a.count);
  return { assigned: byUser.reduce((n, u) => n + u.count, 0), unassigned, byUser };
}

/** Los existentes cuyo responsable se cambió en la pantalla: las reasignaciones que se van a pedir. */
export function pendingReassignments(
  state: AssignState,
  summary: PortfolioSummary,
): { code: string; clientName?: string; from: string | null; to: string }[] {
  return summary.preview.toUpdate.flatMap((r) => {
    const to = state.update[r.code];
    const from = r.currentAssigneeId ?? null;
    return to && to !== from ? [{ code: r.code, clientName: r.clientName, from, to }] : [];
  });
}

/**
 * Lo que viaja al confirmar. Los nuevos agrupados por responsable (100 créditos entre tres personas
 * son tres grupos, no cien filas), y sólo las reasignaciones que de verdad cambian algo.
 */
export function buildAssignmentsPayload(state: AssignState, summary: PortfolioSummary): ImportAssignments {
  const groups = new Map<string, string[]>();
  for (const [code, userId] of Object.entries(state.create)) {
    if (userId) groups.set(userId, [...(groups.get(userId) ?? []), code]);
  }
  return {
    version: 1,
    create: [...groups].map(([userId, externalIds]) => ({ userId, externalIds })),
    reassign: pendingReassignments(state, summary).map(({ code, from, to }) => ({ externalId: code, fromUserId: from, toUserId: to })),
  };
}
