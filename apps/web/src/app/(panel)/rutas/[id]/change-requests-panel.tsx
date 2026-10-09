'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { RouteChangeRequestItem } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { ReasonDialog } from '@/components/reason-dialog';
import { sendJson } from '@/lib/client';
import { dateTime } from '@/lib/format';

type Decision = 'APPROVE' | 'REJECT' | 'WITHDRAW';

const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral', WITHDRAWN: 'neutral' } as const;

/**
 * Los pedidos de cambio de esta ruta (F4/12 · decisión 1).
 *
 * Quien **armó** la ruta ve todos y **aprueba o rechaza** (al aprobar, la API aplica el cambio con las reglas de
 * siempre: si ya no se puede —la parada se gestionó, la ruta se cerró— lo dice y el pedido queda sin resolver). Quien
 * **pidió** ve los suyos y puede **retirarlos** mientras nadie los resolvió.
 *
 * Solo se dibuja si hay algo que mostrar: una ruta sin pedidos no gana un recuadro vacío.
 */
export function ChangeRequestsPanel({
  routeId,
  requests,
  isOwner,
  viewerId,
}: {
  routeId: string;
  requests: RouteChangeRequestItem[];
  isOwner: boolean;
  viewerId?: string;
}) {
  const t = useTranslations('panel.routes.requests');
  const locale = useLocale();
  const router = useRouter();
  const [target, setTarget] = useState<{ request: RouteChangeRequestItem; decision: Decision } | null>(null);

  if (requests.length === 0) return null;
  const pending = requests.filter((r) => r.status === 'PENDING');
  const resolved = requests.filter((r) => r.status !== 'PENDING').slice(0, 5);

  async function decide(note: string): Promise<string | null> {
    if (!target) return null;
    const { ok, data } = await sendJson(
      `/api/routes/${routeId}/change-requests/${target.request.id}`,
      { decision: target.decision, ...(note ? { note } : {}) },
      'PATCH',
    );
    if (!ok) return data.error?.message ?? t('error');
    router.refresh();
    return null;
  }

  const kindText = (r: RouteChangeRequestItem) => t(`kind.${r.kind}`);
  const btn = 'h-8 rounded-lg px-3 text-[13px] font-medium';

  return (
    <section aria-label={t('title')} className="rounded-2xl border border-k-border bg-white p-5 shadow-k-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold text-k-navy">{t('title')}</h2>
        {pending.length > 0 && <Badge tone="warning">{t('pending', { n: pending.length })}</Badge>}
      </div>

      {pending.length > 0 && (
        <ul className="mt-4 divide-y divide-k-border">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-k-text">
                  {kindText(r)} <span className="font-normal text-k-text-2">· {r.requestedByName ?? t('someone')}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-k-text-2">«{r.reason}»</p>
                <p className="mt-0.5 text-[12px] text-k-muted">{dateTime(r.createdAt, locale)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {isOwner && (
                  <>
                    <button type="button" onClick={() => setTarget({ request: r, decision: 'APPROVE' })} className={`${btn} bg-k-navy text-white hover:bg-k-slate`}>
                      {t('approve')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTarget({ request: r, decision: 'REJECT' })}
                      className={`${btn} border border-k-border bg-white text-k-text-2 hover:bg-k-bg`}
                    >
                      {t('reject')}
                    </button>
                  </>
                )}
                {!isOwner && r.requestedBy === viewerId && (
                  <button
                    type="button"
                    onClick={() => setTarget({ request: r, decision: 'WITHDRAW' })}
                    className={`${btn} border border-k-border bg-white text-k-text-2 hover:bg-k-bg`}
                  >
                    {t('withdraw')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] text-k-text-2">{t('history', { n: resolved.length })}</summary>
          <ul className="mt-2 space-y-2">
            {resolved.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-[13px] text-k-text-2">
                <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                <span>
                  {kindText(r)} · {r.requestedByName ?? t('someone')}
                </span>
                {r.decisionNote && <span className="text-k-muted">«{r.decisionNote}»</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ReasonDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? t(`dialog.${target.decision}`) : ''}
        confirmLabel={target ? t(`confirm.${target.decision}`) : ''}
        tone={target?.decision === 'REJECT' ? 'danger' : 'primary'}
        required={false}
        label={t('noteLabel')}
        placeholder={t('notePlaceholder')}
        onConfirm={decide}
      >
        {target && (
          <>
            <strong className="text-k-text">{kindText(target.request)}</strong> — «{target.request.reason}»
          </>
        )}
      </ReasonDialog>
    </section>
  );
}
