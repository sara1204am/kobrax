'use client';

import { useState } from 'react';

/**
 * Un campo para subir una imagen: `<input type="file">` nativo, sin librería.
 *
 * Sube al toque a `/api/account/upload` (que la guarda por cuenta y devuelve su ruta) y entrega esa ruta con
 * `onChange`; **no persiste nada** — quien lo usa decide cuándo atarla a su recurso (con su botón o su barra de
 * guardado). Vaciarlo es `onChange('')`. Los textos vienen de afuera para que cada pantalla use su propio idioma y
 * namespace.
 */
export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  onError,
  disabled,
  readOnlyText,
  texts,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (url: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  /** Qué decir cuando no se puede subir (p. ej. falta el permiso): sin esto el control desaparece sin explicación. */
  readOnlyText?: string;
  texts: { uploading: string; remove: string; uploadError: string };
}) {
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  async function upload(file: File) {
    setBroken(false);
    setBusy(true);
    const data = new FormData();
    data.append('file', file);
    const res = await fetch('/api/account/upload', { method: 'POST', body: data }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { url?: string; error?: { message: string } } | undefined;
    setBusy(false);
    if (!res?.ok || !json?.url) {
      onError(json?.error?.message ?? texts.uploadError);
      return;
    }
    onChange(json.url);
  }

  return (
    <div className="space-y-2">
      <span className="block text-[14px] font-medium text-k-text">{label}</span>
      <div className="flex items-center gap-3">
        {!(value && !broken) && (
          // El lugar de la imagen se ve aunque esté vacío: así se entiende que acá va algo.
          <span
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-k-border bg-k-bg text-[20px] text-k-muted"
          >
            ＋
          </span>
        )}
        {value && !broken && (
          // eslint-disable-next-line @next/next/no-img-element -- lo sirve el BFF con la sesión
          <img
            src={value}
            alt=""
            onError={() => setBroken(true)}
            className="h-16 w-16 rounded-xl border border-k-border bg-white object-contain p-1"
          />
        )}
        <div className="flex-1 space-y-1">
          {!disabled && (
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={label}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Limpiar el valor: si no, volver a elegir EL MISMO archivo no dispara `change`.
                e.target.value = '';
                if (file) void upload(file);
              }}
              className="block w-full text-[13px] text-k-text-2 file:mr-3 file:rounded-lg file:border file:border-k-border file:bg-white file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-k-text-2 hover:file:bg-k-bg"
            />
          )}
          <p className="text-[12px] text-k-muted">{busy ? texts.uploading : disabled && readOnlyText ? readOnlyText : hint}</p>
        </div>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[13px] font-medium text-k-danger hover:underline"
          >
            {texts.remove}
          </button>
        )}
      </div>
    </div>
  );
}
