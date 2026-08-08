/**
 * Idiomas del panel. **Sin ruteo por idioma**: el locale vive en una cookie, no en la URL.
 * Prefijos `/es` y `/en` obligarían a tocar todas las rutas y el matcher del middleware — mucho
 * ruido para dos idiomas (decisión W0 §7).
 */
export const LOCALES = ['es', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

/**
 * La cookie del idioma **no es httpOnly a propósito**: la escribe el navegador (es una preferencia
 * de UI, no un secreto) y la lee el servidor en `request.ts`. Es la única cookie de este panel que
 * no pasa por el BFF.
 */
export const LOCALE_COOKIE = 'k_locale';

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
