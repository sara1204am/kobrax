import type { ReactNode } from 'react';

/**
 * Primitivas del panel que **no tienen una sola interacción**.
 *
 * Por eso este archivo no lleva `'use client'`: se renderizan en el servidor y no viajan
 * como JavaScript al navegador. Lo interactivo (modal, toast, tabla) vive en archivo aparte.
 */

/** Encabezado de pantalla: título, bajada opcional y un hueco para las acciones. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-tight text-k-navy">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-k-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  neutral: 'bg-k-light-bg text-k-text-2',
  success: 'bg-k-success-bg text-k-success',
  warning: 'bg-k-warning-bg text-k-warning-text',
  danger: 'bg-k-danger-bg text-k-danger',
} as const;

/** Etiqueta de estado. El tono lo elige quien la usa; acá sólo viven los cuatro. */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-1 text-[12px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Bloque gris mientras carga. `className` fija la medida — un skeleton sin medida no
 * reserva espacio y la pantalla salta cuando llega el dato.
 */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-lg bg-k-light-bg ${className}`} />;
}

/** La caja blanca en la que vive un bloque de contenido. */
export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-k-border bg-white p-6">{children}</div>;
}

/** Un dato con su rótulo, para las rejillas de las fichas. */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-1 text-[15px] text-k-text">{value}</dd>
    </div>
  );
}

/** La bajada de un control: qué significa lo que acaba de elegir. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] text-k-text-2">{children}</p>;
}

/** Qué mostrar cuando no hay nada que mostrar. */
export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-k-border bg-white px-6 py-12 text-center">
      <p className="text-[16px] font-medium text-k-text">{title}</p>
      {text && <p className="mx-auto mt-1.5 max-w-[420px] text-[14px] text-k-text-2">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
