'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useToast } from '@/components/toast';
import { TextButton } from '@/components/ui';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * Cerrar una promesa **a mano**: «cumplida» o «incumplida».
 *
 * 🔴 **Además del cierre automático.** Cuando los pagos registrados cubren la promesa, se cierra sola como cumplida; pero no todo pago pasa
 * por el sistema (efectivo que llegó por otra vía, un acuerdo cambiado), así que quien hace la cobranza también puede cerrarla con un botón.
 * Es la misma gestión que registra el detalle de la agenda (`POST /agenda/:id/complete`), así que deja el mismo rastro en el historial.
 */
export function PromiseActions({ promiseId }: { promiseId: string }) {
  const t = useTranslations('panel.mora.ficha.promises');
  const tm = useTranslations('panel.mora');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<'PROMISE_KEPT' | 'PROMISE_BROKEN' | null>(null);

  async function close(outcome: 'PROMISE_KEPT' | 'PROMISE_BROKEN') {
    setBusy(outcome);
    const res = await sendJson(`/api/agenda/${promiseId}/complete`, { outcome });
    setBusy(null);
    if (!res.ok) {
      toast(errorText(res.data.error, tm, locale) || t('closeError'), 'danger');
      return;
    }
    toast(t('closed'));
    router.refresh();
  }

  return (
    <span className="flex flex-wrap items-center gap-3 text-k-xs">
      <TextButton onClick={() => void close('PROMISE_KEPT')} disabled={busy !== null} tone="success" className="!text-k-xs">
        {busy === 'PROMISE_KEPT' ? t('closing') : t('markKept')}
      </TextButton>
      <TextButton onClick={() => void close('PROMISE_BROKEN')} disabled={busy !== null} tone="danger" className="!text-k-xs">
        {busy === 'PROMISE_BROKEN' ? t('closing') : t('markBroken')}
      </TextButton>
    </span>
  );
}
