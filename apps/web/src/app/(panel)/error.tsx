'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { EmptyState } from '@/components/panel-ui';

/**
 * Boundary de error del panel. Atrapa lo que reviente adentro de una pantalla **sin tirar
 * abajo el shell**: el menú y la topbar siguen ahí, así que se puede ir a otro lado.
 *
 * No muestra el mensaje del error: puede traer detalles del servidor. Se ofrece reintentar,
 * que es lo único accionable.
 */
export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('panel.error');
  return (
    <EmptyState
      title={t('title')}
      text={t('text')}
      action={
        <span className="w-48">
          <Button variant="ghost" onClick={reset}>
            {t('retry')}
          </Button>
        </span>
      }
    />
  );
}
