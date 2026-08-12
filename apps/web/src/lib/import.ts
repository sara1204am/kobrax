import type { FieldRule, ImportConfig, ImportConfigPatch, ScopeBranch, ScopeMember } from '@kobrax/shared';
import { sendJson } from './client';

/**
 * Lo que el panel pone del import y `shared` no: **texto en un idioma**.
 *
 * Las reglas (estados de campo, el corte del nombre, qué falta para poder importar) viven en
 * `@kobrax/shared` y las comparte con el móvil. Acá está sólo la traducción de los códigos que
 * la API devuelve, que en el panel son dos idiomas y en el teléfono uno.
 */

/** El traductor de next-intl, en lo mínimo que estas funciones usan. */
export interface Translator {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
}

export interface ApiError {
  code?: string;
  message?: string;
}

/**
 * Qué texto mostrar ante un error de la API.
 *
 * La API ya contesta **en español y específico** («El archivo no es un PDF», «El tenant carga a
 * mano»), así que en `es` gana su mensaje: cualquier texto propio sería más pobre. En `en` se
 * traduce por código y se cae al del servidor cuando el diccionario no lo tiene.
 *
 * 🔴 Un código desconocido **se muestra crudo, no se esconde**: el backend puede ser más nuevo
 * que el panel, y un error mudo deja a la persona sin nada que contarle al soporte.
 */
export function errorText(error: ApiError | null | undefined, t: Translator, locale: string): string {
  if (!error) return '';
  if (locale === 'es' && error.message) return error.message;
  const key = error.code ? `errors.${error.code}` : null;
  if (key && t.has(key)) return t(key);
  return error.message ?? error.code ?? t('errors.generic');
}

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
  options: { columnsOnly?: boolean; dryRun?: boolean } = {},
): Promise<{ ok: boolean; data?: T; error?: ApiError }> {
  const form = new FormData();
  form.append('file', withDeducedType(file));
  if (options.dryRun !== undefined) form.append('dryRun', String(options.dryRun));

  const res = await fetch(`/api/imports/run${options.columnsOnly ? '?columnsOnly=true' : ''}`, {
    method: 'POST',
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: ApiError };
  return res.ok ? { ok: true, data: body } : { ok: false, error: body.error };
}

/** El campo que se calibra. Es el único con `calibrated`, y el que decide quién está en mora. */
export const DAYS_PAST_DUE = 'daysPastDue';

/**
 * Elegir la columna de días de atraso. **Nunca confirma**: el usuario todavía no vio los valores
 * de la columna nueva, así que `calibrated` vuelve a `false`.
 *
 * El merge de `fields` del servidor es superficial y reemplaza la regla entera, así que la regla
 * anterior se esparce o se pierden `enabled`/`required`.
 */
export function pickDaysPastDue(rule: FieldRule | undefined, from: string): ImportConfigPatch {
  return { fields: { [DAYS_PAST_DUE]: { ...rule, from, calibrated: false } } };
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

/** El mismo archivo con un tipo deducido de la extensión, cuando el navegador no lo puso. */
export function withDeducedType(file: File): File {
  if (file.type) return file;
  const type = MIME_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return type ? new File([file], file.name, { type }) : file;
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
