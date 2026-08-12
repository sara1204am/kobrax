'use client';

import { useTranslations } from 'next-intl';
import { memberName, RouteStatus, type Member } from '@kobrax/shared';
import { UrlFilters } from '@/components/url-filters';

/**
 * Los filtros de la lista de rutas. El mecanismo lo pone `UrlFilters`, que comparte con casos;
 * acá va sólo qué se filtra.
 *
 * El día **no** está acá: lo maneja el `DayPicker`, que además dibuja la fecha en grande.
 */
export function RouteFilters({ members, showCollector }: { members: Member[]; showCollector: boolean }) {
  const t = useTranslations('panel.routes');

  return (
    <UrlFilters
      clearLabel={t('filters.clear')}
      selects={[
        ...(showCollector
          ? [
              {
                key: 'collectorId',
                label: t('filters.collector'),
                all: t('filters.all'),
                options: members.map((m) => ({ value: m.userId, label: memberName(m) })),
              },
            ]
          : []),
        {
          key: 'status',
          label: t('filters.status'),
          all: t('filters.all'),
          options: Object.values(RouteStatus).map((s) => ({ value: s, label: t(`status.${s}`) })),
        },
      ]}
    />
  );
}
