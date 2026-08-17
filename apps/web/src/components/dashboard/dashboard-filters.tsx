'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CasePriority, CaseStatus, memberName, type Member } from '@kobrax/shared';
import { Dropdown } from '@/components/panel-shell';
import { DATE_PRESETS, presetRange, type DatePreset } from '@/lib/dashboard';

/** Lo que se elige en un filtro múltiple: el valor que viaja y el rótulo que se lee. */
interface Option {
  value: string;
  label: string;
}

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
        <Multi
          label={t('filters.collector')}
          value={params.get('collectorId')}
          options={collectors.map((c) => ({ value: c.userId, label: memberName(c) }))}
          onChange={(v) => set({ collectorId: v })}
          allLabel={t('filters.all')}
          countLabel={(count) => t('filters.selected', { count })}
        />
      )}

      <Multi
        label={t('filters.status')}
        value={params.get('caseStatus')}
        options={Object.values(CaseStatus).map((s) => ({ value: s, label: tc(`status.${s}`) }))}
        onChange={(v) => set({ caseStatus: v })}
        allLabel={t('filters.all')}
        countLabel={(count) => t('filters.selected', { count })}
      />

      <Multi
        label={t('filters.priority')}
        value={params.get('priority')}
        options={Object.values(CasePriority).map((p) => ({ value: p, label: tc(`priority.${p}`) }))}
        onChange={(v) => set({ priority: v })}
        allLabel={t('filters.all')}
        countLabel={(count) => t('filters.selected', { count })}
      />

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

/**
 * Un filtro que acepta **varios valores a la vez**.
 *
 * 🔴 **Con checkboxes y no con `<select multiple>`.** El múltiple nativo se opera con Ctrl+clic
 * —invisible, y en el teléfono directamente no existe—, y perder toda la selección por soltar la
 * tecla es la clase de detalle que hace que un filtro no se use nunca. El desplegable es el mismo
 * `<details>` de la topbar, así que trae cerrar con Esc y con un clic afuera sin escribirlo dos veces.
 *
 * 🔴 **Va acá afuera y no adentro de `DashboardFilters`.** Definido adentro, React ve un componente
 * distinto en cada render: al tildar una opción la URL cambia, el desplegable se **desmonta** y se
 * cierra solo — o sea que elegir dos cosas obligaría a abrirlo dos veces, que es justo lo que este
 * control viene a resolver.
 *
 * La lista viaja en la URL separada por coma (`?collectorId=a,b`): el link abre lo mismo para quien
 * lo reciba.
 */
function Multi({
  label,
  value,
  options,
  onChange,
  allLabel,
  countLabel,
}: {
  label: string;
  /** Lo que hay hoy en la URL: `null` o `'a,b'`. */
  value: string | null;
  options: Option[];
  onChange: (next: string) => void;
  allLabel: string;
  countLabel: (count: number) => string;
}) {
  const selected = (value ?? '').split(',').filter(Boolean);
  const toggle = (v: string) =>
    onChange((selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]).join(','));

  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</span>
      <Dropdown
        summaryClass={`${SELECT} flex min-w-[140px] cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden`}
        panelClass="absolute left-0 z-20 mt-1 max-h-72 w-[240px] overflow-y-auto rounded-xl border border-k-border bg-white py-1 shadow-k-card"
        label={
          // Un nombre completo no entra en una barra de filtros: uno solo se lee entero, y de dos en
          // adelante el número dice más que dos nombres cortados por la mitad.
          <span className="truncate">
            {selected.length === 0
              ? allLabel
              : selected.length === 1
                ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
                : countLabel(selected.length)}
          </span>
        }
      >
        {options.map((o) => (
          <label key={o.value} className="flex min-h-[36px] cursor-pointer items-center gap-2 px-3 hover:bg-k-bg">
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => toggle(o.value)}
              className="h-4 w-4 accent-k-purple"
            />
            <span className="text-[13px] text-k-text">{o.label}</span>
          </label>
        ))}
      </Dropdown>
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
