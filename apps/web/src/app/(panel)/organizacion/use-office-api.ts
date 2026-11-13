'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { errorText } from '@/lib/api-error';

type Call = () => ReturnType<typeof sendJson>;

/**
 * Una llamada al BFF con su `busy`, su error en pantalla y el refresco de la página al terminar bien. Es el patrón de la
 * web (server components + BFF + `router.refresh()`): no hay caché de cliente.
 *
 * Un 409 no es un error genérico: es el servidor diciendo «esto choca con una regla» (baja con dependientes, una sola
 * asignación por persona, ciclo al mover). Se muestra SU motivo.
 */
export function useOfficeApi() {
  const t = useTranslations('account.offices');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: Call, okMessage?: string, onDone?: () => void): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { ok, status, data } = await call();
    setBusy(false);
    if (!ok) {
      const base = errorText(data.error, t, locale);
      setError(status === 409 && !data.error?.message ? t('errors.conflict') : base);
      return false;
    }
    onDone?.();
    if (okMessage) toast(okMessage);
    router.refresh();
    return true;
  }

  return { busy, error, setError, run, t };
}
