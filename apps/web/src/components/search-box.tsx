'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Lo que el móvil calibró en campo (`use-client-search.ts`) y acá se hereda: el número, no el código. */
const DEBOUNCE_MS = 300;

/**
 * Caja de búsqueda de un listado.
 *
 * **Escribe `?q=` en la URL**, igual que el `DataTable` escribe el orden y la página: la vista se
 * comparte por link, «atrás» funciona, y el server component lee el mismo `searchParams` para
 * pedirle a la API lo que toca. No hay dos verdades sobre qué se está buscando.
 *
 * Vuelve siempre a la página 1: buscar cambia qué filas existen, y quedarse en la 7 mostraría el
 * medio de una lista que la persona no vio empezar.
 *
 * ponytail: sin race-guard por `reqId` como en el móvil. Acá quien busca es el servidor y Next
 * descarta la navegación vieja solo; el guard existía porque allá compiten dos `fetch` en el
 * mismo estado.
 */
export function SearchBox({ label, placeholder, hint }: { label: string; placeholder: string; hint?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const [value, setValue] = useState(urlQuery);
  const typed = useRef(false);

  // El navegador manda mientras se tipea; la URL manda cuando cambia sin que se haya tipeado
  // («atrás», un link compartido, limpiar el filtro desde otro lado).
  useEffect(() => {
    if (!typed.current) setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (!typed.current || value === urlQuery) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');
      next.set('page', '1');
      router.push(`${pathname}?${next.toString()}`);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [value, urlQuery, params, pathname, router]);

  return (
    <div className="mb-4">
      <label className="block">
        <span className="sr-only">{label}</span>
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            typed.current = true;
            setValue(e.target.value);
          }}
          className="h-11 w-full max-w-[420px] rounded-xl border border-k-border bg-white px-4 text-[14px] text-k-text outline-none placeholder:text-k-muted focus:border-k-periwinkle focus:shadow-k-focus"
        />
      </label>
      {hint && <p className="mt-1.5 text-[12px] text-k-muted">{hint}</p>}
    </div>
  );
}
