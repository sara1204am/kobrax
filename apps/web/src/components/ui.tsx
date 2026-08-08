'use client';

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';

/** Botón primario navy (h48, radius10) con estado de carga (spinner blanco). */
export function Button({
  children,
  loading,
  variant = 'primary',
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'ghost' }) {
  const styles =
    variant === 'primary'
      ? 'bg-k-navy text-white hover:bg-k-slate active:scale-[.98]'
      : 'bg-white text-k-text-2 border border-k-border hover:bg-k-bg';
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`relative flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-medium transition-all duration-150 disabled:opacity-50 ${styles} ${className}`}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
      role="status"
      aria-label="Cargando"
    />
  );
}

/** Input con icono a la izquierda (h48, borde 1.5px, focus periwinkle). */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; error?: boolean }
>(function Input({ icon, error, className = '', ...props }, ref) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-k-muted">{icon}</span>
      )}
      <input
        ref={ref}
        {...props}
        className={`h-12 w-full rounded-[10px] border-[1.5px] bg-white text-[15px] text-k-text outline-none transition-all duration-150 placeholder:text-k-muted ${
          icon ? 'pl-[42px] pr-3' : 'px-3'
        } ${
          error
            ? 'border-k-danger focus:shadow-k-focus-error'
            : 'border-k-light-bg focus:border-k-periwinkle focus:shadow-k-focus'
        } ${className}`}
      />
    </div>
  );
});

/** Campo con label uppercase (§3 tipografía). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-k-text">{label}</span>
      {children}
    </label>
  );
}

/** Banner de error accesible (role=alert, border-left danger). */
export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border-l-[3px] border-k-danger bg-k-danger-bg px-3 py-2 text-[13px] text-k-danger"
    >
      {message}
    </div>
  );
}

// El `SecurityFooter` de una línea se lo llevó `auth-shell.tsx`, que ahora pinta la barra de
// confianza del diseño. Vive allá y no acá porque este archivo es `'use client'` y esa barra no
// tiene una sola interacción: desde el shell (server component) no viaja al navegador.
