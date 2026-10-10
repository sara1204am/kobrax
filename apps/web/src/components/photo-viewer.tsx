'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const STEP = 0.5;

/**
 * El visor de las fotos de una casa: **una foto grande a la vez**, con su principal marcada, flechas para pasar de una a
 * otra, zoom y «n de total».
 *
 * Es un `<dialog>` nativo, igual que `Modal` (foco atrapado, Esc, fondo inerte), pero **con su propio encabezado**: el
 * título lleva debajo la dirección con su pin, que es lo que dice *qué casa* se está mirando. Por eso no es un `Modal` con
 * hijos — el encabezado de aquél es un solo título.
 *
 * La primera foto de la lista es la principal. Se puede navegar con ← y →.
 */
export function PhotoViewer({
  open,
  onClose,
  title,
  address,
  photos,
  evidence,
  initialIndex = 0,
}: {
  open: boolean;
  onClose: () => void;
  /** Quién es: el nombre del cliente. */
  title: string;
  /** Dónde es: la dirección, con el pin delante. */
  address?: string;
  /** La principal primero. */
  photos: string[];
  /** De quién es la evidencia: «Evidencia del cliente», «Evidencia de Juan Pérez». Por defecto, del cliente. */
  evidence?: string;
  /** Con cuál abre: tocar la tercera miniatura abre la tercera. */
  initialIndex?: number;
}) {
  const t = useTranslations('portfolio.photos');
  const tc = useTranslations('common');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closingByCode = useRef(false);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setIndex(initialIndex);
      setZoom(1);
      dialog.showModal();
    }
    if (!open && dialog.open) {
      closingByCode.current = true;
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir: moverse dentro del visor no lo reinicia
  }, [open]);

  const total = photos.length;
  const current = Math.min(index, Math.max(0, total - 1));
  const url = photos[current];
  const go = (to: number) => {
    setIndex(((to % total) + total) % total);
    setZoom(1);
  };

  return (
    // 🔴 Centrado explícito en los dos ejes: `inset-0 m-auto` con alto propio reparte el espacio que sobra arriba y abajo,
    // y a los lados. No se deja al margen por defecto del navegador, que una hoja de estilos puede pisar y dejar el visor
    // pegado a un borde.
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (closingByCode.current) {
          closingByCode.current = false;
          return;
        }
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={(e) => {
        if (total < 2) return;
        if (e.key === 'ArrowLeft') go(current - 1);
        if (e.key === 'ArrowRight') go(current + 1);
      }}
      className="fixed inset-0 m-auto hidden h-[fit-content] max-h-[92vh] w-[760px] max-w-[94vw] flex-col rounded-2xl border border-k-border bg-white p-0 text-k-text shadow-k-card backdrop:bg-k-navy/40 open:flex"
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-[20px] font-semibold text-k-navy">
            {title}
          </h2>
          {address && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-k-text-2">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="shrink-0"
              >
                <path d="M12 20.5s5.5-4.8 5.5-9.5a5.5 5.5 0 1 0-11 0c0 4.7 5.5 9.5 5.5 9.5z" />
                <circle cx="12" cy="11" r="1.8" />
              </svg>
              <span className="truncate">{address}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('close')}
          className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-k-muted hover:bg-k-bg hover:text-k-text-2"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-5 pt-4">
        {/* El escenario: la foto, su etiqueta, las flechas, el zoom y el contador, todo sobre ella. */}
        <div className="relative h-[min(52vh,420px)] overflow-hidden rounded-xl bg-k-light-bg">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element -- la sirve el BFF con la sesión
            <img
              src={url}
              alt={t('alt', { n: current + 1 })}
              className="h-full w-full object-contain transition-transform duration-150"
              style={{ transform: `scale(${zoom})` }}
            />
          )}

          {current === 0 && (
            <span className="absolute left-3 top-3 rounded-md bg-k-purple px-2.5 py-1 text-[12px] font-semibold text-white shadow">
              {t('main')}
            </span>
          )}

          <Arrow side="left" label={t('viewer.prev')} disabled={total < 2} onClick={() => go(current - 1)} />
          <Arrow side="right" label={t('viewer.next')} disabled={total < 2} onClick={() => go(current + 1)} />

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-k-navy/90 px-2 py-1.5 text-white shadow-lg">
            <Tool label={t('viewer.zoomOut')} disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - STEP))}>
              <path d="M5 12h14" />
            </Tool>
            <Tool label={t('viewer.zoomIn')} disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + STEP))}>
              <circle cx="11" cy="11" r="6.5" />
              <path d="M20 20l-4.2-4.2M11 8.5v5M8.5 11h5" />
            </Tool>
            <Tool label={t('viewer.fit')} disabled={zoom === 1} onClick={() => setZoom(1)}>
              <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
            </Tool>
            <Tool label={t('viewer.newTab')} onClick={() => url && window.open(url, '_blank', 'noopener')}>
              <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </Tool>
          </div>

          <span className="absolute bottom-3 right-3 rounded-full bg-k-navy/80 px-3 py-1 text-[12px] font-medium tabular-nums text-white">
            {t('viewer.counter', { n: current + 1, total })}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-k-light-bg text-k-periwinkle">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="4" y="5" width="16" height="14" rx="2" />
              <circle cx="9" cy="10" r="1.5" />
              <path d="M5 17l4.5-4.5 3 3L15 13l4 4" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-k-text">{current === 0 ? t('viewer.mainPhoto') : t('viewer.photoN', { n: current + 1 })}</p>
            <p className="truncate text-[13px] text-k-text-2">{evidence ?? t('viewer.evidenceClient')}</p>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function Arrow({ side, label, disabled, onClick }: { side: 'left' | 'right'; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-k-text shadow-md hover:bg-k-bg disabled:opacity-40 ${
        side === 'left' ? 'left-3' : 'right-3'
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  );
}

function Tool({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-9 items-center justify-center rounded-lg hover:bg-white/15 disabled:opacity-40"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
