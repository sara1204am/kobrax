'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DashboardDefinition } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { Modal } from '@/components/modal';
import { sendJson } from '@/lib/client';
import { DASHBOARD_VIEW_COOKIE } from '@/lib/dashboard';

/**
 * Los tableros de la persona, **como pestañas**: cada uno con sus widgets (uno de indicadores, otro de gráficos, otro de agenda…)
 * en vez de un solo tablero larguísimo con todo.
 *
 * - La pestaña elegida viaja en la URL (`?view=`) y además se recuerda en una cookie, para que al volver al dashboard se abra la
 *   última que miraste. Los filtros (`from`, `to`, cobrador…) se conservan al cambiar de pestaña: el período es el mismo para todas.
 * - El «+» crea un tablero vacío y entra directo en modo edición para llenarlo.
 * - En celular las pestañas se deslizan de lado: nunca se parten en dos renglones.
 */
export function DashboardTabs({ dashboards, currentId }: { dashboards: DashboardDefinition[]; currentId?: string }) {
  const t = useTranslations('panel.dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function hrefFor(id: string, extra: Record<string, string> = {}): string {
    const next = new URLSearchParams(params.toString());
    next.set('view', id);
    for (const [k, v] of Object.entries(extra)) next.set(k, v);
    return `${pathname}?${next.toString()}`;
  }

  function remember(id: string) {
    try {
      document.cookie = `${DASHBOARD_VIEW_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=strict`;
    } catch {
      /* sin cookies: la pestaña igual viaja en la URL */
    }
  }

  async function create() {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendJson<{ id?: string }>('/api/dashboards', { name: clean, widgets: [] });
    setBusy(false);
    const id = res.data.id;
    if (!res.ok || !id) {
      setError(t('saveError'));
      return;
    }
    setCreating(false);
    setName('');
    remember(id);
    router.push(hrefFor(id, { edit: '1' }));
    router.refresh();
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <nav aria-label={t('tabs.label')} className="k-scroll-x min-w-0 flex-1 overflow-x-auto">
        <ul className="flex w-max items-end gap-1 border-b border-k-border">
          {dashboards.map((d) => {
            const active = d.id === currentId;
            return (
              <li key={d.id}>
                <Link
                  href={hrefFor(d.id)}
                  onClick={() => remember(d.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`-mb-px block max-w-[220px] truncate border-b-2 px-4 py-2.5 text-[14px] font-medium transition-colors ${
                    active
                      ? 'border-k-purple text-k-navy'
                      : 'border-transparent text-k-text-2 hover:border-k-border hover:text-k-text'
                  }`}
                >
                  {d.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <button
        type="button"
        onClick={() => {
          setName('');
          setError(null);
          setCreating(true);
        }}
        title={t('tabs.new')}
        aria-label={t('tabs.new')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[20px] leading-none text-k-purple hover:bg-k-highlight"
      >
        +
      </button>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('tabs.newTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)} className="sm:w-auto sm:px-5">
              {t('cancel')}
            </Button>
            <Button onClick={create} loading={busy} disabled={!name.trim()} className="sm:w-auto sm:px-5">
              {t('tabs.create')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <Field label={t('dashboardName')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder={t('tabs.namePlaceholder')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
          />
        </Field>
      </Modal>
    </div>
  );
}
