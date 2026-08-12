import type { ImportConfig, ScopeBranch, ScopeMember } from '@kobrax/shared';

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
