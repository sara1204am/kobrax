import type { ReactNode } from 'react';

/**
 * El marco de un widget: su título y **sus cuatro estados**.
 *
 * 🔴 Cada widget se banca solo si carga, si falla o si no tiene nada que mostrar. Un spinner global
 * tapando el tablero entero hace que se sienta lento aunque no lo sea, y esconde que cinco de los
 * seis ya tienen su dato.
 *
 * No lleva `'use client'`: en modo Ver un widget no tiene una sola interacción, así que se pinta en
 * el servidor y no viaja como JavaScript. Lo interactivo llega con el modo Editar (T7).
 */
export function WidgetFrame({
  title,
  span = 3,
  action,
  error,
  empty,
  children,
}: {
  title: string;
  /** Columnas de las 12 de la grilla. En pantallas chicas todos ocupan el ancho completo. */
  span?: 3 | 4 | 5 | 6 | 8 | 12;
  action?: ReactNode;
  error?: string;
  empty?: string;
  children?: ReactNode;
}) {
  const spans: Record<number, string> = {
    3: 'lg:col-span-3',
    4: 'lg:col-span-4',
    5: 'lg:col-span-5',
    6: 'lg:col-span-6',
    8: 'lg:col-span-8',
    12: 'lg:col-span-12',
  };

  return (
    <section className={`col-span-12 rounded-2xl border border-k-border bg-white p-5 md:col-span-6 ${spans[span]}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-k-navy">{title}</h2>
        {action}
      </div>
      {error ? (
        <p className="text-[13px] text-k-danger">{error}</p>
      ) : empty ? (
        <p className="text-[13px] text-k-text-2">{empty}</p>
      ) : (
        children
      )}
    </section>
  );
}
