import type { ReactNode } from 'react';

/**
 * El marco de un widget: su título, sus acciones y **sus cuatro estados**.
 *
 * Ocupa todo el alto de su celda porque quien lo posiciona es la grilla: acá adentro no hay ni una
 * medida en píxeles. El cuerpo scrollea solo — una tabla de ocho filas en un widget de tres filas
 * de alto **no puede desbordar sobre el vecino**.
 *
 * 🔴 Cada widget se banca solo si falla o si no tiene nada que mostrar. Un spinner global tapando
 * el tablero entero hace que se sienta lento aunque no lo sea, y esconde que cinco de los seis ya
 * tienen su dato.
 *
 * No lleva `'use client'`: en modo Ver un widget no tiene una sola interacción, así que se pinta en
 * el servidor y no viaja como JavaScript.
 */
export function WidgetFrame({
  title,
  actions,
  error,
  empty,
  editable = false,
  children,
}: {
  title: string;
  actions?: ReactNode;
  error?: string;
  empty?: string;
  /** En modo Editar el encabezado es el tirador: `kbx-drag` es la clase que la grilla escucha. */
  editable?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border border-k-border bg-white">
      <header
        className={`flex shrink-0 items-start justify-between gap-2 px-4 pb-2 pt-3 ${
          editable ? 'kbx-drag cursor-move select-none' : ''
        }`}
      >
        <h2 className="truncate text-[13px] font-semibold text-k-navy">{title}</h2>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {error ? (
          <p className="text-[13px] text-k-danger">{error}</p>
        ) : empty ? (
          <p className="text-[13px] text-k-text-2">{empty}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
