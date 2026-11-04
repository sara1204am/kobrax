'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { Select } from '@/components/ui';
import type { OfficeOption } from '@/lib/offices';

/**
 * Selector de oficina: las opciones en orden de árbol y con la **ruta completa** como rótulo (`Central › Chuquisaca ›
 * Mesa Verde`, R10), para que dos oficinas con el mismo nombre en ramas distintas no se confundan.
 *
 * Es un `<select>` nativo a propósito: teclado, lector de pantalla y teléfono funcionan sin código propio.
 */
export const OfficeSelect = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
    options: OfficeOption[];
    /** Texto de la opción vacía (`''`). Sin él no hay opción vacía. */
    emptyLabel?: string;
    /** Ids que no se pueden elegir (se muestran apagados). */
    disabledIds?: ReadonlySet<string>;
  }
>(function OfficeSelect({ options, emptyLabel, disabledIds, ...props }, ref) {
  return (
    <Select ref={ref} {...props}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id} disabled={disabledIds?.has(o.id)}>
          {o.name}
        </option>
      ))}
    </Select>
  );
});
