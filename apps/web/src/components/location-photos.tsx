'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Cuántas fotos admite una ubicación (el tope que valida la API). */
export const MAX_LOCATION_PHOTOS = 20;

/**
 * Las fotos de una dirección: **para reconocer la casa** cuando se llega.
 *
 * 🔴 **La primera es la principal.** No hay un campo aparte: es el orden de `photoUrls`, el mismo que ya usa el teléfono, así
 * que marcar otra como principal es **ponerla primera**. Esa es la que se dibuja chica en los mapas de rutas.
 *
 * Es controlado: sube cada archivo por el mismo `POST /uploads` del resto del panel y devuelve la lista nueva por
 * `onChange`; guardar la dirección (o no) lo decide quien lo usa.
 */
export function LocationPhotos({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio.photos');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subir(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    const nuevas: string[] = [];
    for (const file of Array.from(files).slice(0, MAX_LOCATION_PHOTOS - value.length)) {
      const data = new FormData();
      data.append('file', file);
      const res = await fetch('/api/account/upload', { method: 'POST', body: data }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { url?: string; error?: { message?: string } } | undefined;
      if (!res?.ok || !body?.url) {
        setError(body?.error?.message ?? t('error'));
        continue;
      }
      nuevas.push(body.url);
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    if (nuevas.length > 0) onChange([...value, ...nuevas]);
  }

  const hacerPrincipal = (url: string) => onChange([url, ...value.filter((u) => u !== url)]);
  const quitar = (url: string) => onChange(value.filter((u) => u !== url));

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('title')}</p>
      <p className="mb-2 text-[12px] text-k-text-2">{t('hint')}</p>
      <ul className="flex flex-wrap gap-3">
        {value.map((url, i) => (
          <li key={url} className="w-[104px]">
            <div className={`relative h-[78px] overflow-hidden rounded-lg border-2 bg-white ${i === 0 ? 'border-k-purple' : 'border-k-border'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- la sirve el BFF con la sesión: no pasa por el optimizador de next/image */}
              <img src={url} alt={t('alt', { n: i + 1 })} loading="lazy" className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded bg-k-purple px-1.5 py-0.5 text-[10px] font-semibold text-white">{t('main')}</span>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-1 text-[12px]">
              {i === 0 ? (
                <span className="text-k-muted">&nbsp;</span>
              ) : (
                <button
                  type="button"
                  onClick={() => hacerPrincipal(url)}
                  disabled={disabled || busy}
                  className="font-medium text-k-periwinkle hover:underline disabled:opacity-50"
                >
                  {t('makeMain')}
                </button>
              )}
              <button
                type="button"
                onClick={() => quitar(url)}
                disabled={disabled || busy}
                aria-label={t('remove', { n: i + 1 })}
                className="text-k-danger hover:underline disabled:opacity-50"
              >
                {t('removeShort')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-k-danger">
          {error}
        </p>
      )}
      {value.length < MAX_LOCATION_PHOTOS && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => void subir(e.target.files)}
            data-testid="location-photos-input"
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={disabled || busy}
            className="mt-2 text-[13px] font-medium text-k-periwinkle hover:underline disabled:opacity-50"
          >
            {busy ? t('uploading') : t(value.length === 0 ? 'add' : 'addMore')}
          </button>
        </>
      )}
    </div>
  );
}
