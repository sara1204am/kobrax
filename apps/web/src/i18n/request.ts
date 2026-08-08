import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './config';

/**
 * Config de next-intl por request. Lo engancha el plugin en `next.config.mjs`.
 *
 * Una cookie con un valor inventado cae al default en vez de romper: el `import()` de abajo con un
 * locale arbitrario sería una lectura de archivo controlada por el usuario.
 */
export default getRequestConfig(async () => {
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
