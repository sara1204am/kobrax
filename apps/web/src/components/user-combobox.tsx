'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface ComboOption {
  id: string;
  label: string;
  /** Segunda línea (correo, rol): también se busca por ella. */
  detail?: string;
}

/** Sin tildes ni mayúsculas: «Sánchez» se encuentra escribiendo «sanchez». */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Alto de la lista abierta con su pie: si abajo no entra y arriba hay más lugar, se abre hacia arriba. */
const PANEL_HEIGHT = 300;

/**
 * Selector con búsqueda (combobox): se escribe parte del nombre o del correo y la lista se acota. Es para listas largas
 * de personas, donde un `<select>` nativo obliga a recorrerlas con la mano.
 *
 * Teclado: ↑/↓ mueven, Enter elige, Esc cierra. La opción vacía (`emptyLabel`) quita la selección. `footer` es un
 * pie fijo de la lista —acá, «Agregar usuario»— que se dibuja siempre, haya o no resultados.
 */
export function SearchCombobox({
  options,
  value,
  onChange,
  emptyLabel,
  placeholder,
  noResults,
  label,
  footer,
  disabled,
}: {
  options: ComboOption[];
  value: string;
  onChange: (id: string) => void;
  /** Texto de la opción que deja el campo vacío. Sin él no hay opción vacía. */
  emptyLabel?: string;
  placeholder: string;
  noResults: string;
  /** Nombre accesible del campo. */
  label: string;
  footer?: (close: () => void) => ReactNode;
  disabled?: boolean;
}) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.id === value) ?? null;
  const [place, setPlace] = useState<CSSProperties>({});

  // La lista va `fixed`: dentro de un modal, una `absolute` estira el cuerpo con scroll y queda cortada.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = input.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < PANEL_HEIGHT && r.top > below;
      setPlace({ left: r.left, width: r.width, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    update();
    // `true`: también los scrolls de contenedores internos, que no burbujean.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const shown = useMemo(() => {
    const needle = plain(query.trim());
    const list = needle ? options.filter((o) => plain(`${o.label} ${o.detail ?? ''}`).includes(needle)) : options;
    return emptyLabel !== undefined && !needle ? [{ id: '', label: emptyLabel } as ComboOption, ...list] : list;
  }, [options, query, emptyLabel]);

  useEffect(() => setActive(0), [query, open]);

  // Tocar afuera cierra la lista.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const o = shown[active];
      if (o) pick(o.id);
    } else if (e.key === 'Escape' && open) {
      // Esc cierra la lista, no el diálogo que la contiene.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div
      ref={root}
      // Salir con Tab cierra la lista: si no, lo escrito queda a la vista como si fuera la persona elegida.
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
          setQuery('');
        }
      }}
    >
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        // Cerrada muestra a quien está elegido; abierta, lo que se escribe para buscar.
        value={open ? query : (selected?.label ?? '')}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="h-[52px] w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 text-k-md text-k-text outline-none transition-all placeholder:text-k-muted focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-60"
      />
      {open && (
        <div style={place} className="fixed z-20 overflow-hidden rounded-xl border border-k-border bg-white shadow-k-card">
          <ul id={listId} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <li className="px-3.5 py-2.5 text-k-sm text-k-text-2">{noResults}</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o.id || 'none'}
                  role="option"
                  aria-selected={o.id === value}
                  onMouseEnter={() => setActive(i)}
                  // `mousedown` y no `click`: el campo no debe perder el foco antes de elegir.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.id);
                  }}
                  className={`cursor-pointer px-3.5 py-2 text-k-base ${i === active ? 'bg-k-bg' : ''} ${o.id === value ? 'font-semibold text-k-navy' : 'text-k-text'}`}
                >
                  <span className="block">{o.label}</span>
                  {o.detail && <span className="block text-k-xs text-k-text-2">{o.detail}</span>}
                </li>
              ))
            )}
          </ul>
          {footer && <div className="border-t border-k-border p-2">{footer(() => setOpen(false))}</div>}
        </div>
      )}
    </div>
  );
}
