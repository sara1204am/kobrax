'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { startTour } from '@/components/tour';

export interface HelpItem {
  id: string;
  name: string;
  href: string;
  what: string;
  does: string;
  startWith: string;
  actions: Array<{ id: string; title: string; what: string; does: string }>;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** La lista de ayuda con su búsqueda: filtra por el texto ya traducido (módulo, qué hace y acciones). */
export function HelpCenter({ items }: { items: HelpItem[] }) {
  const t = useTranslations('helpCenter');
  const [q, setQ] = useState('');
  const needle = norm(q.trim());
  const shown = needle
    ? items.filter((i) =>
        norm(
          [
            i.name,
            i.what,
            i.does,
            i.startWith,
            ...i.actions.flatMap((a) => [a.title, a.what, a.does]),
          ].join(' '),
        ).includes(needle),
      )
    : items;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('search')}
          placeholder={t('search')}
          className="min-h-[44px] w-full max-w-sm rounded-xl border border-k-border bg-white px-3 text-k-base"
        />
        <button
          type="button"
          onClick={() => startTour()}
          className="min-h-[44px] rounded-xl bg-k-navy px-4 text-k-base font-medium text-white hover:bg-k-navy/90"
        >
          {t('tour')}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-k-base text-k-text-2">{t('empty')}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((i) => (
            <li key={i.id} className="rounded-xl border border-k-border bg-white p-4">
              <h2 className="text-k-lg font-semibold text-k-navy">{i.name}</h2>
              <p className="mt-1 text-k-base font-medium text-k-text">{i.what}</p>
              <p className="text-k-sm text-k-text-2">{i.does}</p>
              <p className="mt-1 text-k-sm text-k-text-2">{i.startWith}</p>
              {i.actions.length > 0 && (
                <>
                  <h3 className="mt-3 text-k-xs font-semibold uppercase tracking-wide text-k-muted">
                    {t('actions')}
                  </h3>
                  <ul className="mt-1 space-y-1">
                    {i.actions.map((a) => (
                      <li key={a.id} className="text-k-sm text-k-text">
                        <span className="font-medium">{a.title}.</span>{' '}
                        <span className="text-k-text-2">{a.what}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Link
                href={i.href}
                className="mt-3 inline-block text-k-sm font-medium text-k-periwinkle hover:underline"
              >
                {t('open', { name: i.name })}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
