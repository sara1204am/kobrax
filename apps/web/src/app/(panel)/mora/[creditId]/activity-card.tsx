import type { ReactNode } from 'react';

/** Resultados que son «no se logró»: la gestión se pinta en rojo para que se vea de un vistazo. */
const FAILED = new Set(['NO_ANSWER', 'WRONG_NUMBER', 'NOT_FOUND', 'WRONG_ADDRESS', 'REFUSAL', 'PROMISE_BROKEN']);

type Tone = 'blue' | 'green' | 'red' | 'purple' | 'amber' | 'teal';

const TONES: Record<Tone, string> = {
  blue: 'bg-[#E8F0FB] text-k-periwinkle',
  green: 'bg-k-success-bg text-k-success',
  red: 'bg-k-danger-bg text-k-danger',
  purple: 'bg-k-highlight text-k-purple',
  amber: 'bg-k-warning-bg text-k-warning-text',
  teal: 'bg-[#E3F6F5] text-[#1B8A84]',
};

const ICONS: Record<string, ReactNode> = {
  // llamada
  CALL: <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />,
  // visita (pin)
  VISIT: <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />,
  // mensaje
  MESSAGE: <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" />,
  // pago (moneda)
  PAYMENT: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15.5V19h-2v-1.5a3.5 3.5 0 0 1-2.5-2.2l1.8-.8c.3.8.9 1.2 1.7 1.2.9 0 1.4-.4 1.4-1 0-.6-.4-.9-1.7-1.3-1.6-.5-3-1.1-3-2.9 0-1.3.9-2.3 2.3-2.7V7h2v1.4c1 .2 1.8.9 2.1 1.9l-1.7.7c-.2-.6-.7-1-1.4-1-.8 0-1.2.4-1.2.9 0 .5.4.8 1.6 1.2 1.7.5 3.1 1.1 3.1 3 0 1.4-1 2.4-2.5 2.9z" />,
  // persona
  ASSIGNMENT: <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z" />,
  // documento (nota y cambio de estado)
  DOC: <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM8 13h8v1.6H8zm0 3.4h8V18H8z" />,
};

function look(type: string, result?: string | null): { tone: Tone; icon: ReactNode } {
  if (result && FAILED.has(result)) return { tone: 'red', icon: ICONS[type] ?? ICONS.DOC };
  switch (type) {
    case 'CALL':
    case 'PAYMENT':
      return { tone: 'green', icon: ICONS[type] };
    case 'VISIT':
      return { tone: 'purple', icon: ICONS.VISIT };
    case 'MESSAGE':
      return { tone: 'teal', icon: ICONS.MESSAGE };
    case 'ASSIGNMENT':
      return { tone: 'amber', icon: ICONS.ASSIGNMENT };
    default:
      return { tone: 'blue', icon: ICONS.DOC };
  }
}

/**
 * Una gestión del historial como tarjeta: icono con el color del tipo (rojo si no se logró), el título y la
 * fecha en la primera línea, y debajo el resultado y la nota. Borde inferior azul y sombra suave.
 */
export function ActivityCard({
  type,
  result,
  title,
  when,
  children,
}: {
  type: string;
  result?: string | null;
  title: string;
  when: string;
  children?: ReactNode;
}) {
  const { tone, icon } = look(type, result);
  return (
    <div className="flex gap-3 rounded-xl border border-k-border border-b-k-slate bg-white px-4 py-3 shadow-[0_2px_8px_rgba(26,58,82,.08)]">
      <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${TONES[tone]}`}>
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
          {icon}
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[13px] font-semibold text-k-navy">{title}</span>
          <span className="text-[12px] text-k-text-2">{when}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
