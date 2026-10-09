import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AgendaTodaySummary } from '@kobrax/shared';
import { itemWhen } from '@/lib/agenda';

/** Cuántas filas caben en el widget sin scroll; el resto se resume en «N actividades más». */
const MAX_ROWS = 4;

/** Los tipos que se ofrecen como atajo: cada uno abre la Agenda ya filtrada por él (`?tipo=`). */
const TYPE_SHORTCUTS = ['VISIT', 'CALL', 'REMINDER', 'PROMISE_TO_PAY', 'WHATSAPP'] as const;
type ShortcutType = (typeof TYPE_SHORTCUTS)[number];

/** Color e ícono por tipo: salen de los tokens `k-*`, sin colores nuevos. */
const TYPE_STYLE: Record<ShortcutType, { tile: string; icon: string }> = {
  VISIT: { tile: 'bg-k-info-bg text-k-periwinkle', icon: 'M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  CALL: { tile: 'bg-k-success-bg text-k-success', icon: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z' },
  REMINDER: { tile: 'bg-k-info-bg text-k-periwinkle', icon: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm-2 8h14v9H5v-9Z' },
  PROMISE_TO_PAY: { tile: 'bg-k-highlight text-k-purple', icon: 'M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM8 12h8v1.5H8V12Zm0 3.5h8V17H8v-1.5Z' },
  WHATSAPP: { tile: 'bg-k-success-bg text-k-success', icon: 'M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Zm4.6 12.3c-.2.55-1.1 1-1.5 1.05-.4.05-.9.1-2.9-.7-2.4-1-3.9-3.4-4-3.55-.1-.15-.95-1.25-.95-2.4s.6-1.7.8-1.95c.2-.25.45-.3.6-.3h.45c.15 0 .35 0 .5.4l.7 1.7c.05.15.1.3 0 .45-.1.15-.15.25-.3.4-.15.15-.3.35-.4.45-.15.15-.3.3-.15.6.15.3.7 1.15 1.5 1.85 1 .9 1.9 1.2 2.15 1.3.3.15.45.1.6-.05.2-.2.7-.8.9-1.1.2-.3.4-.25.65-.15l1.65.8c.3.15.5.2.55.3.05.1.05.55-.15 1.1Z' },
};

function TypeIcon({ type, className = '' }: { type: ShortcutType; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 fill-current ${className}`}>
      <path d={TYPE_STYLE[type].icon} />
    </svg>
  );
}

/**
 * «Agenda de hoy»: el widget del tablero que responde a «¿qué tengo que hacer hoy?».
 *
 * 🔴 **Muestra lo accionable, no todo**: cuántas hay vencidas (lo más urgente, en rojo), cuántas quedan hoy y las
 * próximas con su hora. El resto está a un clic, en la Agenda. Los números salen de `GET /agenda/summary`, que cuenta
 * con el día civil de la empresa y el mismo alcance que la lista: el contador del menú dice lo mismo.
 *
 * Es el *cuerpo* del widget: el marco (título, «Ver agenda», errores) lo pone `WidgetFrame`.
 */
export async function AgendaToday({ summary }: { summary: AgendaTodaySummary }) {
  const t = await getTranslations('panel.dashboard.agendaToday');
  const ta = await getTranslations('panel.agenda');
  const rows = summary.items.slice(0, MAX_ROWS);
  const more = Math.max(0, summary.pending - rows.length);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <dl className="flex gap-3">
          <div className={`flex min-w-[96px] flex-col-reverse items-center rounded-xl px-4 py-3 ${summary.overdue > 0 ? 'bg-k-danger-bg' : 'bg-k-bg'}`}>
            <dt className="text-[12px] text-k-text-2">{t('overdue')}</dt>
            <dd className={`text-[24px] font-semibold tabular-nums ${summary.overdue > 0 ? 'text-k-danger' : 'text-k-text'}`}>
              {summary.overdue}
            </dd>
          </div>
          <div className="flex min-w-[96px] flex-col-reverse items-center rounded-xl bg-k-bg px-4 py-3">
            <dt className="text-[12px] text-k-text-2">{t('pending')}</dt>
            <dd className="text-[24px] font-semibold tabular-nums text-k-navy">{summary.pending}</dd>
          </div>
        </dl>

        <ul className="flex flex-1 flex-wrap items-center justify-around gap-2">
          {TYPE_SHORTCUTS.map((type) => (
            <li key={type}>
              <Link href={`/agenda?tipo=${type}`} className="group flex flex-col items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-k-bg">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full ${TYPE_STYLE[type].tile}`}>
                  <TypeIcon type={type} />
                </span>
                <span className="text-[12px] text-k-text-2 group-hover:text-k-navy">{t(`types.${type}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-4 divide-y divide-k-border overflow-hidden rounded-xl border border-k-border border-l-2 border-l-k-periwinkle">
          {rows.map((item) => {
            const type = item.type as ShortcutType;
            const known = type in TYPE_STYLE;
            return (
              <li key={item.id}>
                <Link href={`/agenda/${item.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-k-bg">
                  <span className="w-12 shrink-0 text-[13px] tabular-nums text-k-text-2">{itemWhen(item, ta)}</span>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${known ? TYPE_STYLE[type].tile : 'bg-k-bg text-k-text-2'}`}>
                    {known && <TypeIcon type={type} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-k-text">{ta(`type.${item.type}`)}</span>
                    <span className="block truncate text-[13px] text-k-text-2">{item.clientName ?? '—'}</span>
                  </span>
                  <span
                    className={`rounded-full px-3 py-0.5 text-[12px] font-medium ${
                      item.isOverdue ? 'bg-k-danger-bg text-k-danger' : 'bg-k-info-bg text-k-slate'
                    }`}
                  >
                    {item.isOverdue ? t('overdueOne') : ta(`status.${item.status}`)}
                  </span>
                  <span aria-hidden="true" className="text-k-muted">›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-[14px] text-k-text-2">{summary.overdue > 0 ? t('onlyOverdue') : t('nothing')}</p>
      )}

      {more > 0 && (
        <Link
          href="/agenda"
          className="mt-3 flex items-center gap-3 rounded-xl bg-k-info-bg px-4 py-2.5 text-[13px] font-medium text-k-slate hover:bg-k-light-bg"
        >
          <span aria-hidden="true" className="text-[16px] leading-none">+</span>
          <span className="flex-1">{t('more', { n: more })}</span>
          <span aria-hidden="true">›</span>
        </Link>
      )}

      {/* Con `agenda:assign`: cuánto tiene cada persona del equipo, la más atrasada primero. Una tabla simple, no un tablero. */}
      {summary.load && summary.load.length > 0 && (
        <div className="mt-5 border-t border-k-border pt-4">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('team')}</h3>
          <ul className="divide-y divide-k-border rounded-xl border border-k-border">
            {summary.load.map((row) => (
              <li key={row.assigneeId}>
                <Link href={`/agenda?gestor=${row.assigneeId}`} className="flex items-center gap-3 px-4 py-2 hover:bg-k-bg">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-k-text">{row.name ?? '—'}</span>
                  <span className="w-28 text-right text-[13px] tabular-nums text-k-text-2">{t('loadPending', { n: row.pending })}</span>
                  <span className={`w-28 text-right text-[13px] font-medium tabular-nums ${row.overdue > 0 ? 'text-k-danger' : 'text-k-text-2'}`}>
                    {t('loadOverdue', { n: row.overdue })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
