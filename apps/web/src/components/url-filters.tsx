'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Los filtros de un listado, **escritos en la URL**.
 *
 * Igual que el orden y la página del `DataTable`: la vista se comparte por link, «atrás»
 * funciona, y el server component lee los mismos `searchParams` para pedirle a la API lo que toca.
 * No hay dos verdades sobre qué se está filtrando.
 *
 * Cada cambio vuelve a la página 1: filtrar cambia qué filas existen, y quedarse en la 7 mostraría
 * el medio de una lista que la persona no vio empezar.
 */
export interface UrlSelect {
  /** El parámetro de la URL. */
  key: string;
  label: string;
  /** Qué dice la opción vacía («Todos»). */
  all: string;
  options: { value: string; label: string }[];
}

export interface UrlToggle {
  key: string;
  label: string;
}

export function UrlFilters({
  selects,
  toggles = [],
  clearLabel,
}: {
  selects: UrlSelect[];
  toggles?: UrlToggle[];
  clearLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  }

  const keys = [...selects.map((s) => s.key), ...toggles.map((t) => t.key)];
  const dirty = keys.some((key) => params.get(key));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {selects.map((filter) => (
        <label key={filter.key} className="block">
          <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-k-text-2">
            {filter.label}
          </span>
          <select
            value={params.get(filter.key) ?? ''}
            onChange={(e) => set(filter.key, e.target.value)}
            className="h-10 min-w-[160px] rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
          >
            <option value="">{filter.all}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {toggles.map((toggle) => (
        <label key={toggle.key} className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[14px] text-k-text">
          <input
            type="checkbox"
            checked={params.get(toggle.key) === 'true'}
            onChange={(e) => set(toggle.key, e.target.checked ? 'true' : '')}
            className="h-4 w-4 accent-k-purple"
          />
          {toggle.label}
        </label>
      ))}

      {dirty && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="min-h-[40px] text-[14px] font-medium text-k-purple hover:underline"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
