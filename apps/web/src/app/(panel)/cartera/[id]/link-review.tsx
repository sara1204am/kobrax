'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ClientDetail } from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * «Revisar vínculo» (D2 · opción B). La importación creó este cliente porque su nombre coincide con
 * el de otro que ya existía, o con otra operación del mismo reporte, y **no los juntó sola**. Los
 * créditos ya están en cartera y en mora: esto no frena la cobranza, sólo pide una decisión.
 *
 *  · «Es esta persona» → cada crédito de acá pasa al cliente elegido (el mismo crédito, con su
 *    historia) y la decisión queda guardada: la próxima operación de esta persona entra directo.
 *  · «Es otra persona» → la revisión se cierra y el cliente queda como está.
 */
export function LinkReview({ client, creditIds }: { client: ClientDetail; creditIds: string[] }) {
  const t = useTranslations('portfolio.linkReview');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!client.linkReviewPending) return null;
  const canDecide = can('credit:write');
  const suggestions = client.linkSuggestions ?? [];

  async function linkTo(targetId: string) {
    setError(null);
    setBusy(targetId);
    // Uno por uno y en orden: si uno falla, los anteriores ya quedaron bien y se dice cuál no.
    for (const id of creditIds) {
      const res = await sendJson(`/api/credits/${id}/link-client`, { clientId: targetId }, 'POST');
      if (!res.ok) {
        setBusy(null);
        setError(errorText(res.data.error, t, locale));
        return;
      }
    }
    toast(t('linked'));
    // Este cliente se dio de baja al quedar vacío: la ficha que sirve es la del elegido.
    router.push(`/cartera/${targetId}`);
  }

  async function confirmNew() {
    setError(null);
    setBusy('new');
    const res = await sendJson(`/api/credits/link-review/${client.id}/confirm`, {}, 'POST');
    setBusy(null);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    toast(t('confirmed'));
    router.refresh();
  }

  return (
    <section className="mb-4 rounded-2xl border-l-[3px] border-k-warning bg-k-warning-bg px-5 py-4">
      <h2 className="text-[15px] font-semibold text-k-warning-text">{t('title')}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-k-warning-text">
        {suggestions.length > 0 ? t('textSuggestions') : t('textSameFile')}
      </p>
      <ErrorBanner message={error} />
      {suggestions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {suggestions.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 rounded-xl bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <a href={`/cartera/${s.id}`} className="text-[14px] font-medium text-k-navy hover:underline" target="_blank" rel="noreferrer">
                {s.displayName} <span className="text-[12px] font-normal text-k-text-2">· {t('credits', { n: s.creditCount })}</span>
              </a>
              {canDecide && (
                <span className="sm:w-auto">
                  <Button onClick={() => void linkTo(s.id)} loading={busy === s.id} disabled={busy !== null} className="sm:w-auto sm:px-5">
                    {t('isThisOne')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canDecide && (
        <div className="mt-3">
          <span className="inline-block sm:w-auto">
            <Button variant="ghost" onClick={() => void confirmNew()} loading={busy === 'new'} disabled={busy !== null} className="sm:w-auto sm:px-5">
              {t('isNew')}
            </Button>
          </span>
        </div>
      )}
    </section>
  );
}
