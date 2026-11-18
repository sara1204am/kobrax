'use client';

import type { ReactNode } from 'react';
import { Switch } from '@/components/ui';

/**
 * Las piezas que comparten el asistente de configuración y Cuenta › Espacio de trabajo (F15). Existen para que los dos
 * muestren **exactamente** los mismos controles con los mismos tokens: antes cada uno tenía su propio interruptor y su propia
 * tarjeta de elección, y se veían distintos.
 */

/** Una fila «etiqueta + explicación + interruptor». Las filas de un mismo grupo se separan con una línea; la primera no lleva. */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-[44px] items-center gap-4 border-t border-k-border py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="text-k-base font-semibold text-k-text">
          {label}
        </p>
        {hint && (
          <p id={`${id}-hint`} className="mt-0.5 text-k-sm leading-snug text-k-text-2">
            {hint}
          </p>
        )}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  );
}

/** Una opción de una lista de elección única (un `radiogroup`): nombre, explicación y estado marcado. */
export function ChoiceCard({
  name,
  description,
  checked,
  onSelect,
}: {
  name: string;
  description?: ReactNode;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`block min-h-[44px] w-full rounded-xl border px-4 py-3 text-left outline-none transition-colors focus-visible:shadow-k-focus ${
        checked ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border bg-white hover:bg-k-bg'
      }`}
    >
      <span className="block text-k-base font-semibold text-k-text">{name}</span>
      {description && (
        <span className="mt-0.5 block text-k-sm leading-snug text-k-text-2">{description}</span>
      )}
    </button>
  );
}
