'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { RoleHistoryPage } from '@kobrax/shared';
import { EmptyState } from '@/components/panel-ui';
import { dateTime } from '@/lib/format';
import { permissionKey } from '@/lib/roles';

/** El historial de un rol (vista E): quién, cuándo, qué se añadió o quitó y por qué. Pagina por cursor. */
export function HistoryList({ roleKey, initial, timezone }: { roleKey: string; initial: RoleHistoryPage; timezone: string | null }) {
  const t = useTranslations('roles.history');
  const tp = useTranslations('permissions');
  const locale = useLocale();
  const [page, setPage] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more() {
    if (!page.nextCursor) return;
    setBusy(true);
    setFailed(false);
    const res = await fetch(`/api/roles/${encodeURIComponent(roleKey)}/history?cursor=${encodeURIComponent(page.nextCursor)}`).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setFailed(true);
    const next = (await res.json()) as RoleHistoryPage;
    setPage({ items: [...page.items, ...next.items], nextCursor: next.nextCursor });
  }

  if (page.items.length === 0) return <EmptyState title={t('empty')} />;
  const names = (codes: string[]) => codes.map((c) => tp(`${permissionKey(c)}.name`)).join(', ');

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {page.items.map((e) => (
          <li key={e.id} className="rounded-lg border border-k-border bg-white p-3 text-[13px]">
            <p className="text-k-text">
              <span className="font-medium">{dateTime(e.at, locale, timezone ?? undefined)}</span>
              {' · '}
              {e.actorType === 'PLATFORM' ? t('byPlatform') : (e.actorName ?? t('unknown'))}
              {' · '}
              {t.has(`actions.${e.action}`) ? t(`actions.${e.action}`) : e.action}
            </p>
            {e.added.length > 0 && (
              <p className="mt-1 text-k-text-2">
                <span className="font-medium text-k-success">+ {t('added')}:</span> {names(e.added)}
              </p>
            )}
            {e.removed.length > 0 && (
              <p className="mt-1 text-k-text-2">
                <span className="font-medium text-k-danger">− {t('removed')}:</span> {names(e.removed)}
              </p>
            )}
            {e.added.length === 0 && e.removed.length === 0 && <p className="mt-1 text-k-muted">{t('noDetail')}</p>}
            {e.reason && <p className="mt-1 text-k-muted">{t('reason', { reason: e.reason })}</p>}
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="text-[13px] text-k-danger">
          {t('loadMore')} ✗
        </p>
      )}
      {page.nextCursor && (
        <button type="button" onClick={() => void more()} disabled={busy} className="h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-50">
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
