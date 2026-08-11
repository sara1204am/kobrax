'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type ToastTone = 'success' | 'warning' | 'danger';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const LIFETIME_MS = 5000;
/** Contador de módulo: `Date.now()` daría ids repetidos si salen dos avisos en el mismo tick. */
let seq = 0;

/** Cada tono con su color de marca. El borde de la izquierda es lo que se lee de reojo. */
const TONE = {
  success: { box: 'border-k-success bg-k-success-bg text-k-success', icon: 'M5 12.5l4.5 4.5L19 7.5' },
  warning: {
    box: 'border-k-warning bg-k-warning-bg text-k-warning-text',
    icon: 'M12 8v5M12 16.5v.5M12 3.5 2.5 20h19z',
  },
  danger: { box: 'border-k-danger bg-k-danger-bg text-k-danger', icon: 'M12 7v6M12 16v.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
} as const;

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

/**
 * Avisos efímeros arriba a la derecha, tintados por lo que pasó.
 *
 * La región es `aria-live="polite"`: el lector de pantalla lo lee cuando termina lo que está
 * diciendo, sin interrumpir. Un aviso que se va solo en 5 segundos **nunca** es el único lugar
 * donde vive un error que la persona necesita para decidir algo — eso va en la pantalla.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++seq;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), LIFETIME_MS);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* `top-20` lo deja debajo de la topbar, que mide 64 px y es sticky. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 top-20 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <p
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border-l-[3px] px-4 py-3 text-[14px] shadow-k-card ${TONE[toast.tone].box}`}
          >
            <svg
              className="mt-0.5 h-[18px] w-[18px] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d={TONE[toast.tone].icon} />
            </svg>
            {toast.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `toast('Cliente guardado')` · `toast('No se pudo guardar', 'danger')`. */
export function useToast(): (message: string, tone?: ToastTone) => void {
  return useContext(ToastContext);
}
