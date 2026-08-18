'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Los controles de filtro del `DataTable`, **uno por tipo**.
 *
 * 🔴 **El core no conoce esta lista.** La tabla mira `FILTER_CONTROLS[filtro.type]` y dibuja lo que
 * encuentre: agregar un tipo nuevo —un rango de fechas, un selector con búsqueda— es agregar una
 * entrada acá, sin abrir `data-table.tsx`. Es el requisito §A3 del plan.
 *
 * Ninguno sabe qué es una deuda ni una mora: reciben las claves de query que les tocan y devuelven
 * valores. Qué significa cada clave lo decide el adaptador de la pantalla.
 */

export type FilterType = 'text' | 'numberRange' | 'dateRange' | 'select' | 'multiSelect' | 'radio';

/** Un filtro de la tabla. Todos viven en el panel lateral, ninguno adentro del encabezado. */
export interface FilterDef {
  /** Las claves de query que escribe. Un rango usa dos (`['dpdMin','dpdMax']`); el resto, una. */
  keys: string[];
  label: string;
  type: FilterType;
  options?: { value: string; label: string }[];
  /** Rótulo de «sin filtrar» (`Todos los cobradores`). Sin él se usa el genérico. */
  allLabel?: string;
  /**
   * Qué mostrar cuando la URL no dice nada, por clave.
   *
   * 🔴 Para el filtro que la pantalla aplica **igual sin que nadie lo pida** — el período del mes
   * corriente en el ledger. Sin esto los campos salen vacíos y la lista aparece recortada sin que
   * nada explique por qué: lo que se está mirando tiene que estar escrito en algún lado.
   */
  defaults?: Record<string, string>;
  /**
   * Arranca **plegado**: se ve el rótulo y se abre al tocarlo.
   *
   * 🔴 Para los que traen muchas opciones —siete estados, diez resultados de visita—: desplegados
   * empujan a los demás fuera de la pantalla y hay que scrollear el panel para llegar al que se
   * usa todos los días. **Opt-in**: sin esto el filtro se dibuja abierto, que es como siguen los
   * de las otras pantallas.
   *
   * Si tiene algo puesto **se abre solo**: un filtro activo escondido deja la lista corta sin que
   * nada lo explique, que es justo lo que el panel vino a evitar.
   */
  collapsed?: boolean;
}

export interface FilterControlProps {
  /** Lo que hay hoy en la URL para las claves de este filtro. */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  def: FilterDef;
}

const INPUT =
  'h-10 w-full rounded-lg border border-k-border bg-white px-3 text-[13px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-50';

function TextFilter({ value, onChange, def }: FilterControlProps) {
  const key = def.keys[0]!;
  return (
    <input type="search" className={INPUT} aria-label={def.label} value={value[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })} />
  );
}

/**
 * Rango numérico: `Mín` y `Máx`, cada uno con su clave.
 *
 * Vacío es «sin tope», no cero: escribir sólo `Mín` filtra de ahí para arriba, que es como se pide
 * una cartera («los que deben más de 10.000»).
 */
function NumberRangeFilter({ value, onChange, def }: FilterControlProps) {
  const t = useTranslations('panel.table');
  const [min, max] = def.keys as [string, string];
  return (
    <div className="flex items-center gap-2">
      <input type="number" inputMode="numeric" min={0} className={INPUT} placeholder={t('min')} aria-label={`${def.label} — ${t('min')}`} value={value[min] ?? ''} onChange={(e) => onChange({ [min]: e.target.value })} />
      <input type="number" inputMode="numeric" min={0} className={INPUT} placeholder={t('max')} aria-label={`${def.label} — ${t('max')}`} value={value[max] ?? ''} onChange={(e) => onChange({ [max]: e.target.value })} />
    </div>
  );
}

/**
 * Rango de fechas: `Desde` y `Hasta`, cada uno con su clave.
 *
 * Va con `<input type="date">` nativo, que ya trae el calendario, el formato del idioma del sistema
 * y el teclado del teléfono. Vacío se dibuja el default de la pantalla, si lo tiene.
 */
