'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Modal sobre el `<dialog>` nativo.
 *
 * `showModal()` regala **foco atrapado, tecla Esc, fondo inerte y backdrop**: las cuatro cosas
 * que una implementación a mano hace peor y que son justo las que rompen la accesibilidad
 * cuando faltan. Lo único que se agrega es cerrar al tocar afuera, que el elemento no trae.
 *
 * `open` manda: el componente sigue la prop en vez de tener su propio estado, así el que abre
 * y el que cierra son el mismo. Esc y el clic afuera avisan por `onClose`.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useTranslations('common');
  /**
   * Marca que el cierre lo pedimos nosotros.
   *
   * `dialog.close()` dispara el evento nativo `close`, que está cableado a `onClose` — así
   * que cerrar con la X llamaba a `onClose` **dos veces**: una por el clic y otra por el
   * cierre que ese clic provocó. Cualquier efecto del llamador (un toast, un `router.push`,
   * un POST que descarta un borrador) salía duplicado. El evento nativo sólo tiene que avisar
   * cuando quien cerró fue el navegador, o sea la tecla Esc.
   */
  const closingByCode = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      closingByCode.current = true;
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Por acá entra la tecla Esc, que cierra el diálogo sin pasar por ningún handler nuestro.
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
      className="w-[460px] max-w-[92vw] rounded-2xl border border-k-border bg-white p-0 text-k-text shadow-k-card backdrop:bg-k-navy/40"
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5">
        <h2 id={titleId} className="text-[18px] font-semibold text-k-navy">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-lg text-k-muted hover:bg-k-bg hover:text-k-text-2"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="px-6 py-4 text-[14px] leading-relaxed text-k-text-2">{children}</div>

      {actions && (
        <div className="flex flex-col-reverse gap-2 border-t border-k-border px-6 py-4 sm:flex-row sm:justify-end">
          {actions}
        </div>
      )}
    </dialog>
  );
}
