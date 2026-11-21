import { useLocale, useTranslations } from 'next-intl';
import { memberName, summarizePromises, type Member, type MoraPromise, type MoraPromiseStatus } from '@kobrax/shared';
import { Badge, Section } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';
import { PromiseActions } from './promise-actions';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * El color de cada estado. **Vencida sin cerrar es ámbar, no roja**: nadie registró qué pasó, y pintarla como
 * incumplida castigaría al deudor por una gestión que el equipo no cerró.
 */
const TONE: Record<MoraPromiseStatus, Tone> = {
  ACTIVE: 'warning',
  OVERDUE: 'warning',
  KEPT: 'success',
  BROKEN: 'danger',
  EXECUTED: 'neutral',
  CANCELLED: 'neutral',
  RESCHEDULED: 'neutral',
};

/**
 * Las promesas de pago del crédito y cuánto se cumplen.
 *
 * El resumen sale de `summarizePromises` (shared), la misma regla que usará el móvil: **el cumplimiento sólo
 * cuenta las que tienen desenlace** (cumplida o incumplida). Sin ninguna cerrada no hay porcentaje, y se dice
 * en vez de mostrar 0 %.
 *
 * `promises === null` es «no se pudo leer»: la ficha sigue entera.
 */
export function PromisesSection({
  promises,
  members,
  currency,
  canWrite = false,
}: {
  promises: MoraPromise[] | null;
  members: Member[];
  currency: string;
  /** `collection:write`: puede cerrar una promesa pendiente a mano. */
  canWrite?: boolean;
}) {
  const t = useTranslations('panel.mora.ficha.promises');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));
  const summary = promises ? summarizePromises(promises) : null;

  return (
    <Section title={t('title')} anchor="PROMISES" collapsible={{ count: promises?.length }}>
      {promises === null ? (
        <p className="text-k-sm text-k-muted">{t('unavailable')}</p>
      ) : promises.length === 0 ? (
        <p className="text-k-sm text-k-muted">{t('empty')}</p>
      ) : (
        <>
          <p className="mb-1 text-k-sm text-k-text-2">
            {t('summary', { made: summary!.made, kept: summary!.kept, broken: summary!.broken })}
            {' · '}
            <span className="font-medium text-k-text">
              {summary!.complianceRate === undefined
                ? t('noCompliance')
                : t('compliance', { pct: Math.round(summary!.complianceRate * 100) })}
            </span>
          </p>
          {summary!.unresolved > 0 && <p className="mb-3 text-k-sm text-k-warning-text">{t('unresolved', { n: summary!.unresolved })}</p>}

          <ul className="divide-y divide-k-border">
            {promises.map((p) => (
              <li key={p.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-k-base font-medium text-k-text">
                    {p.amount === undefined ? '—' : money(p.amount, currency)}
                    <span className="ml-2 font-normal text-k-text-2">{t('dueOn', { date: dayDate(p.promiseDate, locale) })}</span>
                  </span>
                  <span title={p.status === 'OVERDUE' ? t('overdueHint') : undefined}>
                    <Badge tone={TONE[p.status]}>{t(`status.${p.status}`)}</Badge>
                  </span>
                </div>
                {(p.assigneeId || p.observations) && (
                  <p className="mt-0.5 text-k-xs text-k-muted">
                    {p.assigneeId && (byId.get(p.assigneeId) ?? t('unknownAssignee'))}
                    {p.assigneeId && p.observations ? ' · ' : ''}
                    {p.observations}
                  </p>
                )}
                {/* Una promesa pendiente (vigente o vencida sin cerrar) se puede cerrar con un botón, además de cerrarse sola con los pagos. */}
                {canWrite && (p.status === 'ACTIVE' || p.status === 'OVERDUE') && (
                  <div className="mt-1.5">
                    <PromiseActions promiseId={p.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
