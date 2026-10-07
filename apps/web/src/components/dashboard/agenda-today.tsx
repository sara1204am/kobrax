import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AgendaTodaySummary } from '@kobrax/shared';
import { itemWhen } from '@/lib/agenda';

/**
 * «Agenda de hoy»: lo primero que se ve al entrar, y responde a «¿qué tengo que hacer hoy?».
 *
 * 🔴 **Muestra lo accionable, no todo**: cuántas hay vencidas (lo más urgente, en rojo), cuántas quedan hoy y las
 * próximas cinco con su hora. El resto está a un clic, en la Agenda. Los números salen de `GET /agenda/summary`,
 * que cuenta con el día civil de la empresa y el mismo alcance que la lista: el contador del menú dice lo mismo.
 */
export async function AgendaToday({ summary }: { summary: AgendaTodaySummary }) {
  const t = await getTranslations('panel.dashboard.agendaToday');
  const ta = await getTranslations('panel.agenda');

  return (
    <section aria-label={t('title')} className="mb-6 rounded-2xl border border-k-border bg-white p-5 shadow-k-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold text-k-navy">{t('title')}</h2>
        <Link href="/agenda" className="text-[13px] font-medium text-k-periwinkle hover:underline">
          {t('view')} →
        </Link>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[auto_1fr]">
        <dl className="flex gap-3 md:flex-col">
          <div className={`min-w-[120px] rounded-xl px-4 py-3 ${summary.overdue > 0 ? 'bg-k-danger-bg' : 'bg-k-bg'}`}>
            <dt className="text-[12px] text-k-text-2">{t('overdue')}</dt>
            <dd className={`text-[24px] font-semibold tabular-nums ${summary.overdue > 0 ? 'text-k-danger' : 'text-k-text'}`}>
              {summary.overdue}
            </dd>
          </div>
          <div className="min-w-[120px] rounded-xl bg-k-bg px-4 py-3">
            <dt className="text-[12px] text-k-text-2">{t('pending')}</dt>
            <dd className="text-[24px] font-semibold tabular-nums text-k-navy">{summary.pending}</dd>
          </div>
        </dl>

        {summary.items.length > 0 ? (
          <ul className="divide-y divide-k-border rounded-xl border border-k-border">
            {summary.items.map((item, i) => (
              <li key={item.id}>
                <Link href={`/agenda/${item.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-k-bg">
                  <span className="w-16 shrink-0 text-[13px] font-medium tabular-nums text-k-navy">{itemWhen(item, ta)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-k-text">{ta(`type.${item.type}`)}</span>
                    <span className="block truncate text-[13px] text-k-text-2">{item.clientName ?? '—'}</span>
                  </span>
                  {i === 0 && <span className="rounded-md bg-k-info-bg px-2 py-0.5 text-[11px] font-medium text-k-slate">{t('next')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="self-center text-[14px] text-k-text-2">{summary.overdue > 0 ? t('onlyOverdue') : t('nothing')}</p>
        )}
      </div>

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
    </section>
  );
}
