'use client';

import { useTranslations } from 'next-intl';

/** Lunes a domingo, ISO (1–7): la misma numeración que valida `shared`. */
export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Los siete días de la semana como fichas: **el mismo componente para editar y para ver**.
 *
 * Editando: tocar un día lo marca o desmarca (`onToggle`). Viendo (`readOnly`) o con la frecuencia «todos los días»
 * (`disabled`): las fichas no se tocan pero los días elegidos siguen a la vista, en el color primario. Cada ficha lleva el
 * nombre completo del día (`title` y `aria-label`): «M» sola no le dice nada a nadie.
 */
export function WeekDayChips({
  days,
  onToggle,
  disabled,
  readOnly,
  label,
}: {
  days: readonly number[];
  onToggle?: (day: number) => void;
  /** No se puede cambiar, pero se ve como un control (por ejemplo, «todos los días»). */
  disabled?: boolean;
  /** Sólo lectura: la ficha de la ficha del cliente. */
  readOnly?: boolean;
  label: string;
}) {
  const t = useTranslations('portfolio');
  const locked = disabled || readOnly;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {WEEK_DAYS.map((d) => {
        const on = days.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={t(`collection.dayLong.${d}`)}
            title={t(`collection.dayLong.${d}`)}
            disabled={locked}
            onClick={() => onToggle?.(d)}
            className={`h-12 min-w-11 rounded-lg border px-2 text-k-sm font-medium transition disabled:cursor-default ${on ? 'border-k-purple bg-k-highlight text-k-navy' : 'border-k-border bg-white text-k-text-2'} ${locked && !on ? 'opacity-60' : ''}`}
          >
            {t(`collection.dayShort.${d}`)}
          </button>
        );
      })}
    </div>
  );
}
