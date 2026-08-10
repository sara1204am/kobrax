'use client';

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, forwardRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Botón.
 * - `cta` — la acción principal de la pantalla: degradado de marca y flecha a la derecha.
 *   La flecha va en la variante y no en una prop porque **todas** las acciones principales de
 *   este flujo la llevan; el día que una no la quiera, ahí se agrega la prop.
 * - `primary` — navy sólido, para acciones secundarias con peso.
 * - `ghost` — borde, para lo terciario.
 */
export function Button({
  children,
  loading,
  variant = 'primary',
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'cta' | 'primary' | 'ghost' }) {
  const styles = {
    cta: 'h-[52px] bg-k-cta text-white shadow-k-card hover:brightness-110 active:scale-[.99]',
    primary: 'h-12 bg-k-navy text-white hover:bg-k-slate active:scale-[.98]',
    ghost: 'h-12 bg-white text-k-text-2 border border-k-border hover:bg-k-bg',
  }[variant];

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`relative flex w-full items-center justify-center rounded-xl text-[15px] font-semibold transition-all duration-150 disabled:opacity-50 ${styles} ${className}`}
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
        className={`h-[52px] w-full rounded-xl border-[1.5px] bg-white text-[15px] text-k-text outline-none transition-all duration-150 placeholder:text-k-muted ${
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

/** Campo con su label arriba (14px, sentence case — §3 tipografía del diseño nuevo). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[14px] font-medium text-k-text">{label}</span>
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
