'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * «Ver en grande»: el mismo visor que `MiQrCobro` del móvil, para el cobro desde el escritorio.
 *
 * Fondo blanco entero y el QR lo más grande que entre: el deudor escanea con su teléfono desde
 * la pantalla, y el contraste es lo que hace que la cámara enganche. No hay pasarela — el pago
 * después se registra a mano con método QR, igual que en la calle.
 *
 * ponytail: `<dialog open>` con estado propio en vez de `showModal()` — jsdom no lo implementa y
 * un `fixed inset-0` ya cubre la pantalla. El Esc se maneja a mano por lo mismo.
 */
export function QrViewer({ url }: { url: string }) {
  const t = useTranslations('profile');
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) close.current?.focus();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] font-medium text-k-purple hover:underline"
      >
        {t('viewQr')}
      </button>

      {open && (
        <dialog
          open
          aria-label={t('qrTitle')}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          className="fixed inset-0 z-50 flex h-screen w-screen max-h-none max-w-none flex-col items-center justify-center gap-6 bg-white p-6"
        >
          <h2 className="text-[22px] font-semibold text-k-navy">{t('qrTitle')}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- lo sirve el BFF con la sesión */}
          <img src={url} alt={t('paymentQr')} className="h-[min(70vh,70vw)] w-[min(70vh,70vw)] object-contain" />
          <p className="max-w-md text-center text-[14px] text-k-text-2">{t('qrHint')}</p>
          <button
            ref={close}
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-xl border border-k-border px-6 py-2.5 text-[14px] font-medium text-k-navy hover:bg-k-bg"
          >
            {t('close')}
          </button>
        </dialog>
      )}
    </>
  );
}
