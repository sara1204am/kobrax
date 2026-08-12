/**
 * Cómo el panel cuenta un error de la API.
 *
 * Vive suelto porque lo usan todos los módulos: nació con el import (W4) y lo heredan casos y
 * agenda (W5). La regla es la misma en todos, y tenerla en un solo lado es lo que evita que un
 * módulo esconda un código que otro muestra.
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
 * La API contesta **en español y específico** («Cambio de estado no permitido», «El tenant carga a
 * mano»), así que en `es` gana su mensaje: cualquier texto propio sería más pobre. En `en` se
 * traduce por código y se cae al del servidor cuando el diccionario no lo tiene.
 *
 * 🔴 Un código desconocido **se muestra crudo, no se esconde**: el backend puede ser más nuevo que
 * el panel, y un error mudo deja a la persona sin nada que contarle al soporte.
 *
 * `t` tiene que estar atado al namespace del módulo, que es el que trae su tabla `errors.*`.
 */
export function errorText(error: ApiError | null | undefined, t: Translator, locale: string): string {
  /*
   * Sin objeto de error tampoco se calla: se llama a esto **porque algo falló**, y devolver vacío
   * dejaba un `ErrorBanner` en blanco. Los llamadores lo tapaban con un `|| t('errors.generic')`
   * repetido en cada módulo, hasta que uno se olvidara.
   */
  if (!error) return t('errors.generic');
  if (locale === 'es' && error.message) return error.message;
  const key = error.code ? `errors.${error.code}` : null;
  if (key && t.has(key)) return t(key);
  return error.message ?? error.code ?? t('errors.generic');
}
