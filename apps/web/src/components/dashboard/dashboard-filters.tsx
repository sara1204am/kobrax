'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CasePriority, CaseStatus, memberName, type Member } from '@kobrax/shared';
import { DATE_PRESETS, presetRange, type DatePreset } from '@/lib/dashboard';

/**
 * Los filtros globales, **arriba de los KPI y no debajo**: primero se elige qué se está mirando y
 * después se lo mira. Afectan a los seis widgets, porque los seis reciben los mismos parámetros.
 *
 * 🔴 **Un filtro que no discrimina nada no se dibuja.** Con un solo cobrador —o con ninguno— el
 * selector sobra: ocupa lugar, sugiere que hay algo que elegir y siempre devuelve lo mismo. Lo
 * mismo con las sucursales, que hoy son cero.
 *
 * Todo viaja en la URL: el tablero se comparte por link y recargar no pierde nada.
 */
export function DashboardFilters({ collectors }: { collectors: Member[] }) {
  const t = useTranslations('panel.dashboard');
  // Los rótulos de estado y prioridad ya están traducidos en casos: repetirlos acá sería mantener
  // once textos en dos idiomas en dos lugares, y el día que cambie uno cambiaría en una sola pantalla.
  const tc = useTranslations('panel.cases');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const range = presetRange('d7');
  const from = params.get('from') ?? range.from;
  const to = params.get('to') ?? range.to;

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  /** El preset que coincide con lo que hay en la URL, para que el desplegable no mienta. */
  const current = DATE_PRESETS.find((p) => {
    const r = presetRange(p);
    return r.from === from && r.to === to;
  });

  const filtered =
    params.get('collectorId') || params.get('caseStatus') || params.get('priority') || params.get('from');

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-k-border bg-white px-4 py-3">
      <Field label={t('filters.date')}>
        <select
          value={current ?? 'custom'}
          onChange={(e) => {
            if (e.target.value === 'custom') return;
            const r = presetRange(e.target.value as DatePreset);
            set({ from: r.from, to: r.to });
          }}
          className={SELECT}
        >
          {DATE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`presets.${p}`)}
            </option>
          ))}
          {/* «Personalizado» sólo aparece cuando el rango de la URL no es ninguno de los atajos:
              ofrecerlo como opción elegible no haría nada, porque las fechas se cambian abajo. */}
          {!current && <option value="custom">{t('presets.custom')}</option>}
        </select>
      </Field>

      <Field label={t('filters.from')}>
        <input type="date" value={from} max={to} onChange={(e) => set({ from: e.target.value })} className={INPUT} />
      </Field>
      <Field label={t('filters.to')}>
        <input type="date" value={to} min={from} onChange={(e) => set({ to: e.target.value })} className={INPUT} />
      </Field>

      {collectors.length > 1 && (
        <Field label={t('filters.collector')}>
          <select
            value={params.get('collectorId') ?? ''}
            onChange={(e) => set({ collectorId: e.target.value || null })}
            className={SELECT}
          >
            <option value="">{t('filters.all')}</option>
            {collectors.map((c) => (
              <option key={c.userId} value={c.userId}>
                {memberName(c)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={t('filters.status')}>
        <select
          value={params.get('caseStatus') ?? ''}
          onChange={(e) => set({ caseStatus: e.target.value || null })}
          className={SELECT}
        >
          <option value="">{t('filters.all')}</option>
          {Object.values(CaseStatus).map((s) => (
            <option key={s} value={s}>
              {tc(`status.${s}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('filters.priority')}>
        <select
          value={params.get('priority') ?? ''}
          onChange={(e) => set({ priority: e.target.value || null })}
          className={SELECT}
        >
          <option value="">{t('filters.all')}</option>
          {Object.values(CasePriority).map((p) => (
            <option key={p} value={p}>
              {tc(`priority.${p}`)}
            </option>
          ))}
        </select>
      </Field>

      {filtered && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="h-10 rounded-xl px-3 text-[13px] font-medium text-k-purple hover:bg-k-bg"
        >
          {t('filters.clear')}
        </button>
      )}
    </div>
  );
}

const SELECT =
  'h-10 rounded-xl border border-k-border bg-white px-2.5 text-[13px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';
const INPUT = SELECT;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</span>
      {children}
    </label>
  );
}