function DateRangeFilter({ value, onChange, def }: FilterControlProps) {
  const t = useTranslations('panel.table');
  const [from, to] = def.keys as [string, string];
  return (
    <div className="space-y-2">
      <input type="date" className={INPUT} aria-label={`${def.label} — ${t('from')}`} value={value[from] || (def.defaults?.[from] ?? '')} onChange={(e) => onChange({ [from]: e.target.value })} />
      <input type="date" className={INPUT} aria-label={`${def.label} — ${t('to')}`} value={value[to] || (def.defaults?.[to] ?? '')} onChange={(e) => onChange({ [to]: e.target.value })} />
    </div>
  );
}

function SelectFilter({ value, onChange, def }: FilterControlProps) {
  const t = useTranslations('panel.table');
  const key = def.keys[0]!;
  const options = def.options ?? [];
  return (
    // Se dibuja aunque esté vacío, apagado: un filtro que aparece y desaparece según el día
    // confunde más de lo que ayuda, y el `—` explica solo que todavía no hay nada que elegir.
    <select className={INPUT} aria-label={def.label} disabled={options.length === 0} value={value[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })}>
      <option value="">{options.length === 0 ? '—' : (def.allLabel ?? t('all'))}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Varios valores en una sola clave, separados por coma (`ACTIVE,PENDING`) — lo que la API sabe partir. */
function MultiSelectFilter({ value, onChange, def }: FilterControlProps) {
  const key = def.keys[0]!;
  const selected = (value[key] ?? '').split(',').filter(Boolean);
  return (
    <div className="space-y-1.5">
      {(def.options ?? []).map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-k-periwinkle"
            checked={selected.includes(o.value)}
            onChange={() =>
              onChange({ [key]: (selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value]).join(',') })
            }
          />
          <span className="text-[13px] text-k-text">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Una opción **entre varias**, con «Todos» arriba.
 *
 * Se dibuja con checkboxes y no con radios porque así está diseñado, pero se comporta como una
 * elección única: marcar «En mora» desmarca «Pagado». Dos estados a la vez serían un «o» que la
 * consulta no sabe hacer —los filtros se combinan con «y»—, y ofrecerlo sería prometer un
 * resultado que no llega.
 */
function RadioFilter({ value, onChange, def }: FilterControlProps) {
  const t = useTranslations('panel.table');
  const key = def.keys[0]!;
  const current = value[key] ?? '';
  const options = [{ value: '', label: def.allLabel ?? t('all') }, ...(def.options ?? [])];
  return (
    <div className="space-y-1.5">
      {options.map((o) => (
        <label key={o.value || 'all'} className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-k-periwinkle" checked={current === o.value} onChange={() => onChange({ [key]: o.value })} />
          <span className="text-[13px] text-k-text">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** El registro. Agregar un `type` es agregar una línea acá. */
export const FILTER_CONTROLS: Record<FilterType, (props: FilterControlProps) => ReactNode> = {
  text: TextFilter,
  numberRange: NumberRangeFilter,
  dateRange: DateRangeFilter,
  select: SelectFilter,
  multiSelect: MultiSelectFilter,
  radio: RadioFilter,
};

/** Cuánto espera un campo de escritura antes de salir a buscar. El mismo número que `SearchBox`. */
const DEBOUNCE_MS = 350;

/**
 * Un filtro del panel. Escribe en la URL con espera **sólo si es de escribir**: marcar una opción o
 * elegir de una lista es una decisión tomada, y esperar 350 ms a que «termine de escribir» se
 * siente roto.
 */
export function Filter({
  def,
  params,
  go,
}: {
  def: FilterDef;
  params: URLSearchParams;
  go: (changes: Record<string, string | null>) => void;
}) {
  const Control = FILTER_CONTROLS[def.type];
  const urlValue: Record<string, string> = {};
  for (const k of def.keys) urlValue[k] = params.get(k) ?? '';

  const [draft, setDraft] = useState(urlValue);
  const typed = useRef(false);
  const url = def.keys.map((k) => urlValue[k]).join('|');

  // La URL manda cuando cambia sin que se haya tipeado: «atrás», un chip que se borró, «Limpiar».
  useEffect(() => {
    if (!typed.current) setDraft(Object.fromEntries(def.keys.map((k, i) => [k, url.split('|')[i] ?? ''])));
  }, [url, def.keys]);

  // Un `type=date` emite cambios mientras se tipea el año («0002-…» camino a «2026-…»), así que
  // espera igual que los de escribir: sin eso, cada dígito sería una navegación y un pedido.
  const debounced = def.type === 'text' || def.type === 'numberRange' || def.type === 'dateRange';
  useEffect(() => {
    if (!typed.current) return;
    const changed = def.keys.filter((k) => (draft[k] ?? '') !== (urlValue[k] ?? ''));
    if (changed.length === 0) return;
    const apply = () => {
      typed.current = false;
      // Volver a la página 1: filtrar cambia qué filas existen, y quedarse en la 7 muestra el medio
      // de una lista que la persona no vio empezar.
      go({ ...Object.fromEntries(changed.map((k) => [k, draft[k] || null])), page: '1' });
    };
    if (!debounced) return apply();
    const id = setTimeout(apply, DEBOUNCE_MS);
    return () => clearTimeout(id);
  });

  const control = (
    <Control
      def={def}
      value={draft}
      onChange={(patch) => {
        typed.current = true;
        setDraft((d) => ({ ...d, ...patch }));
      }}
    />
  );

  /*
   * Plegado, pero **abierto si tiene algo puesto**: un filtro activo escondido deja la lista corta
   * sin que nada lo explique. `open` va sin controlar el estado: el navegador se encarga de abrir y
   * cerrar, y cuando el filtro pasa a tener valor el atributo lo reabre.
   */
  if (def.collapsed) {
    const puestos = def.keys.reduce((n, k) => n + (urlValue[k] ? 1 : 0), 0);
    const marcados = def.keys.reduce((n, k) => n + (urlValue[k] ? urlValue[k]!.split(',').filter(Boolean).length : 0), 0);
    return (
      <details open={puestos > 0}>
        <summary className="mb-1.5 flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-k-text-2 hover:text-k-text [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-[9px] transition-transform">
            ▸
          </span>
          {def.label}
          {/* Cuántos hay elegidos ahí adentro: plegado sin esto, el filtro puesto es invisible. */}
          {marcados > 0 && <span className="text-k-periwinkle">· {marcados}</span>}
        </summary>
        {control}
      </details>
    );
  }

  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{def.label}</span>
      {control}
    </div>
  );
}

/**
 * El panel de filtros, a la izquierda de la tabla.
 *
 * 🔴 **Los filtros no van adentro del encabezado de la tabla.** Con una columna apagada —o con la
 * tabla scrolleada a la derecha— un filtro puesto queda fuera de la vista, la lista sale corta y no
 * hay forma de saber por qué. Acá están todos juntos, siempre en el mismo lugar, y con `Limpiar` a
 * un clic.
 */
export function FilterPanel({
  defs,
  params,
  go,
  onClose,
  onClear,
}: {
  defs: FilterDef[];
  params: URLSearchParams;
  go: (changes: Record<string, string | null>) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  const t = useTranslations('panel.table');
  return (
    <aside className="w-full shrink-0 rounded-2xl border border-k-border bg-white p-4 lg:w-[240px]" aria-label={t('filters')}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-k-text">{t('filters')}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClear} className="text-[13px] font-medium text-k-periwinkle hover:underline">
            {t('clear')}
          </button>
          <button type="button" onClick={onClose} aria-label={t('closeFilters')} className="text-k-muted hover:text-k-text">
            ✕
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {defs.map((def) => (
          <Filter key={def.keys.join('|')} def={def} params={params} go={go} />
        ))}
      </div>
    </aside>
  );
}
