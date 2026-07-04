import Link from 'next/link';
import type { ReactNode } from 'react';

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

const TONE: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-600',
  green: 'bg-k-success-bg text-k-success',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-k-danger-bg text-k-danger',
  blue: 'bg-blue-50 text-blue-700',
  purple: 'bg-k-highlight text-k-purple',
};

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}

/** Mapea estados de caso / crédito / cliente a un color. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'ACTIVE':
    case 'PAID':
    case 'KEPT':
      return 'green';
    case 'PENDING':
    case 'IN_NEGOTIATION':
      return 'blue';
    case 'PROMISE_TO_PAY':
      return 'purple';
    case 'OVERDUE':
    case 'WRITTEN_OFF':
    case 'BLOCKED':
    case 'DEFAULTED':
      return 'red';
    case 'CLOSED':
    case 'INACTIVE':
      return 'gray';
    default:
      return 'gray';
  }
}

export function priorityTone(p: string): Tone {
  return p === 'CRITICAL' ? 'red' : p === 'HIGH' ? 'amber' : p === 'MEDIUM' ? 'blue' : 'gray';
}

export function PanelHeading({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-k-navy">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-k-text-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-k-border bg-white shadow-k-card ${className}`}>{children}</div>;
}

export function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</p>
      <p className={`mt-0.5 text-[14px] text-k-text ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</p>
    </div>
  );
}

/** Paginación simple basada en URL (?page=). `meta` viene de la respuesta de la API. */
export function Pagination({ meta, baseHref }: { meta?: { page?: number; pages?: number; total?: number }; baseHref: string }) {
  const page = meta?.page ?? 1;
  const pages = meta?.pages ?? 1;
  const sep = baseHref.includes('?') ? '&' : '?';
  return (
    <div className="flex items-center justify-between px-4 py-3 text-[13px] text-k-text-2">
      <span>{meta?.total ?? 0} resultados · página {page}/{pages}</span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={`${baseHref}${sep}page=${page - 1}`} className="rounded-md border border-k-border px-2 py-1 hover:bg-k-bg">
            ← Anterior
          </Link>
        )}
        {page < pages && (
          <Link href={`${baseHref}${sep}page=${page + 1}`} className="rounded-md border border-k-border px-2 py-1 hover:bg-k-bg">
            Siguiente →
          </Link>
        )}
      </div>
    </div>
  );
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-[13px] text-k-muted">
        {text}
      </td>
    </tr>
  );
}
