'use client';

import { useLocale, useTranslations } from 'next-intl';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/i18n/config';

/**
 * Selector es/en del diseño (arriba a la derecha de la columna del paso).
 *
 * Escribe la cookie desde el navegador y recarga. Es un `location.reload()` y no un
 * `router.refresh()` porque al cambiar de idioma también cambia el `lang` del `<html>`, que lo
 * pinta el layout raíz: refrescar sólo los server components dejaría el atributo viejo.
 * Con dos idiomas y una pantalla de login no hay estado que valga la pena preservar.
 */
export function LocaleSwitch() {
  const active = useLocale();
  const t = useTranslations('locale');

  function pick(locale: Locale) {
    if (locale === active) return;
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex items-center gap-1 rounded-xl border border-k-border bg-white p-1"
    >
      <IconGlobe />
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => pick(locale)}
          aria-pressed={locale === active}
          title={t(locale)}
          className={`rounded-lg px-2.5 py-1 text-[13px] font-medium uppercase transition-colors ${
            locale === active ? 'bg-k-highlight text-k-purple' : 'text-k-muted hover:text-k-text-2'
          }`}
        >
          {locale}
        </button>
      ))}
    </div>
  );
}

function IconGlobe() {
  return (
    <svg
      className="ml-1.5 text-k-muted"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}
