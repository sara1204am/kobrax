import type { ReactNode } from 'react';

/**
 * Un número que cambia con la importación: «A → B» si cambió, el valor solo si no, «—» si no se
 * sabe. El antes va apagado: lo que se lee primero es cómo queda.
 *
 * Lo usan la vista previa del importador (antes de confirmar) y el detalle del historial (después):
 * la misma regla en los dos lados, para que «qué va a pasar» y «qué pasó» se lean igual.
 */
export function ValueChange({
  before,
  after,
  format,
}: {
  before?: number | null;
  after?: number | null;
  format: (value: number) => string;
}): ReactNode {
  const hasBefore = before != null;
  const hasAfter = after != null;
  if (!hasBefore && !hasAfter) return <span className="text-k-muted">—</span>;
  if (hasBefore && hasAfter && Math.abs(before - after) > 0.005) {
    return (
      <span className="whitespace-nowrap tabular-nums">
        <span className="text-k-muted">{format(before)}</span> →{' '}
        <span className="font-medium text-k-text">{format(after)}</span>
      </span>
    );
  }
  return <span className="whitespace-nowrap tabular-nums text-k-text">{format((hasAfter ? after : before) as number)}</span>;
}
