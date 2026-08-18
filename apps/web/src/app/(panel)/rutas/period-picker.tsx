'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { DATE_PRESETS, presetRange, type DatePreset } from '@/lib/dashboard';
import { dayDate } from '@/lib/format';

/**
 * El período que se está mirando: un atajo («los últimos 7 días») y las dos fechas.
 *
 * 🔴 **La regla de qué es cada atajo NO se reescribe acá**: sale de `presetRange` de `lib/dashboard`,
 * que ya la tenía probada —incluido el detalle de que «7 días» son siete **contando hoy**, no ocho—.
 * Dos definiciones de «esta semana» en la misma app terminan contestando distinto a la misma
 * pregunta.
 *
 * En la URL viajan sólo `from` y `to`; el atajo se **deduce** de ellas. Así un link compartido con
 * fechas a mano abre en «Personalizado» sin que el desplegable mienta, y no hay dos fuentes de
 * verdad sobre qué se está mirando.
 */
export function PeriodPicker({ from, to }: { from: string; to: string }) {
  const t = useTranslations('panel.routes');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(patch: { from?: string; to?: string }) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v);
    // Cambiar el período cambia qué filas existen: volver a la primera página.
    next.delete('page');
    router.push(`${pathname}?${next}`);
  }

  const current = DATE_PRESETS.find((p) => {
    const r = presetRange(p);
    return r.from === from && r.to === to;
  });

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <label>
        <span className="sr-only">{t('period.label')}</span>
        <select
          value={current ?? 'custom'}
          onChange={(e) => {
            if (e.target.value === 'custom') return;
            set(presetRange(e.target.value as DatePreset));
          }}
          className="h-10 rounded-xl border border-k-border bg-white px-3 text-[14px] font-medium text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`period.presets.${p}`)}
            </option>
          ))}
          {/* Sólo aparece cuando el rango no es ninguno de los atajos: elegirlo no haría nada,
              porque las fechas se cambian en los dos campos de al lado. */}
          {!current && <option value="custom">{t('period.presets.custom')}</option>}
        </select>
      </label>

      {/* El rango escrito con todas las letras, al lado del atajo: sin esto «Este mes» no dice
          desde cuándo, y con datos de demo fechados en el futuro eso desorienta de verdad. */}
      <p className="text-[14px] font-medium text-k-navy">
        {dayDate(`${from}T00:00:00.000Z`, locale)} → {dayDate(`${to}T00:00:00.000Z`, locale)}
      </p>

      <div className="flex items-center gap-2">
        <label>
          <span className="sr-only">{t('period.from')}</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} className={INPUT} />
        </label>
        <span aria-hidden className="text-k-muted">
          →
        </span>
        <label>
          <span className="sr-only">{t('period.to')}</span>
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} className={INPUT} />
        </label>
      </div>
    </div>
  );
}

const INPUT =
  'h-10 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';
