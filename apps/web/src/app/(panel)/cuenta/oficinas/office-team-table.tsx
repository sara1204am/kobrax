'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import { EmptyState } from '@/components/panel-ui';
import { SearchBox } from '@/components/search-box';
import { money } from '@/lib/format';
import { isKnownRole } from '@/lib/team';
import type { OfficePortfolio } from '@/lib/offices';
import type { OfficeTeamRow } from '@/lib/office-team-table';
import { useOfficeApi } from './use-office-api';

/** Las cifras de una persona, ya sumadas por moneda: «Bs 11.000,00» (o «Bs 1.000,00 · $us 200,00» con dos monedas). */
function sumBy(p: OfficePortfolio, pick: (c: OfficePortfolio['byCurrency'][number]) => number): string {
  return p.byCurrency.length === 0 ? money(0) : p.byCurrency.map((c) => money(pick(c), c.currency)).join(' · ');
}

/**
 * El equipo de una oficina con su cartera, en la tabla de listado de siempre (`DataTable`): búsqueda global y orden en la
 * URL, **sin filtros**. La mora es el saldo adeudado de los créditos atrasados, no la cuota, y sale en rojo (`k-danger`)
 * sólo si la persona tiene créditos atrasados. «Sacar» es un botón.
 */
export function OfficeTeamTable({
  rows,
  meta,
  searching,
  editable,
  busy,
  onTakeOut,
}: {
  rows: OfficeTeamRow[];
  meta: PageMeta;
  /** ¿Hay una búsqueda puesta? Decide entre «sin equipo» y «sin resultados». */
  searching: boolean;
  editable: boolean;
  busy: boolean;
  onTakeOut: (userId: string) => void;
}) {
  const { t } = useOfficeApi();
  const tr = useTranslations('team.roles');
  const late = (r: OfficeTeamRow) => r.portfolio.arrearsCredits > 0;

  const columns: Column<OfficeTeamRow>[] = [
    {
      key: 'name',
      header: t('team.stats.person'),
      sortable: true,
      render: (r) => (
        <span className="block min-w-0">
          <span className="block truncate text-k-text">{r.name}</span>
          <span className="block truncate text-[12px] text-k-text-2">{isKnownRole(r.roleName) ? tr(r.roleName) : r.roleName}</span>
        </span>
      ),
    },
    { key: 'credits', header: t('team.stats.credits'), sortable: true, defaultDir: 'desc', numeric: true, render: (r) => r.portfolio.credits },
    {
      key: 'arrearsCredits',
      header: t('team.stats.arrearsCredits'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: (r) => <span className={late(r) ? 'text-k-danger' : undefined}>{r.portfolio.arrearsCredits}</span>,
    },
    { key: 'balance', header: t('team.stats.portfolio'), sortable: true, defaultDir: 'desc', numeric: true, render: (r) => sumBy(r.portfolio, (c) => c.balance) },
    {
      key: 'arrearsBalance',
      header: t('team.stats.arrears'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: (r) => <span className={late(r) ? 'text-k-danger' : undefined}>{sumBy(r.portfolio, (c) => c.arrearsBalance)}</span>,
    },
    ...(editable
      ? [
          {
            key: 'actions',
            header: '',
            numeric: true,
            render: (r: OfficeTeamRow) => (
              <span className="inline-block w-24">
                <Button type="button" variant="ghost" disabled={busy} aria-label={t('team.takeOutOf', { name: r.name })} className="!h-9 !text-[13px] !text-k-danger" onClick={() => onTakeOut(r.userId)}>
                  {t('team.takeOut')}
                </Button>
              </span>
            ),
          } satisfies Column<OfficeTeamRow>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.userId}
      meta={meta}
      entityLabel={t('team.table.entity')}
      search={<SearchBox wide label={t('team.table.searchLabel')} placeholder={t('team.table.searchPlaceholder')} />}
      filtered={searching}
      empty={<EmptyState title={t('team.none')} />}
      noResults={<EmptyState title={t('team.table.noResults')} text={t('team.table.noResultsHint')} />}
    />
  );
}
