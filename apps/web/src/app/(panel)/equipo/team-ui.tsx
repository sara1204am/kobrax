import type { ReactNode } from 'react';
import { memberName, type Member } from '@kobrax/shared';

/** Iniciales para el avatar: nombre + apellido, o las dos primeras letras del correo. */
export function initials(m: Pick<Member, 'firstName' | 'lastName' | 'email'>): string {
  const f = m.firstName?.trim()[0];
  const l = m.lastName?.trim()[0];
  return ((f ?? '') + (l ?? '') || m.email.slice(0, 2)).toUpperCase();
}

/** Círculo con iniciales. El inactivo se apaga: se lee de un vistazo quién ya no entra. */
export function Avatar({
  member,
  muted,
  size = 'md',
}: {
  member: Pick<Member, 'firstName' | 'lastName' | 'email'>;
  muted?: boolean;
  size?: 'md' | 'lg' | 'xl';
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${
        size === 'xl' ? 'h-20 w-20 text-[26px]' : size === 'lg' ? 'h-11 w-11 text-[14px]' : 'h-10 w-10 text-[13px]'
      } ${muted ? 'bg-k-bg text-k-muted' : 'bg-k-light-bg text-k-slate'}`}
    >
      {initials(member)}
    </span>
  );
}

/** Quién es la persona sobre la que se está decidiendo: va arriba de cada confirmación. */
export function MemberHeader({ member }: { member: Member }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar member={member} size="lg" muted={!member.isActive} />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-k-text">{memberName(member)}</p>
        <p className="truncate text-[13px] text-k-text-2">{member.email}</p>
      </div>
    </div>
  );
}

const ICON_PATHS = {
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  ban: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  restore: 'M3 12a9 9 0 109-9M3 4v5h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  credit: 'M3 6h18v12H3zM3 10h18',
  visit: 'M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a4 4 0 000-8h-4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-4 4-6 8-6s8 2 8 6',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 6.5M18 14.8c2 .7 3.5 2.2 3.5 5.2',
  invite: 'M10 11a4 4 0 100-8 4 4 0 000 8zM3 20c0-3.6 3-5.5 7-5.5M18 14v6M15 17h6',
} as const;

export type TeamIconName = keyof typeof ICON_PATHS;

export function TeamIcon({ name, className = 'h-[18px] w-[18px]' }: { name: TeamIconName; className?: string }) {
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const TONES = {
  neutral: 'text-k-text-2 hover:bg-k-bg',
  danger: 'text-k-danger hover:bg-k-danger-bg',
  primary: 'text-k-periwinkle hover:bg-k-info-bg',
} as const;

/**
 * Acción de fila con icono. Sin texto visible, así que **el nombre accesible es obligatorio**
 * (`label`): va como `aria-label` y como `title` para el que pasa el mouse.
 */
export function IconAction({
  label,
  icon,
  tone = 'neutral',
  onClick,
  disabled,
}: {
  label: string;
  icon: TeamIconName;
  tone?: keyof typeof TONES;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border border-k-border bg-white disabled:opacity-50 ${TONES[tone]}`}
    >
      <TeamIcon name={icon} />
    </button>
  );
}

/** Barra de uso de asientos. Los colores salen del nivel de uso, no de un umbral propio. */
export function SeatsBar({ used, max, level }: { used: number; max: number; level: 'ok' | 'warn' | 'full' | string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={used}
      className="h-1.5 w-full overflow-hidden rounded-full bg-k-light-bg"
    >
      <div
        className={`h-full rounded-full ${level === 'ok' ? 'bg-k-periwinkle' : 'bg-k-warning'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Fila de «cuánto trabajo tiene»: icono, rótulo y cifra. */
export function WorkRow({ icon, label, value }: { icon: TeamIconName; label: string; value: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="flex items-center gap-2 text-k-text-2">
        <TeamIcon name={icon} className="h-4 w-4" />
        {label}
      </span>
      <span className="font-semibold text-k-text">{value}</span>
    </li>
  );
}
