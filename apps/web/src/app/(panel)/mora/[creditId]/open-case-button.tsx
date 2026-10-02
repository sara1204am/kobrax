'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { postJson } from '@/lib/client';

/**
 * Abre el caso de un crédito en mora que todavía no tiene uno.
 *
 * Los casos los abre el trabajo diario al cruzar la mora, pero hay créditos vencidos que no entran por ahí
 * (sin cronograma ni próxima fecha, o importados con el reporte desactualizado). Sin caso no se puede
 * registrar una gestión ni asignar un cobrador, así que esta es la salida: la hace quien puede escribir
 * casos, y la API deja un solo caso abierto por crédito.
 */
export function OpenCaseButton({ creditId }: { creditId: string }) {
  const t = useTranslations('panel.cases');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    const res = await postJson('/api/cases', { creditId });
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.data.error, t, locale), 'danger');
      return;
    }
    toast(t('detail.caseOpened'));
    router.refresh();
  }

  return (
    <Button type="button" onClick={open} loading={busy}>
      {t('detail.openCase')}
    </Button>
  );
}
