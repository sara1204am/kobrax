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
export function SearchBox({
  label,
  placeholder,
  hint,
  wide,
  flush,
}: {
  label: string;
  placeholder: string;
  hint?: string;
  /**
   * Ancha y con lupa, para cuando la caja vive **dentro** del bloque de la tabla y tiene que
   * leerse como parte de ella. La angosta sigue siendo el default: en una pantalla sin tabla, una
   * caja de 1200 px de ancho para escribir un apellido se ve rota.
   */
  wide?: boolean;
  /**
   * Sin el margen de abajo, para cuando comparte fila con otro control.
   *
   * El margen existe porque la caja va **encima** de la tabla en todas las pantallas del panel; en
   * una fila con un botón al lado, ese mismo margen la desalinea unos píxeles y se nota.
   */
  flush?: boolean;
}) {
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
    <div className={flush ? '' : 'mb-3'}>
      <label className="relative block">
        <span className="sr-only">{label}</span>
        {wide && (
          <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-k-muted">
            ⌕
          </span>
        )}
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            typed.current = true;
            setValue(e.target.value);
          }}
          className={`h-11 w-full rounded-xl border border-k-border bg-white text-[14px] text-k-text outline-none placeholder:text-k-muted focus:border-k-periwinkle focus:shadow-k-focus ${
            wide ? 'pl-10 pr-4' : 'max-w-[420px] px-4'
          }`}
        />
      </label>
      {hint && <p className="mt-1.5 text-[12px] text-k-muted">{hint}</p>}
    </div>
  );
}
