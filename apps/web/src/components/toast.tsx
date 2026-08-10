'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const LIFETIME_MS = 5000;
/** Contador de módulo: `Date.now()` daría ids repetidos si salen dos avisos en el mismo tick. */
let seq = 0;

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/**
 * Avisos efímeros de «se guardó» / «no se pudo».
 *
 * La región es `aria-live="polite"`: el lector de pantalla lo lee cuando termina lo que está
 * diciendo, sin interrumpir. Un aviso que se va solo en 5 segundos **nunca** es el único lugar
 * donde vive un error que la persona necesita para decidir algo — eso va en la pantalla.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = 'success') => {
    const id = ++seq;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), LIFETIME_MS);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <p
            key={toast.id}
            className={`pointer-events-auto max-w-[420px] rounded-xl px-4 py-3 text-[14px] shadow-k-card ${
              toast.tone === 'error' ? 'bg-k-danger-bg text-k-danger' : 'bg-k-navy text-white'
            }`}
          >
            {toast.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `toast('Cliente guardado')` · `toast('No se pudo guardar', 'error')`. */
export function useToast(): (message: string, tone?: Tone) => void {
  return useContext(ToastContext);
}
