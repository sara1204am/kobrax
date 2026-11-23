'use client';

import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

/**
 * Botón.
 * - `cta` — la acción principal de la pantalla: degradado de marca y flecha a la derecha.
 *   La flecha va en la variante y no en una prop porque **todas** las acciones principales de
 *   este flujo la llevan; el día que una no la quiera, ahí se agrega la prop.
 * - `primary` — navy sólido, para acciones secundarias con peso.
 * - `ghost` — borde, para lo terciario.
 * - `danger` — rojo sólido, para confirmar lo destructivo (desactivar, eliminar).
 */
export type ButtonVariant = 'cta' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Alturas y tipografía por tamaño. `md` es el que siempre tuvo el botón (h-12, 15px); `cta` conserva su 52px. */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 rounded-lg px-3 text-k-sm',
  md: 'h-12 rounded-xl text-k-md',
  lg: 'h-[52px] rounded-xl text-k-md',
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  cta: 'bg-k-cta text-white shadow-k-card hover:brightness-110 active:scale-[.99]',
  primary: 'bg-k-navy text-white hover:bg-k-slate active:scale-[.98]',
  secondary: 'bg-k-bg text-k-navy border border-k-border hover:bg-white',
  ghost: 'bg-white text-k-text-2 border border-k-border hover:bg-k-bg',
  danger: 'bg-k-danger text-white hover:brightness-110 active:scale-[.98]',
  link: 'bg-transparent text-k-navy underline-offset-2 hover:underline !h-auto !px-0',
};

/**
 * Botón del sistema. Sin `size` ni `fullWidth` se ve exactamente como siempre (ancho completo, 48px): los usos existentes no cambian.
 *
 * - `size` — `sm` (36px, para barras y filas), `md` (48px), `lg` (52px). `cta` es `lg` por defecto.
 * - `fullWidth` — `true` por defecto; `false` ajusta el ancho al contenido (antes se lograba pisando con `w-auto`).
 * - `secondary` — acción secundaria con relleno suave; `link` — acción de texto.
 */
