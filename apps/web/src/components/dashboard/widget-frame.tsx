import type { ReactNode } from 'react';

const TILE_BG = { neutral: 'bg-k-bg', danger: 'bg-k-danger-bg', success: 'bg-k-success-bg', none: '' } as const;

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
  aside,
  error,
  empty,
  editable = false,
  tile,
  children,
}: {
  title: string;
  actions?: ReactNode;
  aside?: ReactNode;
  error?: string;
  empty?: string;
  /** En modo Editar el encabezado es el tirador: `kbx-drag` es la clase que la grilla escucha. */
  editable?: boolean;
  /** Estilo «tarjeta de dato» (los KPI): fondo tintado, sin borde ni título arriba — el rótulo lo pone el cuerpo. */
  tile?: keyof typeof TILE_BG;
  children?: ReactNode;
}) {
  const bare = Boolean(tile) && !editable;
  // `none`: el cuerpo trae sus propias tarjetas y llena TODA la celda. Sus acciones flotan encima (no
  // le quitan alto) y, en modo Editar, el tirador es el cuerpo entero.
  const flush = tile === 'none';
  return (
    <section
      className={`relative flex h-full flex-col rounded-2xl ${flush ? '' : 'overflow-hidden'} ${
        tile ? TILE_BG[tile] : 'border border-k-border bg-white'
      }`}
    >
      <header
        className={
          flush
            ? `absolute right-2 top-1 z-10 flex items-start gap-2 ${editable ? '' : 'hidden'}`
            : `flex shrink-0 items-start justify-between gap-2 px-4 pb-2 pt-3 ${
                editable ? 'kbx-drag cursor-move select-none' : ''
              } ${bare ? 'hidden' : ''}`
        }
      >
        {flush ? null : tile ? <span /> : <h2 className="truncate text-[13px] font-semibold text-k-navy">{title}</h2>}
        {/* `aside` es un atajo del widget (p. ej. «Ver agenda»); en modo Editar el sitio es de las acciones. */}
        {editable ? actions : (aside ?? actions)}
      </header>
      <div
        className={`min-h-0 flex-1 ${
          flush
            ? `p-0.5 ${editable ? 'kbx-drag cursor-move select-none' : ''}`
            : `overflow-auto px-4 pb-4 ${bare ? 'pt-4' : ''}`
        }`}
      >
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
