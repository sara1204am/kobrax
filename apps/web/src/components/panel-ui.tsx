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
  badge,
  actions,
}: {
  title: string;
  subtitle?: string;
  /**
   * Etiqueta de estado, **al lado del título**.
   *
   * 🔴 Va acá y no en `actions` porque no es una acción: es parte de quién es esto. Puesta a la
   * derecha con los botones, «Activo» quedaba a media pantalla del nombre al que califica, y en un
   * monitor ancho había que cruzar la pantalla para leer el estado del cliente que se está mirando.
   */
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[26px] font-semibold tracking-tight text-k-navy">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-[14px] text-k-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * El bloque estándar del panel: **rótulo arriba en versalitas, caja blanca abajo**.
 *
 * 🔴 **Uno solo, usado por la ficha y por la edición.** Antes había tres cáscaras casi iguales —una
 * por archivo— y el resultado era que mirar un cliente y editarlo parecían dos productos distintos.
 * Cuando las dos pantallas comparten el bloque, la diferencia entre ver y editar es la única que
 * queda: los campos.
 *
 * El título va **afuera** de la caja: adentro competía con el contenido, y en una pantalla con ocho
 * secciones eso es ocho títulos peleando con lo que importa.
 */
export function Section({
  title,
  action,
  children,
  /** El padding de la caja. `''` para listas que ya paginan su propio espacio. */
  inner = 'p-4',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  inner?: string;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{title}</h2>
        {action}
      </div>
      <div className={`rounded-2xl border border-k-border bg-white ${inner}`}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-k-light-bg text-k-text-2',
  success: 'bg-k-success-bg text-k-success',
  warning: 'bg-k-warning-bg text-k-warning-text',
  danger: 'bg-k-danger-bg text-k-danger',
} as const;

/** El punto de color de una etiqueta con `dot`. Es decoración: el texto ya dice lo mismo. */
const DOTS = {
  neutral: 'bg-k-muted',
  success: 'bg-k-success',
  warning: 'bg-k-warning',
  danger: 'bg-k-danger',
} as const;

/** Etiqueta de estado. El tono lo elige quien la usa; acá sólo viven los cuatro. */
export function Badge({
  children,
  tone = 'neutral',
  dot,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  /**
   * Punto de color antes del texto. 🔴 **Nunca reemplaza al texto**: el estado se lee, no se
   * adivina por el color — hay quien no distingue el rojo del verde.
   */
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium ${TONES[tone]}`}
    >
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} />}
      {children}
    </span>
  );
}

/**
 * Elegir **una** de dos o tres vistas del mismo contenido: Lista/Calendario, Día/Período.
 *
 * Nació dentro de la agenda y se promovió al reusarlo Rutas. Es un `radiogroup`, no una botonera:
 * un lector de pantalla anuncia «1 de 2, seleccionado», que es exactamente lo que el control hace.
 * No sirve para navegar a otra pantalla —para eso hay links—, sino para cambiar cómo se mira lo
 * mismo.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Qué se está eligiendo. Sin esto el grupo se anuncia sin decir de qué es. */
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-k-border bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-md px-3 text-[13px] font-medium transition-colors ${
            value === o.value ? 'bg-k-navy text-white' : 'text-k-text-2 hover:bg-k-bg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
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
