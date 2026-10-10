'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RouteStatus } from '@kobrax/shared';
import { sendJson } from '@/lib/client';

/**
 * «Iniciar» una ruta planificada, desde la fila de «Hoy».
 *
 * Solo se ofrece a quien anda la ruta (su cobrador o quien la armó): la API vuelve a validar y rechaza al resto, así
 * que esto es cortesía, no la guarda. Un cambio que exige motivo (iniciar la ruta de otra persona) se hace desde el
 * detalle, donde hay dónde escribirlo.
 */
export function StartRouteButton({ routeId }: { routeId: string }) {
  const t = useTranslations('panel.routes');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson(`/api/routes/${routeId}/status`, { status: RouteStatus.IN_PROGRESS }, 'PATCH');
    setBusy(false);
    if (!ok) return setError(data.error?.message ?? t('errors.generic'));
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="h-8 rounded-lg bg-k-navy px-3.5 text-[13px] font-medium text-white hover:bg-k-slate disabled:opacity-60"
      >
        {t('todayBoard.start')}
      </button>
      {error && (
        <span role="alert" className="max-w-[220px] text-right text-[12px] text-k-danger">
          {error}
        </span>
      )}
    </span>
  );
}
