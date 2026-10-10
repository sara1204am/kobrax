'use client';

import { useTranslations } from 'next-intl';
import { AgendaItemType, mapLink, whatsappLink } from '@kobrax/shared';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';

/**
 * Lo que se puede hacer con el dato de la gestión, según su tipo — el equivalente web de «Llamar / WhatsApp / Navegar»
 * del teléfono:
 *
 *  - Llamada → copiar el teléfono (en escritorio un enlace `tel:` casi nunca abre nada útil).
 *  - WhatsApp → abrir la conversación con el mensaje escrito.
 *  - Visita → ver la ubicación en un mapa.
 *
 * 🔴 **Hacerlo no registra nada.** Abrir WhatsApp o copiar un número no prueba que se llamó o se escribió: la
 * ejecución se registra aparte, con su resultado. Por eso estos botones no tocan el estado de la gestión.
 *
 * Viven en el detalle y no en el menú de la lista porque el teléfono y la dirección se revelan SOLO acá (y la API lo
 * audita): la lista no los trae, a propósito.
 */
export function ContactActions({
  type,
  phone,
  message,
  latitude,
  longitude,
}: {
  type: AgendaItemType;
  phone?: string;
  message?: string;
  latitude?: number;
  longitude?: number;
}) {
  const t = useTranslations('panel.agenda');
  const toast = useToast();
  const cls = 'sm:w-auto sm:px-6';

  if (type === AgendaItemType.WHATSAPP && phone) {
    return (
      <a href={whatsappLink(phone, message)} target="_blank" rel="noopener noreferrer" className="contents">
        <Button variant="ghost" className={cls} type="button">
          {t('detail.openWhatsapp')}
        </Button>
      </a>
    );
  }

  if (type === AgendaItemType.CALL && phone) {
    return (
      <Button
        variant="ghost"
        className={cls}
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(phone)
            .then(() => toast(t('detail.phoneCopied')))
            .catch(() => toast(phone));
        }}
      >
        {t('detail.copyPhone')}
      </Button>
    );
  }

  if (type === AgendaItemType.VISIT && latitude != null && longitude != null) {
    return (
      <a href={mapLink(latitude, longitude)} target="_blank" rel="noopener noreferrer" className="contents">
        <Button variant="ghost" className={cls} type="button">
          {t('detail.viewLocation')}
        </Button>
      </a>
    );
  }

  return null;
}
