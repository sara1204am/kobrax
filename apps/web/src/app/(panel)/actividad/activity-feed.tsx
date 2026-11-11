'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AccountActivityEvent, AccountActivityPage } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { dateTime } from '@/lib/format';

/** Los tipos de cambio que se pueden filtrar; los mismos que la API deja leer. */
const ENTITIES = ['account', 'branch', 'catalog_item', 'arrear_category', 'user_account', 'account_request'] as const;
const ACTIONS = new Set(['CREATE', 'UPDATE', 'DELETE', 'REASSIGN_ON_DEACTIVATE']);
const PAGE = 30;

/**
 * Quién cambió qué en la cuenta. Lectura de la auditoría acotada a la cuenta: el servidor ya digirió los cambios
 * (sin ruido ni secretos), acá sólo se pintan. «Cargar más» sigue el cursor que devolvió la página anterior.
 */
export function ActivityFeed({ initial, timezone }: { initial: AccountActivityPage; timezone: string | null }) {
  const t = useTranslations('account.activity');
  const locale = useLocale();
  const [items, setItems] = useState<AccountActivityEvent[]>(initial.items);
  const [next, setNext] = useState<string | null>(initial.next);
  const [entity, setEntity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(opts: { before?: string; entity: string; replace: boolean }) {
    setBusy(true);
    setError(null);
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (opts.before) qs.set('before', opts.before);
    if (opts.entity) qs.set('entity', opts.entity);
    const res = await fetch(`/api/account/activity?${qs.toString()}`).catch(() => null);
    const json = (await res?.json().catch(() => null)) as (AccountActivityPage & { error?: { message: string } }) | null;
    setBusy(false);
    if (!res?.ok || !json?.items) {
      setError(json?.error?.message ?? t('loadError'));
      return;
    }
    setItems((prev) => (opts.replace ? json.items : [...prev, ...json.items]));
    setNext(json.next);
  }

  const entityLabel = (e: string) => (ENTITIES.includes(e as (typeof ENTITIES)[number]) ? t(`entities.${e}`) : e);
  const actionLabel = (a: string) => (ACTIONS.has(a) ? t(`actions.${a}`) : a);

  return (
    <Section title={t('title')} inner="space-y-5 p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      <Field label={t('filter')}>
        <Select
          value={entity}
          disabled={busy}
          onChange={(e) => {
            setEntity(e.target.value);
            void load({ entity: e.target.value, replace: true });
          }}
        >
          <option value="">{t('all')}</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {t(`entities.${e}`)}
            </option>
          ))}
        </Select>
      </Field>

      <ErrorBanner message={error} />

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-k-border px-4 py-6 text-center text-[13px] text-k-text-2">{t('empty')}</p>
      ) : (
        <ol className="divide-y divide-k-border rounded-xl border border-k-border">
          {items.map((ev) => (
            <li key={ev.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[14px] text-k-text">
                  <span className="font-medium">
                    {ev.via ? t('byKobrax', { via: ev.via }) : (ev.actorName ?? t('unknownActor'))}
                  </span>
                  {' · '}
                  {actionLabel(ev.action)} {entityLabel(ev.entity)}
                </p>
                <time dateTime={ev.at} className="text-[12px] text-k-text-2">
                  {dateTime(ev.at, locale, timezone ?? undefined)}
                  {ev.ip ? ` · ${ev.ip}` : ''}
                </time>
              </div>
              {ev.changes.length > 0 && (
                <ul className="mt-2 space-y-1 text-[12px] text-k-text-2">
                  {ev.changes.map((c) => (
                    <li key={c.field}>
                      <span className="font-mono text-k-text">{c.field}</span>: {c.from ?? t('empty_value')} → {c.to ?? t('empty_value')}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {next && (
        <div className="flex justify-center">
          <span className="w-48">
            <Button variant="ghost" loading={busy} onClick={() => void load({ before: next, entity, replace: false })}>
              {t('more')}
            </Button>
          </span>
        </div>
      )}
    </Section>
  );
}
