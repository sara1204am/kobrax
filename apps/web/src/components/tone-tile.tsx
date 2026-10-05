import type { ReactNode } from 'react';

export type Tone = 'blue' | 'green' | 'red' | 'purple' | 'amber' | 'teal';

/**
 * El color de cada tono: `tile` es el fondo + la tinta del icono; `pill` es la etiqueta chica del mismo tono
 * (el azul usa la tinta `k-slate` para que el texto de 12 px tenga contraste).
 */
export const TONES: Record<Tone, { tile: string; pill: string }> = {
  blue: { tile: 'bg-k-info-bg text-k-periwinkle', pill: 'bg-k-info-bg text-k-slate' },
  green: { tile: 'bg-k-success-bg text-k-success', pill: 'bg-k-success-bg text-k-success' },
  red: { tile: 'bg-k-danger-bg text-k-danger', pill: 'bg-k-danger-bg text-k-danger' },
  purple: { tile: 'bg-k-highlight text-k-purple', pill: 'bg-k-highlight text-k-purple' },
  amber: { tile: 'bg-k-warning-bg text-k-warning-text', pill: 'bg-k-warning-bg text-k-warning-text' },
  teal: { tile: 'bg-k-teal-bg text-k-teal', pill: 'bg-k-teal-bg text-k-teal' },
};

/**
 * El cuadro redondeado con un icono adentro, con el color de su tono: el de cada gestión del historial y el de
 * cada medio de pago. `outline` dibuja el icono de trazo; si no, relleno.
 */
export function ToneTile({
  tone,
  size = 'md',
  outline = false,
  children,
}: {
  tone: Tone;
  /** `md` 40 px (gestiones) · `lg` 44 px (pagos). */
  size?: 'md' | 'lg';
  outline?: boolean;
  /** Los trazos del `<svg viewBox="0 0 24 24">`. */
  children: ReactNode;
}) {
  const box = size === 'lg' ? 'h-11 w-11' : 'h-10 w-10';
  return (
    <span aria-hidden className={`grid ${box} shrink-0 place-items-center rounded-xl ${TONES[tone].tile}`}>
      {outline ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
          {children}
        </svg>
      )}
    </span>
  );
}
