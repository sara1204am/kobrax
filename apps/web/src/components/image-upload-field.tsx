'use client';

import { useId, useState } from 'react';

/**
 * Un campo para subir una imagen: zona para arrastrar o hacer clic sobre un `<input type="file">` nativo, sin librería.
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
  texts: { uploading: string; remove: string; uploadError: string; dropTitle: string; dropOr: string };
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  const [over, setOver] = useState(false);

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

  const showImage = Boolean(value) && !broken;
  const caption = busy ? texts.uploading : disabled && readOnlyText ? readOnlyText : hint;

  return (
    <div className="space-y-2">
      <label htmlFor={disabled ? undefined : inputId} className="block text-[14px] font-medium text-k-text">
        {label}
      </label>

      <div
        onDragOver={(e) => {
          if (disabled || busy) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (!disabled && !busy && file) void upload(file);
        }}
        className={`relative flex min-h-[172px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
          over ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border bg-k-bg'
        } ${disabled ? 'opacity-80' : 'hover:border-k-periwinkle'}`}
      >
        {showImage && (
          // eslint-disable-next-line @next/next/no-img-element -- lo sirve el BFF con la sesión
          <img
            src={value}
            alt=""
            onError={() => setBroken(true)}
            className="mb-2 h-16 w-auto max-w-[70%] rounded-lg border border-k-border bg-white object-contain p-1"
          />
        )}

        {!disabled && (
          <>
            {!showImage && (
              <>
                <span className="text-[13px] font-medium text-k-text">{texts.dropTitle}</span>
                <span className="text-[13px] font-medium text-k-text">{texts.dropOr}</span>
              </>
            )}
            {/* El input cubre toda la zona: el clic abre el selector y, con teclado, es el propio input quien toma el foco. */}
            <input
              id={inputId}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Limpiar el valor: si no, volver a elegir EL MISMO archivo no dispara `change`.
                e.target.value = '';
                if (file) void upload(file);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
            />
          </>
        )}

        <span className="mt-2 max-w-[28ch] text-[12px] text-k-muted">{caption}</span>

        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange('')}
            // Por encima del input transparente: si no, «Quitar» abriría el selector de archivos.
            className="relative z-10 mt-1 text-[13px] font-medium text-k-danger hover:underline"
          >
            {texts.remove}
          </button>
        )}
      </div>
    </div>
  );
}