export function Button({
  children,
  loading,
  variant = 'primary',
  size,
  fullWidth = true,
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean }) {
  const effectiveSize: ButtonSize = size ?? (variant === 'cta' ? 'lg' : 'md');

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`relative flex ${fullWidth ? 'w-full' : 'w-auto'} items-center justify-center font-semibold transition-all duration-150 disabled:opacity-50 ${BUTTON_SIZES[effectiveSize]} ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {loading ? (
        <Spinner />
      ) : (
        <>
          {children}
          {variant === 'cta' && <IconArrow className="absolute right-5" />}
        </>
      )}
    </button>
  );
}

/** Botón cuadrado solo con icono. `label` es obligatorio: es el nombre accesible. */
export function IconButton({
  label,
  children,
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={props.title ?? label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-k-text-2 transition-colors hover:bg-k-bg disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export type TextButtonTone = 'periwinkle' | 'danger' | 'purple' | 'success' | 'muted';

const TEXT_BUTTON_TONES: Record<TextButtonTone, string> = {
  periwinkle: 'text-k-periwinkle',
  danger: 'text-k-danger',
  purple: 'text-k-purple',
  success: 'text-k-success',
  muted: 'text-k-text-2',
};

/**
 * Acción de texto dentro de una fila o tarjeta («Cambiar», «Quitar», «Ver más»): 13px, medium, se subraya al pasar el mouse.
 * `tone` elige el color; el resto de la caja (márgenes, `shrink-0`…) llega por `className`. Si la acción necesita fondo, borde o altura, no es esta: es `Button`.
 */
export function TextButton({
  tone = 'periwinkle',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: TextButtonTone }) {
  return (
    <button
      type={type}
      {...props}
      className={`text-k-sm font-medium hover:underline disabled:opacity-50 ${TEXT_BUTTON_TONES[tone]} ${className}`}
    />
  );
}

function IconArrow({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

function Spinner() {
  const t = useTranslations('common');
  return (
    <span
      className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
      role="status"
      aria-label={t('loading')}
    />
  );
}

/**
 * Input con icono a la izquierda (h52, borde 1.5px, focus periwinkle).
 *
 * `reveal` agrega el ojo para ver la contraseña. Va acá y no en un componente aparte porque este
 * ya es dueño del contenedor relativo y del hueco del icono; **lo usan login, la nueva
 * contraseña, su confirmación, el registro y la invitación** — cinco campos, una sola
 * implementación.
 *
 * ⚠️ El botón del ojo va DESPUÉS del `<input>` en el DOM a propósito: `Field` envuelve todo en un
 * `<label>`, y la asociación implícita apunta al primer control que encuentra. Si el botón fuera
 * primero, el label dejaría de nombrar al input y se romperían tanto los lectores de pantalla
 * como los `getByLabelText` de los tests.
 */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; error?: boolean; reveal?: boolean }
>(function Input({ icon, error, reveal, className = '', type, ...props }, ref) {
  const [shown, setShown] = useState(false);
  const t = useTranslations('common');
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-k-muted">{icon}</span>
      )}
      <input
        ref={ref}
        type={reveal && shown ? 'text' : type}
        {...props}
        className={`h-[52px] w-full rounded-xl border-[1.5px] bg-white text-k-md text-k-text outline-none transition-all duration-150 placeholder:text-k-muted ${
          icon ? 'pl-11' : 'pl-3.5'
        } ${reveal ? 'pr-11' : 'pr-3.5'} ${
          error
            ? 'border-k-danger focus:shadow-k-focus-error'
            : 'border-k-light-bg focus:border-k-periwinkle focus:shadow-k-focus'
        } ${className}`}
      />
      {reveal && (
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t('hidePassword') : t('showPassword')}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-k-muted transition-colors hover:text-k-text-2"
        >
          <IconEye off={shown} />
        </button>
      )}
    </div>
  );
});

function IconEye({ off }: { off: boolean }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
      {off && <path d="M4 20L20 4" />}
    </svg>
  );
}

/**
 * `<select>` nativo con la misma caja que el `Input`.
 *
 * Nativo y no un dropdown propio: el del sistema ya trae teclado, búsqueda por letra, foco y la
 * rueda de iOS. Escribir uno sería peor en las cuatro cosas.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', ...props }, ref) {
    return (
      <select
        ref={ref}
        {...props}
        className={`h-[52px] w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 text-k-md text-k-text outline-none transition-all focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-60 ${className}`}
      />
    );
  },
);

/** `<textarea>` con la misma caja que el `Input` (las demás pantallas lo escriben suelto con estas mismas clases). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }>(
  function Textarea({ error, className = '', ...props }, ref) {
    return (
      <textarea
        ref={ref}
        {...props}
        className={`w-full rounded-xl border-[1.5px] bg-white px-3.5 py-2.5 text-k-md text-k-text outline-none transition-all placeholder:text-k-muted disabled:opacity-60 ${
          error
            ? 'border-k-danger focus:shadow-k-focus-error'
            : 'border-k-light-bg focus:border-k-periwinkle focus:shadow-k-focus'
        } ${className}`}
      />
    );
  },
);

/**
 * Interruptor encendido/apagado. Es un botón con `role="switch"`: teclado (Espacio/Enter), foco y lector de pantalla
 * vienen del elemento. Se nombra con `aria-label` o `aria-labelledby` (el texto lo pone quien lo usa) y no va dentro de un `<label>`.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  ...aria
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...aria}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:shadow-k-focus disabled:opacity-50 ${
        checked ? 'bg-k-periwinkle' : 'bg-k-light-bg'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

/** Campo con su label arriba (14px, sentence case — §3 tipografía del diseño nuevo). */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  /** Pinta un asterisco: el campo es obligatorio. */
  required?: boolean;
  hint?: string;
  /** Mensaje de error del campo: texto rojo pequeño debajo (reemplaza al `hint`). */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      {/* El asterisco es un pseudo-elemento: se ve, pero no es parte del nombre accesible del campo. */}
      <span className={`text-k-base font-medium text-k-text ${required ? "after:ml-0.5 after:text-k-danger after:content-['*']" : ''}`}>{label}</span>
      {children}
      {error ? (
        <span role="alert" className="block text-k-xs font-normal text-k-danger">
          {error}
        </span>
      ) : (
        hint && <span className="block text-k-xs font-normal text-k-muted">{hint}</span>
      )}
    </label>
  );
}

/** Banner de error accesible (role=alert, border-left danger). */
export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border-l-[3px] border-k-danger bg-k-danger-bg px-3 py-2 text-k-sm text-k-danger"
    >
      {message}
    </div>
  );
}

// El `SecurityFooter` de una línea se lo llevó `auth-shell.tsx`, que ahora pinta la barra de
// confianza del diseño. Vive allá y no acá porque este archivo es `'use client'` y esa barra no
// tiene una sola interacción: desde el shell (server component) no viaja al navegador.
