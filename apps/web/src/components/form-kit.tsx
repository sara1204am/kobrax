'use client';

import { useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './ui';
import { Modal } from './modal';

/**
 * P2-A · Piezas que faltaban para dejar de escribir a mano lo mismo en cada pantalla:
 * `Tabs` (pestañas accesibles), `Checkbox`, `ConfirmDialog` y la composición de formularios (`FormSection`, `FormActions`).
 * Los valores visuales salen de los que ya usan `Input`/`Button`/`Switch`; no se introduce identidad nueva.
 */

/* ── Tabs ─────────────────────────────────────────────────────────────────────────────────────── */

export interface TabItem<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * Pestañas con el patrón WAI-ARIA: `tablist` / `tab` con `aria-selected`, flechas ← → (y Inicio/Fin) para moverse, y sólo la pestaña
 * activa entra por Tab (roving tabindex). Controladas: `value` manda. Cambian el contenido de la misma pantalla; para navegar a otra
 * ruta, links. `idPrefix` enlaza cada pestaña con su panel (`<prefix>-tab-<value>` ↔ `<prefix>-panel-<value>`).
 */
export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  idPrefix,
}: {
  value: T;
  tabs: TabItem<T>[];
  onChange: (value: T) => void;
  /** Qué agrupan estas pestañas (nombre accesible del `tablist`). */
  label: string;
  idPrefix?: string;
}) {
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((t) => !t.disabled);

  const move = (e: KeyboardEvent, from: T) => {
    const i = enabled.findIndex((t) => t.value === from);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = enabled[next]!;
    onChange(target.value);
    refs.current[target.value]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-k-border">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[t.value] = el;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${t.value}`}
            aria-selected={active}
            aria-controls={`${prefix}-panel-${t.value}`}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => move(e, t.value)}
            className={`-mb-px h-10 border-b-2 px-4 text-[14px] font-medium outline-none transition-colors focus-visible:shadow-k-focus disabled:opacity-50 ${
              active ? 'border-k-navy text-k-navy' : 'border-transparent text-k-text-2 hover:text-k-text'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Checkbox ─────────────────────────────────────────────────────────────────────────────────── */

/** Casilla con su texto. Para encendido/apagado inmediato de un ajuste está `Switch`; esto es para elegir o aceptar dentro de un formulario. */
export function Checkbox({
  label,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 text-[14px] text-k-text ${props.disabled ? 'opacity-60' : ''} ${className}`}>
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-k-border accent-k-navy outline-none focus-visible:shadow-k-focus"
      />
      <span>{label}</span>
    </label>
  );
}

/* ── ConfirmDialog ────────────────────────────────────────────────────────────────────────────── */

/**
 * Confirmación genérica sobre `Modal`. Para pedir un motivo o reautenticar siguen `ReasonDialog` / `ConfirmSensitiveDialog`; esto es
 * el «¿seguro?» sin más. `danger` pinta el botón de confirmar como destructivo. Mientras `loading` no se puede cerrar.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      locked={loading}
      actions={
        <>
          <Button variant="ghost" size="sm" fullWidth={false} type="button" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" fullWidth={false} type="button" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description}
    </Modal>
  );
}

/* ── Formularios ──────────────────────────────────────────────────────────────────────────────── */

/** Un grupo de campos con título y, opcionalmente, una frase que lo explica. Los campos se apilan con el mismo ritmo en todo el panel. */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 border-0 p-0">
      <legend className="mb-1 text-[15px] font-semibold text-k-text">{title}</legend>
      {description && <p className="-mt-1 text-[13px] text-k-muted">{description}</p>}
      {children}
    </fieldset>
  );
}

/** La fila de acciones del formulario, alineada a la derecha. */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-3 pt-2">{children}</div>;
}
