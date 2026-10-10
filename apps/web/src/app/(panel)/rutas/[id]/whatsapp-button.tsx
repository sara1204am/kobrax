'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { whatsappLink } from '@kobrax/shared';

interface Contact {
  contactType: string;
  value: string;
  isPrimary: boolean;
}

/** El mejor número para escribirle: el WhatsApp principal; si no hay, el teléfono principal; si no, cualquiera de los dos. */
function pickPhone(contacts: Contact[]): string | undefined {
  const phones = contacts.filter((c) => c.contactType === 'WHATSAPP' || c.contactType === 'PHONE');
  const best =
    phones.find((c) => c.contactType === 'WHATSAPP' && c.isPrimary) ??
    phones.find((c) => c.contactType === 'PHONE' && c.isPrimary) ??
    phones.find((c) => c.contactType === 'WHATSAPP') ??
    phones[0];
  return best?.value;
}

/**
 * **«WhatsApp»**: abre la conversación con el deudor con el mensaje ya escrito (F4/12). Llamar desde el panel no se hizo (en
 * escritorio un `tel:` casi nunca abre nada útil); escribir sí tiene sentido porque `wa.me` abre WhatsApp Web o la app.
 *
 * 🔴 **El teléfono se pide al hacer clic, no al dibujar la pantalla.** Es un dato personal que la API revela y audita
 * (`agenda_client_context`): pedirlo para cada fila de una ruta dejaría un rastro de revelado por cada deudor mirado de
 * reojo, y casi nadie va a escribirle a todos.
 *
 * 🔴 **Abrirlo NO registra nada**: abrir WhatsApp no prueba que se escribió. La gestión se registra aparte, con su resultado
 * (mismo criterio que los botones de la agenda).
 *
 * La pestaña se abre ANTES de pedir el teléfono y se redirige después: abrirla recién cuando llega la respuesta la frena el
 * bloqueador de ventanas, que solo deja pasar lo que nace de un clic.
 */
export function WhatsAppButton({
  clientId,
  clientName,
  variant = 'ghost',
}: {
  clientId: string;
  clientName?: string;
  variant?: 'ghost' | 'compact' | 'icon';
}) {
  const t = useTranslations('panel.routes.whatsapp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    /*
     * 🔴 **Sin `'noopener'` en el tercer argumento**: con ese feature `window.open` devuelve siempre `null`, y entonces
     * no hay pestaña a la que redirigir y el código caía al plan B — navegar ESTA ventana, que es justo lo que se quería
     * evitar. La pestaña se aísla igual cortando `opener` a mano.
     */
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    const res = await fetch(`/api/agenda/context/${clientId}`).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    const phone = res?.ok ? pickPhone(Array.isArray(body?.contacts) ? body.contacts : []) : undefined;
    if (!phone) {
      tab?.close();
      return setError(res?.ok ? t('noPhone') : (body?.error?.message ?? t('error')));
    }
    const message = clientName ? t('message', { name: clientName }) : undefined;
    const url = whatsappLink(phone, message);
    // Si el navegador no dejó abrir la pestaña, se navega esta: mejor perder el lugar que no poder escribir.
    if (tab) tab.location.href = url;
    else window.location.href = url;
  }

  const cls =
    variant === 'icon'
      ? 'flex h-8 w-9 items-center justify-center rounded-lg border border-k-border bg-white text-k-success hover:bg-k-success-bg'
      : variant === 'compact'
      ? 'h-8 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-success hover:bg-k-success-bg'
      : 'h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-success hover:bg-k-success-bg';

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        aria-label={variant === 'icon' ? t('label') : undefined}
        title={variant === 'icon' ? t('label') : undefined}
        className={`${cls} disabled:opacity-60`}
      >
        {variant === 'icon' ? (
          // Solo el ícono: el nombre va en `aria-label` y en el tooltip, que es lo que lee un lector de pantalla.
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.5-4A8 8 0 1 1 20 11.5z" />
            <path d="M9.5 8.8c.2 2.6 2.7 5 5.3 5.2l1-1.3-1.8-.9-.7.7a4 4 0 0 1-1.9-1.9l.7-.7-.9-1.8-1.7 1.1z" fill="currentColor" stroke="none" />
          </svg>
        ) : busy ? (
          t('opening')
        ) : (
          t('label')
        )}
      </button>
      {error && (
        <span role="alert" className="max-w-[220px] text-right text-[12px] text-k-danger">
          {error}
        </span>
      )}
    </span>
  );
}
