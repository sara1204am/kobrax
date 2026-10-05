'use client';

import { useTranslations } from 'next-intl';
import { AgendaItemStatus, AgendaItemType, memberName, type Member } from '@kobrax/shared';
import { Input, Select } from '@/components/ui';
import { daySummary } from '@/lib/agenda';

export interface FilterValues {
  q: string;
  gestor: string;
  tipo: string;
  estado: string;
}

/**
 * La tarjeta «Filtros»: texto, cobrador, tipo y estado. El cobrador y el tipo viajan en la URL (se comparten por
 * link, igual que el selector de equipo); la búsqueda y el estado se aplican en el navegador sobre el día
 * que ya llegó entero.
 */
export function FiltersCard({
  values,
  supervises,
  members,
  onChange,
  onClear,
}: {
  values: FilterValues;
  supervises: boolean;
  members: Member[];
  onChange: (patch: Partial<FilterValues>) => void;
  onClear: () => void;
}) {
  const t = useTranslations('panel.agenda');
  const dirty = !!(values.q || values.gestor || values.tipo || values.estado);
  const cls = 'h-10 w-full text-[13px]';

  return (
    <section aria-label={t('filters.title')} className="rounded-2xl border border-k-border bg-white p-4 shadow-k-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-k-navy">{t('filters.title')}</h2>
        {dirty && (
          <button type="button" onClick={onClear} className="text-[13px] font-medium text-k-periwinkle hover:underline">
            {t('filters.clear')}
          </button>
        )}
      </div>
      <div className="space-y-2">
        <Input
          type="search"
          value={values.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder={t('filters.search')}
          aria-label={t('filters.search')}
          className="h-10 text-[13px]"
        />
        {supervises && members.length > 0 && (
          <Select
            aria-label={t('filters.assignee')}
            value={values.gestor}
            onChange={(e) => onChange({ gestor: e.target.value })}
            className={cls}
          >
            <option value="">{t('filters.allAssignees')}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberName(m)}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label={t('filters.type')} value={values.tipo} onChange={(e) => onChange({ tipo: e.target.value })} className={cls}>
          <option value="">{t('filters.allTypes')}</option>
          {Object.values(AgendaItemType).map((v) => (
            <option key={v} value={v}>
              {t(`type.${v}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.allStatuses')}
          value={values.estado}
          onChange={(e) => onChange({ estado: e.target.value })}
          className={cls}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {Object.values(AgendaItemStatus).map((v) => (
            <option key={v} value={v}>
              {t(`status.${v}`)}
            </option>
          ))}
        </Select>
      </div>
    </section>
  );
}

/**
 * «Resumen del día». Pendientes, completadas y las que salieron distinto (reagendadas o canceladas):
 * son los estados que existen. **No hay «en proceso»**.
 */
export function SummaryCard({ items }: { items: { status: AgendaItemStatus }[] }) {
  const t = useTranslations('panel.agenda');
  const s = daySummary(items);
  return (
    <section aria-label={t('summary.title')} className="rounded-2xl border border-k-border bg-white p-4 shadow-k-card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-k-navy">{t('summary.title')}</h2>
        <span className="text-[12px] text-k-text-2">{t('summary.count', { n: s.total })}</span>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-k-border text-center">
        <Stat label={t('summary.pending')} value={s.pending} className="text-k-navy" />
        <Stat label={t('summary.done')} value={s.done} className="text-k-success" />
        <Stat label={t('summary.other')} value={s.other} className="text-k-text-2" />
      </dl>
    </section>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="px-1">
      <dd className={`text-[22px] font-semibold tabular-nums ${className}`}>{value}</dd>
      <dt className="text-[11px] leading-tight text-k-text-2">{label}</dt>
    </div>
  );
}
