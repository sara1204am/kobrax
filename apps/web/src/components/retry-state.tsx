'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/panel-ui';

/**
 * «No se pudo cargar» **con un botón que reintenta**.
 *
 * Sin el botón, la única salida de un error es recargar la página entera —y perder el contexto de
 * filtros que la persona venía armando—, o irse. `router.refresh()` vuelve a pedirle los datos al
 * server component sin tocar la URL: el mismo filtro, el mismo orden, otra oportunidad.
 *
 * Es cliente por el botón y nada más; el mensaje lo escribe quien la usa, porque el que sabe qué
 * falló es el servidor.
 */
export function RetryState({ title, text }: { title: string; text?: string }) {
  const router = useRouter();
  const t = useTranslations('panel.table');

  return (
    <EmptyState
      title={title}
      text={text}
      action={
        <button
          type="button"
          onClick={() => router.refresh()}
          className="min-h-[40px] rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-purple hover:bg-k-bg"
        >
          {t('retry')}
        </button>
      }
    />
  );
}
