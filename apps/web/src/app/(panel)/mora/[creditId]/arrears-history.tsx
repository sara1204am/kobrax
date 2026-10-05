import { useLocale, useTranslations } from 'next-intl';
import type { MoraEpisode, MoraEpisodeEndReason } from '@kobrax/shared';
import { Badge, EmptyState, Section } from '@/components/panel-ui';
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
  const t = useTranslations('panel.mora.history');
  const tSource = useTranslations('panel.mora.arrearsSource');
  const locale = useLocale();
  const dash = '—';
  const amount = (n: number | undefined) => (n === undefined ? dash : money(n, currency));

  return (
    <Section title={t('title')} anchor="HISTORY" collapsible={{ count: episodes?.length }}>
      <p className="mb-3 text-[13px] text-k-text-2">{t('subtitle')}</p>

      {episodes === null ? (
        <EmptyState title={t('unavailable')} />
      ) : episodes.length === 0 ? (
        <EmptyState title={t('empty')} text={t('emptyText')} />
      ) : (
        <ol className="space-y-2.5">
          {episodes.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-4 rounded-xl border border-k-border bg-white px-4 py-3.5 shadow-[0_2px_8px_rgba(26,58,82,.06)] lg:flex-row lg:items-center"
            >
              {/* Número y fechas */}
              <div className="flex items-center gap-3.5 lg:w-[270px] lg:shrink-0">
                <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-k-info-bg text-[14px] font-semibold text-k-slate">
                  #{e.number}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-k-navy">{t('number', { n: e.number })}</span>
                    {e.current ? (
                      <span className="rounded-md bg-k-info-bg px-2 py-0.5 text-[11px] font-medium text-k-slate">{t('current')}</span>
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
                  <p className="mt-0.5 text-[12.5px] text-k-text-2">
                    {dayDate(e.startedAt, locale)}
                    {e.startedAtEstimated && <span title={t('estimatedHint')}> {t('estimated')}</span>}
                    {' → '}
                    {e.endedAt ? dayDate(e.endedAt, locale) : t('ongoing')}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-k-muted">{tSource(e.source)}</p>
                </div>
              </div>

              {/* Las cifras, separadas por una raya fina */}
              <dl className="grid flex-1 grid-cols-2 gap-y-3 sm:grid-cols-5 sm:gap-y-0 lg:divide-x lg:divide-k-border">
                <Item label={t('duration')} value={t('days', { n: e.durationDays })} />
                <Item label={t('peak')} value={e.maxDaysPastDue === undefined ? dash : t('days', { n: e.maxDaysPastDue })} />
                <Item label={t('balanceIn')} value={amount(e.balanceAtStart)} />
                <Item label={t('balanceOut')} value={e.current ? dash : amount(e.balanceAtEnd)} />
                <Item label={t('enteredWith')} value={e.startDaysPastDue === undefined ? dash : t('days', { n: e.startDaysPastDue })} />
              </dl>

              {/* De dónde salen los días de mora */}
              <div className="flex items-center gap-3 rounded-xl bg-k-bg px-3.5 py-2.5 lg:w-[210px] lg:shrink-0">
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-k-periwinkle" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2.5h8l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6 2.5zM14 2.5V8h5M8.5 13h7M8.5 16.5h7" />
                </svg>
                <div className="min-w-0">
                  <div className="text-[11px] text-k-periwinkle">{t('source')}</div>
                  <div className="text-[12.5px] font-medium text-k-navy">{tSource(e.source)}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 first:pl-0 lg:px-5 lg:first:pl-5">
      <dt className="text-[11px] text-k-periwinkle">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-k-navy">{value}</dd>
    </div>
  );
}
