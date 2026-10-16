'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PhotoViewer } from '@/components/photo-viewer';

const CLASS =
  'inline-flex h-11 items-center gap-2 rounded-xl border border-k-periwinkle bg-white px-4 text-[14px] font-semibold text-k-navy hover:bg-k-highlight';

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

/**
 * «Ver comprobante»: abre la foto en **el mismo visor que las fotos de las casas y de las rutas** (zoom, abrir en otra pestaña,
 * Esc para cerrar), no en una pestaña aparte.
 *
 * 🔴 `receiptUrl` es un texto libre en la API, así que se decide qué es antes de ofrecerlo:
 *  · una **ruta nuestra** (`/api/uploads/…`) → el visor, que la pide con la sesión;
 *  · una **URL http(s) externa** → un enlace, porque no se puede autenticar ni embeber;
 *  · cualquier otra cosa (`javascript:…`) → nada que tocar: sólo el texto. React no frena un `href` así y ejecutaría en el origen del panel.
 */
export function ReceiptButton({ url, title, caption }: { url: string; title: string; caption: string }) {
  const t = useTranslations('panel.payments');
  const [open, setOpen] = useState(false);

  if (url.startsWith('/')) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={CLASS}>
          {ICON}
          {t('detail.viewReceipt')}
        </button>
        <PhotoViewer open={open} onClose={() => setOpen(false)} title={title} photos={[url]} caption={caption} evidence={t('detail.receiptEvidence')} />
      </>
    );
  }
  if (/^https?:\/\//i.test(url)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={CLASS}>
        {ICON}
        {t('detail.viewReceipt')}
      </a>
    );
  }
  return <p className="max-w-[260px] break-all text-[13px] text-k-text-2">{url}</p>;
}
