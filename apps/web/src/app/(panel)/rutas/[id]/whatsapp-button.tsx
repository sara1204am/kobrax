'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SendWhatsappDialog } from '@/components/send-whatsapp-dialog';

/**
 * **«WhatsApp»** de una parada: abre el diálogo para escribirle al deudor con una de las plantillas de la cuenta
 * (las mismas de Cuenta → Mensajes, la agenda y la ficha de mora). Antes mandaba un saludo fijo con el nombre.
 *
 * 🔴 **El teléfono se pide al elegir al deudor, no al dibujar la pantalla** (lo hace el diálogo): es un dato personal que
 * la API revela y audita (`agenda_client_context`), y pedirlo para cada fila de una ruta dejaría un rastro de revelado por
 * cada deudor mirado de reojo.
 *
 * 🔴 **Abrir WhatsApp no registra el resultado**: deja una gestión pendiente en la agenda, y quien escribió dice después
 * cómo terminó (ver `SendWhatsappDialog`).
 */
export function WhatsAppButton({
  clientId,
  variant = 'ghost',
}: {
  clientId: string;
  /** El nombre ya no se usa (el mensaje sale de la plantilla); se acepta para no tocar a los tres llamadores. */
  clientName?: string;
  variant?: 'ghost' | 'compact' | 'icon';
}) {
  const t = useTranslations('panel.routes.whatsapp');
  const [open, setOpen] = useState(false);

  const cls =
    variant === 'icon'
      ? 'flex h-8 w-9 items-center justify-center rounded-lg border border-k-border bg-white text-k-success hover:bg-k-success-bg'
      : variant === 'compact'
      ? 'h-8 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-success hover:bg-k-success-bg'
      : 'h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-success hover:bg-k-success-bg';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={variant === 'icon' ? t('label') : undefined}
        title={variant === 'icon' ? t('label') : undefined}
        className={cls}
      >
        {variant === 'icon' ? (
          // Solo el ícono: el nombre va en `aria-label` y en el tooltip, que es lo que lee un lector de pantalla.
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.5-4A8 8 0 1 1 20 11.5z" />
            <path d="M9.5 8.8c.2 2.6 2.7 5 5.3 5.2l1-1.3-1.8-.9-.7.7a4 4 0 0 1-1.9-1.9l.7-.7-.9-1.8-1.7 1.1z" fill="currentColor" stroke="none" />
          </svg>
        ) : (
          t('label')
        )}
      </button>
      <SendWhatsappDialog open={open} onClose={() => setOpen(false)} clientId={clientId} />
    </>
  );
}
