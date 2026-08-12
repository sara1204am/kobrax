'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CasePriority, CaseStatus, memberName, type Member } from '@kobrax/shared';

/**
 * Los filtros de la lista de casos.
 *
 * **Escriben en la URL**, igual que el orden y la página: la vista se comparte por link, «atrás»
 * funciona, y el server component lee los mismos `searchParams` para pedirle a la API lo que toca.
 * No hay dos verdades sobre qué se está filtrando.
 *
 * Cada cambio vuelve a la página 1: filtrar cambia qué filas existen, y quedarse en la 7
 * mostraría el medio de una lista que la persona no vio empezar.
 */
export function CaseFilters({ members, showAssignee }: { members: Member[]; showAssignee: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useTranslations('panel.cases');

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  }

  const dirty = ['status', 'priority', 'assigneeId', 'overdue'].some((key) => params.get(key));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Filter label={t('filters.status')} value={params.get('status') ?? ''} onChange={(v) => set('status', v)}>
        <option value="">{t('filters.all')}</option>
        {Object.values(CaseStatus).map((status) => (
          <option key={status} value={status}>
            {t(`status.${status}`)}
          </option>
        ))}
      </Filter>

      <Filter label={t('filters.priority')} value={params.get('priority') ?? ''} onChange={(v) => set('priority', v)}>
        <option value="">{t('filters.all')}</option>
        {Object.values(CasePriority).map((priority) => (
          <option key={priority} value={priority}>
            {t(`priority.${priority}`)}
          </option>
        ))}
      </Filter>

      {/* Sin `case:assign` la API acota a lo propio y este filtro no cambiaría nada: no se dibuja. */}
      {showAssignee && (
        <Filter
          label={t('filters.assignee')}
          value={params.get('assigneeId') ?? ''}
          onChange={(v) => set('assigneeId', v)}
        >
          <option value="">{t('filters.all')}</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {memberName(member)}
            </option>
          ))}
        </Filter>
      )}

      <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[14px] text-k-text">
        <input
          type="checkbox"
          checked={params.get('overdue') === 'true'}
          onChange={(e) => set('overdue', e.target.checked ? 'true' : '')}
          className="h-4 w-4 accent-k-purple"
        />
        {t('filters.overdue')}
      </label>

      {dirty && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="min-h-[40px] text-[14px] font-medium text-k-purple hover:underline"
        >
          {t('filters.clear')}
        </button>
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-[160px] rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
      >
        {children}
      </select>
    </label>
  );
}
