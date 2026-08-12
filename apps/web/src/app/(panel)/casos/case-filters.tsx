'use client';

import { useTranslations } from 'next-intl';
import { CasePriority, CaseStatus, memberName, type Member } from '@kobrax/shared';
import { UrlFilters } from '@/components/url-filters';

/**
 * Los filtros de la lista de casos.
 *
 * El mecanismo —escribir en la URL y volver a la página 1— vive en `UrlFilters`, que comparte con
 * rutas. Acá quedan sólo **qué** se filtra y cómo se llama cada opción.
 */
export function CaseFilters({ members, showAssignee }: { members: Member[]; showAssignee: boolean }) {
  const t = useTranslations('panel.cases');

  return (
    <UrlFilters
      clearLabel={t('filters.clear')}
      selects={[
        {
          key: 'status',
          label: t('filters.status'),
          all: t('filters.all'),
          options: Object.values(CaseStatus).map((status) => ({ value: status, label: t(`status.${status}`) })),
        },
        {
          key: 'priority',
          label: t('filters.priority'),
          all: t('filters.all'),
          options: Object.values(CasePriority).map((p) => ({ value: p, label: t(`priority.${p}`) })),
        },
        // Sin `case:assign` la API acota a lo propio y este filtro no cambiaría nada: no se dibuja.
        ...(showAssignee
          ? [
              {
                key: 'assigneeId',
                label: t('filters.assignee'),
                all: t('filters.all'),
                options: members.map((m) => ({ value: m.userId, label: memberName(m) })),
              },
            ]
          : []),
      ]}
      toggles={[{ key: 'overdue', label: t('filters.overdue') }]}
    />
  );
}
