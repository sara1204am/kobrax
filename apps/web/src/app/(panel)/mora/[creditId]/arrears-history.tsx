import { useLocale, useTranslations } from 'next-intl';
import type { MoraEpisode, MoraEpisodeEndReason } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * El color de cómo terminó una mora. **Ausente de la fuente es ámbar, no verde**: no se sabe si pagó, y
 * pintarlo como una recuperación sería afirmar algo que nadie sabe (D4).
 */
const END_TONE: Record<MoraEpisodeEndReason, Tone> = {
  PAID: 'success',
  CURRENT: 'success',
  SOURCE_ABSENT: 'warning',
  WRITTEN_OFF: 'danger',
  CANCELLED: 'neutral',
  DELETED: 'neutral',
};

/**
 * El historial de mora de un crédito: cada periodo en que estuvo vencido, del más reciente al más antiguo.
 *
 * 🔴 **No inventa el pasado.** Los episodios se miden desde que existe el historial; lo anterior es una
 * reconstrucción de los casos cerrados y viene marcado. Un dato que nadie midió (el inicio de un importado,
 * los días máximos de un episodio reconstruido) se muestra aproximado o «—», nunca como un número seguro.
 *
 * Las fechas son **días civiles** (`@db.Date`): se formatean en UTC con `dayDate`. Con `date()` Bolivia
 * (UTC−4) restaba un día y una mora que empezó el 29 aparecía empezando el 28.
 *
 * `episodes === null` es «no se pudo leer»: la ficha sigue entera y esta sección lo dice, igual que las
 * demás secciones con permiso denegado.
 */
export function ArrearsHistory({ episodes, currency }: { episodes: MoraEpisode[] | null; currency: string }) {
  const t = useTranslations('panel.cases.history');
  const tSource = useTranslations('panel.cases.arrearsSource');
  const locale = useLocale();
  const dash = '—';
  const amount = (n: number | undefined) => (n === undefined ? dash : money(n, currency));

  return (
    <section>
      <h2 className="text-[18px] font-semibold text-k-navy">{t('title')}</h2>
      <p className="mb-3 mt-1 text-[13px] text-k-text-2">{t('subtitle')}</p>

      {episodes === null ? (
        <EmptyState title={t('unavailable')} />
      ) : episodes.length === 0 ? (
        <EmptyState title={t('empty')} text={t('emptyText')} />
      ) : (
        <ol className="space-y-3">
          {episodes.map((e) => (
            <li
              key={e.id}
              className={`rounded-2xl border bg-white px-5 py-4 ${e.current ? 'border-k-danger/40' : 'border-k-border'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-k-text">{t('number', { n: e.number })}</span>
                  {e.current ? (
                    <Badge tone="danger">{t('current')}</Badge>
                  ) : (
                    e.endReason && (
                      <span title={e.endReason === 'SOURCE_ABSENT' ? t('endHint.SOURCE_ABSENT') : undefined}>
                        <Badge tone={END_TONE[e.endReason]}>{t(`end.${e.endReason}`)}</Badge>
                      </span>
                    )
                  )}
                  {e.reconstructed && (
                    <span title={t('reconstructedHint')}>
                      <Badge tone="neutral">{t('reconstructed')}</Badge>
                    </span>
                  )}
                </div>
                <span className="text-[13px] text-k-text-2">
                  {dayDate(e.startedAt, locale)}
                  {e.startedAtEstimated && <span title={t('estimatedHint')}> {t('estimated')}</span>}
                  {' → '}
                  {e.endedAt ? dayDate(e.endedAt, locale) : t('ongoing')}
                </span>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <Item label={t('duration')} value={t('days', { n: e.durationDays })} />
                <Item label={t('peak')} value={e.maxDaysPastDue === undefined ? dash : t('days', { n: e.maxDaysPastDue })} />
                <Item label={t('balanceIn')} value={amount(e.balanceAtStart)} />
                <Item label={t('balanceOut')} value={e.current ? dash : amount(e.balanceAtEnd)} />
                <Item label={t('enteredWith')} value={e.startDaysPastDue === undefined ? dash : t('days', { n: e.startDaysPastDue })} />
                <Item label={t('source')} value={tSource(e.source)} />
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-muted">{label}</dt>
      <dd className="mt-0.5 text-k-text">{value}</dd>
    </div>
  );
}
